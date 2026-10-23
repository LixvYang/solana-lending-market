/** INPUT: 用户已签名 base64 交易、RPC/时钟。 OUTPUT: SendResponse。 POSITION: EP8 有界转发，无签名密钥。 SYNC: folder.md。 */
import { createPublicKey, verify } from 'node:crypto';
import { VersionedTransaction } from '@solana/web3.js';
import { encodeBase58 } from '../core/base58';
import { marginfiIdl } from '../decoder/idl';
import type { WalletRpc, WaitClock } from './wallet-rpc';
import { realClock } from './wallet-rpc';
import type { SendResponse } from './types';
import { ApiError } from './errors';
import { objectBody } from './wallet-input';
import { programError } from './program-error';
// #region ep8-send-guard
/**
 * 默认只接受含 marginfi 指令的交易(钱包转发接口)。水龙头的兑换台复用同一套签名/格式检查，
 * 但允许另一组程序——由调用方传入 accept，所以这里的检查不会被放宽给钱包转发接口。
 */
const hasMarginfi = (programs: string[]) => programs.includes(marginfiIdl.address);
export function guardTransaction(input: unknown, accept: (programs: string[], signers: string[]) => boolean = hasMarginfi,
  rejection = 'missing marginfi instruction'): { bytes: Buffer; signature: string } {
  const value = objectBody(input).transaction;
  if (typeof value !== 'string' || !value.length || value.length > 1644 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new ApiError(400, 'invalid transaction encoding/size');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > 1232) throw new ApiError(400, 'transaction exceeds 1232 bytes');
  let tx: VersionedTransaction;
  try { tx = VersionedTransaction.deserialize(bytes); }
  catch { throw new ApiError(400, 'invalid transaction'); }
  if (tx.version !== 0 || tx.message.addressTableLookups.length) throw new ApiError(400, 'only v0 transactions without lookup tables are supported');
  const message = tx.message, count = message.header.numRequiredSignatures;
  if (!count || !message.isAccountSigner(0) || tx.signatures.length !== count) throw new ApiError(400, 'fee payer must be a signer');
  const programs = message.compiledInstructions.map(ix => message.staticAccountKeys[ix.programIdIndex]?.toBase58() ?? '');
  const signers = message.staticAccountKeys.slice(0, count).map(k => k.toBase58());
  if (!programs.length || !accept(programs, signers)) throw new ApiError(400, rejection);
  // 非零字节不是签名证据；验证所有 required signatures，尤其是 payer 的 Ed25519 签名。
  // 服务端绝不补签或承担费用；ALT 拒绝，避免未解析的地址绕过程序检查。
  const data = message.serialize();
  for (let i = 0; i < count; i++) {
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), message.staticAccountKeys[i].toBuffer()]), format: 'der', type: 'spki' });
    if (!verify(null, data, key, tx.signatures[i])) throw new ApiError(400, 'missing or invalid signature');
  }
  if (!Buffer.from(tx.serialize()).equals(bytes)) throw new ApiError(400, 'noncanonical transaction');
  return { bytes, signature: encodeBase58(tx.signatures[0]) };
}
// #endregion
async function beforeDeadline<T>(operation: () => Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) throw Error('confirmation deadline');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('confirmation deadline')), ms); })]); }
  finally { clearTimeout(timer); }
}
export async function submitSigned(bytes: Uint8Array, signature: string, rpc: Pick<WalletRpc, 'sendRawTransaction' | 'getSignatureStatuses'>, clock: WaitClock = realClock,
  index?: (signature: string) => Promise<void>): Promise<SendResponse> {
  const end = clock.now() + 60_000;
  // 不以 send 报错判定失败：重复提交/响应丢失时，同一签名可能已经落链。
  // 跳过 preflight 后从 signature status 取链上错误，避免不可信异常字符串泄露 RPC 凭据。
  while (true) {
    try {
      const status = (await beforeDeadline(() => rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }), end - clock.now())).value[0];
      if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) {
        if (status.err) return { signature, status: 'failed', error: programError(status.err), slot: String(status.slot), indexed: false };
        let indexed = false;
        if (index) { try { await index(signature); indexed = true; } catch { /* tx 已确认;索引进程稍后会补入 */ } }
        return { signature, status: 'confirmed', error: null, slot: String(status.slot), indexed };
      }
    } catch { /* transient RPC failure: next poll, no exception logging */ }
    if (clock.now() >= end) return { signature, status: 'timeout', error: null, slot: null, indexed: false };
    try { await beforeDeadline(() => rpc.sendRawTransaction(bytes, { skipPreflight: true, maxRetries: 0 }), end - clock.now()); }
    catch { /* same signed bytes are replayed; never rebuild or re-sign */ }
    await clock.sleep(Math.min(2000, Math.max(0, end - clock.now())));
  }
}
export function sendTransaction(input: unknown, rpc: WalletRpc, clock?: WaitClock, index?: (signature: string) => Promise<void>): Promise<SendResponse> {
  const { bytes, signature } = guardTransaction(input);
  return submitSigned(bytes, signature, rpc, clock, index);
}
