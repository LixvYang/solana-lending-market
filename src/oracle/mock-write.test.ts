/** INPUT: mock write and refresh instructions. OUTPUT: pinned account order, authorization, and clock refresh wire format. POSITION: offline oracle instruction test. SYNC: folder.md. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { refreshTimestampIx, writeIx } from './mock-write';

const discriminator = (name: string) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);

test('write requires target and authority signatures in that order', () => {
  const program = Keypair.generate().publicKey, target = Keypair.generate().publicKey;
  const authority = Keypair.generate().publicKey, payload = Buffer.from([1, 2, 3]);
  const ix = writeIx(program, target, 7, payload, authority);
  assert.deepEqual(ix.keys.map(({ pubkey, isSigner, isWritable }) => [pubkey.toBase58(), isSigner, isWritable]), [
    [target.toBase58(), true, true], [authority.toBase58(), true, false],
  ]);
  assert.deepEqual(ix.data.subarray(0, 8), discriminator('write'));
  assert.equal(ix.data.readBigUInt64LE(8), 7n);
  assert.deepEqual(ix.data.subarray(20), payload);
});

test('refresh_timestamp uses its discriminator and one writable non-signer feed', () => {
  const program = Keypair.generate().publicKey, feed = Keypair.generate().publicKey;
  const ix = refreshTimestampIx(program, feed);
  assert.equal(ix.programId.toBase58(), program.toBase58());
  assert.deepEqual(ix.keys.map(({ pubkey, isSigner, isWritable }) => [pubkey.toBase58(), isSigner, isWritable]), [
    [feed.toBase58(), false, true],
  ]);
  assert.deepEqual(ix.data, discriminator('refresh_timestamp'));
});
