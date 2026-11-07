/** INPUT: mock 价格(number 或精确 18 位 bigint)、共用 PullFeed 偏移、剧本 Context。 OUTPUT: 构造/写入价格区。 POSITION: EP3 mock 剧本。 SYNC: 同步 folder.md。 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { writeIx } from '../../src/oracle/mock-write';
import { deriveKeypair, type Token } from './actors';
import type { Context } from './context';
import { writeJson } from './record';
import { send } from './rpc';
import { SWITCHBOARD_QUEUE } from './switchboard-client';

// 为什么有这个文件：devnet 上 Switchboard 的 oracle 全部离线，没人能 crank(docs/decisions.md D-008)。
// 退而求其次：marginfi 以补丁构建，把 mocks 程序拥有的账户当作 Switchboard 价格账户；
// 账户内容与真实 PullFeedAccountData 逐字节同布局，价格由我们通过 mocks 的 write 指令写入。
// marginfi 走的仍然是 SwitchboardPull 的解析路径，只是 "crank" 换成了我们自己写。

import { FEED_SIZE, OFFSET, DISCRIMINATOR } from '../../src/decoder/switchboard';
export { FEED_SIZE, OFFSET, DISCRIMINATOR } from '../../src/decoder/switchboard';
const PRICES = new Map<Token, number>();

export function mocksProgram(built = resolve('program/out/program-ids.json'), deployed = resolve('program/devnet.json')): PublicKey {
  try {
    const ids = JSON.parse(readFileSync(built, 'utf8'));
    if (ids.priceOracle !== 'mock') throw new Error('marginfi 不是以 PRICE_ORACLE=mock 构建的，价格账户不会被认可');
    return new PublicKey(ids.mocks);
  } catch (error) {
    if (error instanceof Error && !('code' in error && error.code === 'ENOENT')) throw error;
    const ids = JSON.parse(readFileSync(deployed, 'utf8'));
    return new PublicKey(ids.mocks);
  }
}
export type MockFeedLabel = Token | 'tHYPE';
export const feedKeypair = (token: MockFeedLabel) => deriveKeypair(`feed/${token}`);

function i128(value: bigint): Buffer {
  const out = Buffer.alloc(16);
  out.writeBigUInt64LE(value & ((1n << 64n) - 1n));
  out.writeBigInt64LE(value >> 64n, 8);
  return out;
}

/** 价格 → Switchboard 的 18 位定点数。 */
export const toFixed18 = (price: number) => BigInt(Math.round(price * 1e6)) * 10n ** 12n;

// #region ep3-mock-feed-region
/** 从 sample_size(2215) 到 max_staleness(2392) 之前的 177 字节：时间戳、结果值、slot。 */
export function resultRegion(price: number | bigint, timestamp: number, slot: number): Buffer {
  // keeper 传链上 i128 原值，避免 Number/6 位小数舍入悄悄改变价格。
  const value = typeof price === 'bigint' ? price : toFixed18(price);
  const buf = Buffer.alloc(OFFSET.maxStaleness - OFFSET.sampleSize);
  buf.writeUInt8(1, 0); // sample_size
  buf.writeBigInt64LE(BigInt(timestamp), 1); // last_update_timestamp，marginfi 用它判断是否过期
  const result = OFFSET.result - OFFSET.sampleSize;
  // value(中位数)、std_dev、mean、range、min、max，各 16 字节；std_dev 与 range 为 0。
  [value, 0n, value, 0n, value, value].forEach((v, i) => i128(v).copy(buf, result + i * 16));
  const slotAt = result + 6 * 16 + 8; // 6 个 i128 之后还有 8 字节 padding
  [slot, slot, slot].forEach((s, i) => buf.writeBigUInt64LE(BigInt(s), slotAt + i * 8));
  return buf;
}
// #endregion

// writeIx 在 src/oracle/mock-write.ts(API 的构建器也要用,不能让 src 依赖 scenario)。
export { writeIx };

async function chainTime(ctx: Context) {
  const connection = ctx.provider.connection;
  const slot = await connection.getSlot('confirmed');
  return { slot, timestamp: (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000) };
}

async function writePrice(ctx: Context, token: Token, price: number, extra: TransactionInstruction[] = []) {
  const program = mocksProgram();
  const feed = feedKeypair(token).publicKey;
  const { slot, timestamp } = await chainTime(ctx);
  const ix = writeIx(program, feed, OFFSET.sampleSize, resultRegion(price, timestamp, slot), ctx.admin.publicKey);
  await send(ctx, `write mock feed ${token} = $${price}`, [...extra, ix], [feedKeypair(token)]);
}

// #region ep3-mock-feed-create
export async function createOrUpdateFeed(ctx: Context, token: Token, price: number) {
  const program = mocksProgram();
  const keypair = feedKeypair(token);
  const connection = ctx.provider.connection;
  const existing = await connection.getAccountInfo(keypair.publicKey);
  PRICES.set(token, price);
  ctx.feeds[token] = keypair.publicKey;
  ctx.record.addresses.feeds[token] = keypair.publicKey.toBase58();
  writeJson(ctx.outputPath, ctx.record);
  if (existing) {
    if (!existing.owner.equals(program)) throw new Error(`${token} 价格账户存在但不属于 mocks 程序`);
    return writePrice(ctx, token, price);
  }
  const rent = await connection.getMinimumBalanceForRentExemption(FEED_SIZE);
  const name = Buffer.alloc(32); name.write(`M1 mock ${token}`);
  const staleness = Buffer.alloc(4); staleness.writeUInt32LE(150);
  const owners = Buffer.concat([ctx.admin.publicKey.toBuffer(), new PublicKey(SWITCHBOARD_QUEUE).toBuffer()]);
  await writePrice(ctx, token, price, [
    SystemProgram.createAccount({ fromPubkey: ctx.admin.publicKey, newAccountPubkey: keypair.publicKey,
      lamports: rent, space: FEED_SIZE, programId: program }),
    writeIx(program, keypair.publicKey, 0, DISCRIMINATOR, ctx.admin.publicKey),
    writeIx(program, keypair.publicKey, OFFSET.authority, owners, ctx.admin.publicKey),
    writeIx(program, keypair.publicKey, OFFSET.name, name, ctx.admin.publicKey),
    writeIx(program, keypair.publicKey, OFFSET.maxStaleness, staleness, ctx.admin.publicKey),
  ]);
}
// #endregion

/** 等价于真实 crank：用当前链上时间重写价格，让 marginfi 的过期检查通过。 */
export async function crank(ctx: Context, token: Token, expectedPrice?: number) {
  const price = expectedPrice ?? PRICES.get(token);
  if (price === undefined) throw new Error(`${token} 还没有价格`);
  PRICES.set(token, price);
  await writePrice(ctx, token, price);
  const data = (await ctx.provider.connection.getAccountInfo(feedKeypair(token).publicKey, 'confirmed'))?.data;
  if (!data) throw new Error(`${token} 价格账户读不到`);
  const raw = data.readBigUInt64LE(OFFSET.result) + (data.readBigInt64LE(OFFSET.result + 8) << 64n);
  const read = Number(raw / 10n ** 12n) / 1e6;
  if (Math.abs(read - price) > 1e-6) throw new Error(`${token} 写入后读回 ${read}，期望 ${price}`);
  console.log(`  ${token}: $${read} (mock-switchboard)`);
}

export async function changePrice(ctx: Context, token: Token, price: number) {
  await crank(ctx, token, price);
}
