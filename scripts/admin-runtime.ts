/** INPUT: 显式密钥路径、RPC_URL。 OUTPUT: CLI 专用读钥/签名发送。 POSITION: setup/keeper 管理员工具，不被 API 导入。 SYNC: folder.md。 */
import { readFileSync } from 'node:fs';
import { Connection, Keypair, TransactionMessage, VersionedTransaction, type TransactionInstruction } from '@solana/web3.js';
import { rpcConnection } from '../src/api/wallet-rpc';
import { submitSigned } from '../src/api/send';
import { decodeBase58, encodeBase58 } from '../src/core/base58';
export function readKeypair(path: string | undefined): Keypair {
  if (!path) throw Error('keypair path required');
  const bytes: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(bytes) || bytes.length !== 64 || bytes.some(b => !Number.isInteger(b) || b < 0 || b > 255)) throw Error('invalid keypair file');
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}
export function serviceKeypair(secret: string | undefined, path: string | undefined, label: string): Keypair {
  if (secret && path) throw Error(`${label} secret and keypair path cannot both be set`);
  if (secret) {
    try {
      const encoded = secret.trim();
      const value: unknown = encoded.startsWith('[') ? JSON.parse(encoded) : Array.from(decodeBase58(encoded));
      if (!Array.isArray(value) || value.length !== 64 || value.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw Error();
      return Keypair.fromSecretKey(Uint8Array.from(value as number[]));
    } catch { throw Error(`invalid ${label} secret key`); }
  }
  if (!path) throw Error(`missing ${label} credentials`);
  try { return readKeypair(path); } catch { throw Error(`invalid ${label} keypair file`); }
}
export function cliRpc() {
  if (!process.env.RPC_URL) throw Error('RPC configuration required');
  return rpcConnection(process.env.RPC_URL);
}
export async function sendInstructions(rpc: Connection, payer: Keypair, instructions: TransactionInstruction[], signers: Keypair[] = []) {
  const block = await rpc.getLatestBlockhash('confirmed');
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: block.blockhash, instructions }).compileToV0Message());
  tx.sign([payer, ...signers]);
  const result = await submitSigned(tx.serialize(), encodeBase58(tx.signatures[0]), rpc);
  if (result.status !== 'confirmed') throw Error('transaction not confirmed');
  return result.signature;
}
