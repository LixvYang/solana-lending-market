/** INPUT: ANCHOR_WALLET、RPC_URL、可选 --price。 OUTPUT: 固定价 tHYPE mock feed、SwitchboardPull 银行配置与链下标签。 POSITION: devnet 管理员 CLI；幂等。 */
import 'dotenv/config';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { deriveKeypair } from '../scenario/lib/actors';
import { DISCRIMINATOR, FEED_SIZE, OFFSET } from '../src/decoder/switchboard';
import { createContext } from '../scenario/lib/runtime';
import { send } from '../scenario/lib/rpc';
import { SWITCHBOARD_QUEUE } from '../scenario/lib/switchboard-client';
import { feedKeypair, mocksProgram, resultRegion } from '../scenario/lib/mock-feed';
import { writeIx } from '../src/oracle/mock-write';
import { loadLabels } from '../src/store/labels';
import { pgDb } from '../src/store/db';
import { fixed18Price, HYPE_BANK_SEEDS, HYPE_FEED_LABEL, parseHypeOracleArgs } from '../src/oracle/hype';
import { fetchAccount } from '../scenario/lib/state';

const isPull = (value: unknown) => typeof value === 'object' && value !== null && 'SwitchboardPull' in value;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { console.log('用法: fix-hype-oracle [--price 80]'); return; }
  const price = parseHypeOracleArgs(args), priceFixed = fixed18Price(price), ctx = await createContext(''), connection = ctx.provider.connection;
  // 这些旧种子对应已上链的 pHYPE mint/bank，不能随链下符号改名。
  const mint = deriveKeypair(HYPE_BANK_SEEDS.mint).publicKey, bank = deriveKeypair(HYPE_BANK_SEEDS.bank).publicKey;
  const feed = feedKeypair(HYPE_FEED_LABEL), program = mocksProgram();
  if (!await connection.getAccountInfo(ctx.actors.group.publicKey)) throw new Error('group 不存在');
  if (!await connection.getAccountInfo(bank)) throw new Error('HYPE bank 不存在');

  const existing = await connection.getAccountInfo(feed.publicKey);
  if (existing && !existing.owner.equals(program)) throw new Error('tHYPE feed 已存在但不属于 mocks 程序');
  if (!existing) {
    const rent = await connection.getMinimumBalanceForRentExemption(FEED_SIZE);
    const name = Buffer.alloc(32); name.write('mock tHYPE');
    const staleness = Buffer.alloc(4); staleness.writeUInt32LE(150);
    const owners = Buffer.concat([ctx.admin.publicKey.toBuffer(), new PublicKey(SWITCHBOARD_QUEUE).toBuffer()]);
    await send(ctx, 'create tHYPE mock feed', [
      SystemProgram.createAccount({ fromPubkey: ctx.admin.publicKey, newAccountPubkey: feed.publicKey, lamports: rent, space: FEED_SIZE, programId: program }),
      writeIx(program, feed.publicKey, 0, DISCRIMINATOR), writeIx(program, feed.publicKey, OFFSET.authority, owners),
      writeIx(program, feed.publicKey, OFFSET.name, name), writeIx(program, feed.publicKey, OFFSET.maxStaleness, staleness),
    ], [feed]);
  }
  const slot = await connection.getSlot('confirmed'), timestamp = await connection.getBlockTime(slot);
  if (timestamp === null) throw new Error('chain time unavailable');
  await send(ctx, `set tHYPE mock price $${price}`, [writeIx(program, feed.publicKey, OFFSET.sampleSize, resultRegion(priceFixed, timestamp, slot))], [feed]);

  const current = await fetchAccount(ctx, 'bank', bank);
  const oracleKey = current.config.oracleKeys[0] as PublicKey;
  if (!isPull(current.config.oracleSetup) || !oracleKey.equals(feed.publicKey)) {
    await send(ctx, 'configure tHYPE SwitchboardPull oracle', [await ctx.program.methods.lendingPoolConfigureBankOracle(4, feed.publicKey)
      .accountsStrict({ group: ctx.actors.group.publicKey, admin: ctx.admin.publicKey, bank })
      .remainingAccounts([{ pubkey: feed.publicKey, isSigner: false, isWritable: false }]).instruction()]);
  }
  const db = pgDb();
  try { await loadLabels(db, { mints: { tHYPE: mint.toBase58() }, banks: { tHYPE: bank.toBase58() }, marginfiAccounts: {}, actors: {} }); }
  finally { await db.close(); }
  console.log(`tHYPE oracle ready at $${price}; feed ${feed.publicKey.toBase58()}`);
}

void main().then(() => process.exit(0), error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
