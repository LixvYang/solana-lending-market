/** INPUT: mock feed account metadata and RPC clock. OUTPUT: batched public timestamp refresh instructions. POSITION: EP8 keeper with no price-write authority. SYNC: folder.md. */
import type { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { tokens } from '../../scenario/lib/actors';
import { feedKeypair, type MockFeedLabel } from '../../scenario/lib/mock-feed';
import { refreshTimestampIx } from '../oracle/mock-write';
import { DISCRIMINATOR, FEED_SIZE, OFFSET } from '../decoder/switchboard';

export type PriceRpc = Pick<Connection, 'getMultipleAccountsInfo' | 'getSlot' | 'getBlockTime'>;
export type RefreshInstruction = { label: MockFeedLabel; instruction: TransactionInstruction };
export const PRICE_TOKENS: readonly MockFeedLabel[] = [...tokens, 'tHYPE'];
const PRICE_MAX_AGE: Record<MockFeedLabel, bigint> = { tSOL: 240n, tUSDC: 240n, tHYPE: 900n };
const KEEPER_INTERVAL_SECONDS = 180n;
// 留两轮余量给轮次抖动和确认时间，避免 tHYPE 在临近过期时被跳过。
export async function priceInstructions(rpc: PriceRpc, program: PublicKey, labels: readonly MockFeedLabel[] = PRICE_TOKENS,
  onlyExpired = false): Promise<RefreshInstruction[]> {
  const feeds = labels.map(label => ({ label, key: feedKeypair(label).publicKey }));
  const infos = await rpc.getMultipleAccountsInfo(feeds.map(feed => feed.key), 'confirmed');
  const slot = await rpc.getSlot('confirmed'), timestamp = await rpc.getBlockTime(slot);
  if (timestamp === null) throw Error('chain time unavailable');
  return feeds.flatMap(({ label, key }, i) => {
    const info = infos[i];
    if (!info || !info.owner.equals(program)) throw Error(`invalid mock feed owner: ${label}`);
    if (info.data.length !== FEED_SIZE || !info.data.subarray(0, 8).equals(DISCRIMINATOR)) throw Error(`invalid mock feed: ${label}`);
    if (!info.data[OFFSET.sampleSize]) throw Error(`uninitialized price: ${label}`);
    const updated = info.data.readBigInt64LE(OFFSET.sampleSize + 1);
    if (onlyExpired && BigInt(timestamp) - updated < PRICE_MAX_AGE[label] - 2n * KEEPER_INTERVAL_SECONDS) return [];
    return [{ label, instruction: refreshTimestampIx(program, key) }];
  });
}
export async function priceInstruction(rpc: PriceRpc, program: PublicKey, token: MockFeedLabel) {
  return (await priceInstructions(rpc, program, [token]))[0];
}
export async function refreshPrices(rpc: PriceRpc, program: PublicKey,
  send: (values: RefreshInstruction[]) => Promise<string | void>) {
  const values = await priceInstructions(rpc, program, PRICE_TOKENS, true);
  return { values, signature: values.length ? await send(values) : undefined };
}
