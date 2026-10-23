/** INPUT: mocks 程序地址、价格账户、偏移与字节。 OUTPUT: write 指令、价格账户的公开派生密钥。 POSITION: mock 价格的写入原语,剧本、维护进程与构建器共用。 SYNC: folder.md。 */
import { createHash } from 'node:crypto';
import { Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { deriveKeypair } from '../../scenario/lib/actors';
import { OFFSET } from '../decoder/switchboard';

/** mocks 程序的 write(offset, data):把任意字节写进账户。目标账户必须签名——价格账户的密钥是由固定字符串公开派生的。 */
export function writeIx(program: PublicKey, target: PublicKey, offset: number, data: Buffer): TransactionInstruction {
  const head = Buffer.alloc(8 + 8 + 4);
  createHash('sha256').update('global:write').digest().subarray(0, 8).copy(head);
  head.writeBigUInt64LE(BigInt(offset), 8);
  head.writeUInt32LE(data.length, 16);
  return new TransactionInstruction({ programId: program, keys: [{ pubkey: target, isSigner: true, isWritable: true }],
    data: Buffer.concat([head, data]) });
}

/** last_update_timestamp 在账户里的偏移(紧跟 sample_size 之后)。marginfi 判断价格是否过期只看这个字段。 */
export const TIMESTAMP_OFFSET = OFFSET.sampleSize + 1;

/** 只刷新时间戳的 write 指令:8 字节,价格数值一个字节都不动。 */
export function refreshTimestampIx(program: PublicKey, feed: PublicKey, unixSeconds: bigint): TransactionInstruction {
  const data = Buffer.alloc(8);
  data.writeBigInt64LE(unixSeconds);
  return writeIx(program, feed, TIMESTAMP_OFFSET, data);
}

/**
 * 如果这个价格账户是我们自己的 mock(密钥由 'feed/<代币>' 公开派生),返回它的密钥,否则返回 null。
 * 真正的预言机(比如 Switchboard)的价格账户没有这个密钥,也就不能这样刷新——那种情况由预言机自己负责新鲜度。
 */
export function mockFeedSigner(feed: PublicKey, labels: readonly string[] = ['tSOL', 'tUSDC', 'tHYPE']): Keypair | null {
  for (const label of labels) { const keypair = deriveKeypair(`feed/${label}`); if (keypair.publicKey.equals(feed)) return keypair; }
  return null;
}
