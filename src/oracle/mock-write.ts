/** INPUT: mocks program, feed addresses, and write bytes. OUTPUT: authorized write and public timestamp refresh instructions. POSITION: mock oracle instruction wire format. SYNC: folder.md. */
import { createHash } from 'node:crypto';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';

const discriminator = (name: string) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);

/** Price writes require both the target account and the program's price administrator. */
export function writeIx(program: PublicKey, target: PublicKey, offset: number, data: Buffer, authority: PublicKey): TransactionInstruction {
  const head = Buffer.alloc(8 + 8 + 4);
  discriminator('write').copy(head);
  head.writeBigUInt64LE(BigInt(offset), 8);
  head.writeUInt32LE(data.length, 16);
  return new TransactionInstruction({ programId: program, keys: [
    { pubkey: target, isSigner: true, isWritable: true }, { pubkey: authority, isSigner: true, isWritable: false },
  ], data: Buffer.concat([head, data]) });
}

/** The deployed program reads Clock and updates only last_update_timestamp and slot fields. */
export function refreshTimestampIx(program: PublicKey, feed: PublicKey): TransactionInstruction {
  return new TransactionInstruction({ programId: program, keys: [{ pubkey: feed, isSigner: false, isWritable: true }],
    data: discriminator('refresh_timestamp') });
}
