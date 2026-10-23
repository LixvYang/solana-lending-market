/** INPUT: 公开 feed signer、RPC、当前链上价格。 OUTPUT: 保持价格的 write 指令。 POSITION: EP8 keeper 无环境密钥读取。 SYNC: folder.md。 */
import type { Connection, PublicKey } from '@solana/web3.js';
import { tokens } from '../../scenario/lib/actors';
import { resultRegion, writeIx, feedKeypair, type MockFeedLabel } from '../../scenario/lib/mock-feed';
import { decodePullFeed, OFFSET } from '../decoder/switchboard';
export type PriceRpc = Pick<Connection, 'getMultipleAccountsInfo' | 'getSlot' | 'getBlockTime'>;
export const PRICE_TOKENS: readonly MockFeedLabel[] = [...tokens, 'tHYPE'];
const PRICE_MAX_AGE: Record<MockFeedLabel, bigint> = { tSOL: 240n, tUSDC: 240n, tHYPE: 900n };
const KEEPER_INTERVAL_SECONDS = 180n;
// 只跳过"再等两轮也不会过期"的价格:留一轮余量给轮次抖动和交易确认。只留一轮时，tHYPE 可能在 719 秒被跳过、下轮 899 秒才刷新。
export async function priceInstructions(rpc: PriceRpc, program: PublicKey, labels: readonly MockFeedLabel[] = PRICE_TOKENS,
  overrides: Partial<Record<MockFeedLabel, bigint>> = {}, onlyExpired = false) {
  const signers = labels.map(feedKeypair);
  const infos = await rpc.getMultipleAccountsInfo(signers.map(s => s.publicKey), 'confirmed');
  const slot = await rpc.getSlot('confirmed'), timestamp = await rpc.getBlockTime(slot);
  if (timestamp === null) throw Error('chain time unavailable');
  return signers.flatMap((signer, i) => {
    const info = infos[i];
    if (!info || !info.owner.equals(program)) throw Error(`invalid mock feed owner: ${labels[i]}`);
    const current = decodePullFeed(info.data);
    if (!current.sample_size && overrides[labels[i]] === undefined) throw Error(`uninitialized price: ${labels[i]}`);
    if (onlyExpired && current.last_update_timestamp !== null && BigInt(timestamp) - current.last_update_timestamp < PRICE_MAX_AGE[labels[i]] - 2n * KEEPER_INTERVAL_SECONDS) return [];
    const price = overrides[labels[i]] ?? current.price.numerator;
    if (price <= 0n) throw Error(`invalid price: ${labels[i]}`);
    return [{ label: labels[i], signer, instruction: writeIx(program, signer.publicKey, OFFSET.sampleSize, resultRegion(price, timestamp, slot)) }];
  });
}
export async function priceInstruction(rpc: PriceRpc, program: PublicKey, token: MockFeedLabel, newPrice?: bigint) {
  return (await priceInstructions(rpc, program, [token], newPrice === undefined ? {} : { [token]: newPrice }))[0];
}
export async function refreshPrices(rpc: PriceRpc, program: PublicKey,
  send: (values: Awaited<ReturnType<typeof priceInstructions>>) => Promise<string | void>) {
  const values = await priceInstructions(rpc, program, PRICE_TOKENS, {}, true);
  return { values, signature: values.length ? await send(values) : undefined };
}
