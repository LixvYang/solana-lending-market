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
import { emptyLimits, quota, reserve } from './limit';
import { lowBalanceWarning } from '../core/low-balance';
import type { Grant } from './config';
import type { DeskLeg } from '../store/desk-events';
export class FaucetLimit extends ApiError {
  constructor(public readonly next_allowed_at: string) { super(429, '领取过于频繁，请稍后再试。', 'FAUCET_LIMIT'); }
}
export class FaucetWindowFull extends ApiError {
  constructor(next: string) { super(429, '本时段名额已领完。', 'FAUCET_WINDOW_FULL', { next }); }
}
export type FaucetService = ((input: unknown, ip: string) => Promise<FaucetResponse>) & { quota: () => ReturnType<typeof quota> };
export function createFaucet(payer: Keypair, rpc: WalletRpc, grants: Grant[], windowHours = 5, windowMax = 30, minSol = 0.2, clock: WaitClock = realClock,
  record?: (signature: string, wallet: string, details: DeskLeg[]) => Promise<void>) {
  // 重启会清零；多实例也各自计数。预留按滑动窗口保存在内存，失败也占名额，避免重试放大。
  // 专用钱包只能转已有测试币；本模块从不加载管理员或 mint authority，不能铸币。
  let state = emptyLimits();
  const warnLow = lowBalanceWarning();
  const handler = (async (input: unknown, ip: string): Promise<FaucetResponse> => {
    const wallet = publicKey(objectBody(input).wallet);
    const limit = reserve(state, wallet.toBase58(), ip, clock.now(), windowHours, windowMax);
    if (!limit.ok) {
      const next = new Date(limit.next).toISOString();
      if (limit.reason === 'window') throw new FaucetWindowFull(next);
      throw new FaucetLimit(next);
    }
    state = limit.state;
    const sol = await rpc.getBalance(payer.publicKey, 'confirmed'), solValue = sol / 1_000_000_000;
    if (warnLow(solValue, 1, clock.now())) console.warn(`faucet SOL balance low wallet=${payer.publicKey.toBase58()} balance=${solValue.toFixed(4)} SOL`);
    if (solValue < minSol) throw new ApiError(503, '水龙头 SOL 余额不足，暂时无法领取。', 'FAUCET_EMPTY');
    for (const grant of grants) if (await tokenBalance(rpc, grant.mint, payer.publicKey) < grant.amount)
      throw new ApiError(503, '水龙头测试代币余额不足，请联系维护者补充。', 'FAUCET_EMPTY');
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
    if (result.status !== 'confirmed') throw new ApiError(503, result.status === 'timeout' ? '转账确认超时，请稍后检查钱包余额。' : '水龙头转账失败，请联系维护者。', result.status === 'timeout' ? 'TRANSFER_TIMEOUT' : 'TRANSFER_FAILED');
    if (record) try { await record(signature, wallet.toBase58(), grants.map(g => ({ symbol: g.label, amount: String(g.amount), decimals: g.decimals ?? 0 }))); }
    catch { console.error('desk history write failed'); }
    return { signatures: [signature], granted: grants.map(g => ({ label: g.label, amount: String(g.amount) })), next_allowed_at: new Date(limit.next).toISOString() };
  }) as FaucetService;
  handler.quota = () => quota(state, clock.now(), windowHours, windowMax);
  return handler;
}
