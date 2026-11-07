/** INPUT: fixtures、假时钟/假 RPC。 OUTPUT: M7 离线测试辅助。 POSITION: 测试专用，无网络。 SYNC: folder.md。 */
import { readFileSync } from 'node:fs';
import { PublicKey, VersionedTransaction, type AccountInfo } from '@solana/web3.js';
import { AccountLayout, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import run from '../../fixtures/m1-run.json';
import { resultRegion } from '../../scenario/lib/mock-feed';
import { OFFSET } from '../decoder/switchboard';
import { decodeInstruction } from '../decoder/instruction';
import { marginfiIdl } from '../decoder/idl';
import { encodeBase58 } from '../core/base58';
import type { WalletRpc, WaitClock } from './wallet-rpc';
export const addresses = run.addresses;
export const mockOwner = new PublicKey('3UNhKQCzvj4ZXRP7BBy25STrRAh8VMtBiKmXimGUWAt7');
export function fakeClock(start = 1_700_000_000_000): WaitClock {
  let time = start;
  return { now: () => time, sleep: async ms => { time += ms; } };
}
export function feedInfo(timestamp = 1700000000, price: number | bigint = 50): AccountInfo<Buffer> {
  const data = readFileSync('fixtures/switchboard-pullfeed-uncranked.bin');
  resultRegion(price, timestamp, 100).copy(data, OFFSET.sampleSize);
  return { data, owner: mockOwner, lamports: 1, executable: false, rentEpoch: 0 };
}
export function tokenInfo(mint: PublicKey, owner: PublicKey, amount: bigint): AccountInfo<Buffer> {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode({ mint, owner, amount, delegateOption: 0, delegate: PublicKey.default, state: 1,
    isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, data);
  return { data, owner: TOKEN_PROGRAM_ID, lamports: 1, executable: false, rentEpoch: 0 };
}
export function fakeRpc(overrides: Partial<WalletRpc> = {}): WalletRpc {
  const rpc = {
    getLatestBlockhash: async commitment => { if (commitment !== 'confirmed') throw Error('wrong commitment'); return { blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 999 }; },
    simulateTransaction: async () => ({ context: { slot: 1 }, value: { err: null, logs: [], unitsConsumed: 123 } }),
    getAccountInfo: async key => Object.values(addresses.feeds).includes(key.toBase58()) ? feedInfo() : null,
    getBalance: async () => 123456789,
    sendRawTransaction: async () => 'unused',
    getSignatureStatuses: async () => ({ context: { slot: 20 }, value: [{ slot: 20, confirmations: 1, err: null, confirmationStatus: 'confirmed' }] }),
    getTransaction: async () => null,
    ...overrides,
  } as WalletRpc;
  // 批量读取委托给(可能被覆盖的)单个读取,测试只需要覆盖 getAccountInfo。
  return { ...rpc, getMultipleAccountsInfo: overrides.getMultipleAccountsInfo ?? (async (keys: PublicKey[], c: unknown) => Promise.all(keys.map(k => rpc.getAccountInfo(k, c as never)))) } as WalletRpc;
}
export const services = (overrides: Partial<WalletRpc> = {}) => ({ rpc: fakeRpc(overrides), clock: fakeClock(), oracleOwners: new Set([mockOwner.toBase58()]) });
export const builtTx = (base64: string) => VersionedTransaction.deserialize(Buffer.from(base64, 'base64'));
export function decodedInstructions(tx: VersionedTransaction) {
  const keys = tx.message.staticAccountKeys.map(k => k.toBase58());
  return tx.message.compiledInstructions.filter(ix => keys[ix.programIdIndex] === marginfiIdl.address).map(ix => decodeInstruction({
    programIdIndex: ix.programIdIndex, accounts: Array.from(ix.accountKeyIndexes), data: encodeBase58(ix.data),
  }, keys, marginfiIdl));
}
