/** INPUT: 专用钱包、RPC、grant 与内存限流。 OUTPUT: FaucetResponse/HTTP 错误。 POSITION: 独立水龙头，只有转账权限。 SYNC: folder.md。 */
import { Keypair, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction } from '@solana/spl-token';
import { encodeBase58 } from '../core/base58';
import { ApiError } from '../api/errors';
import { objectBody, publicKey } from '../api/wallet-input';
import { tokenBalance } from '../api/wallet';
import { submitSigned } from '../api/send';
import type { WalletRpc, WaitClock } from '../api/wallet-rpc';
import { realClock } from '../api/wallet-rpc';
import type { FaucetResponse } from '../api/types';
import { emptyLimits, reserve } from './limit';
import type { Grant } from './config';
import type { DeskLeg } from '../store/desk-events';
export class FaucetLimit extends ApiError {
  constructor(public readonly next_allowed_at: string) { super(429, 'faucet rate limit exceeded'); }
}
export function createFaucet(payer: Keypair, rpc: WalletRpc, grants: Grant[], dailyMax = 2000, clock: WaitClock = realClock,
  record?: (signature: string, wallet: string, details: DeskLeg[]) => Promise<void>) {
  // 重启会清零。先同步预留，防止并发请求越过限额；失败也占一次，避免重试放大/超时重复发币。
  // 专用钱包只能转已有测试币；本模块从不加载管理员或 mint authority，不能铸币。
  let state = emptyLimits();
  return async (input: unknown, ip: string): Promise<FaucetResponse> => {
    const wallet = publicKey(objectBody(input).wallet);
    const limit = reserve(state, wallet.toBase58(), ip, clock.now(), dailyMax);
    if (!limit.ok) throw new FaucetLimit(new Date(limit.next).toISOString());
    state = limit.state;
    for (const grant of grants) if (await tokenBalance(rpc, grant.mint, payer.publicKey) < grant.amount)
      throw new ApiError(503, '水龙头测试代币余额不足，请联系维护者补充。');
    const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })];
    for (const grant of grants) {
      const destination = getAssociatedTokenAddressSync(grant.mint, wallet), source = getAssociatedTokenAddressSync(grant.mint, payer.publicKey);
      instructions.push(createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, destination, wallet, grant.mint),
        createTransferInstruction(source, destination, payer.publicKey, grant.amount));
    }
    const block = await rpc.getLatestBlockhash('confirmed');
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: block.blockhash, instructions }).compileToV0Message());
    tx.sign([payer]);
    const signature = encodeBase58(tx.signatures[0]), result = await submitSigned(tx.serialize(), signature, rpc, clock);
    if (result.status !== 'confirmed') throw new ApiError(503, result.status === 'timeout' ? '转账确认超时，请稍后检查钱包余额。' : '水龙头转账失败，请联系维护者。');
    if (record) try { await record(signature, wallet.toBase58(), grants.map(g => ({ symbol: g.label, amount: String(g.amount), decimals: g.decimals ?? 0 }))); }
    catch { console.error('desk history write failed'); }
    return { signatures: [signature], granted: grants.map(g => ({ label: g.label, amount: String(g.amount) })), next_allowed_at: new Date(limit.next).toISOString() };
  };
}
