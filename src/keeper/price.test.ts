/** INPUT: tHYPE mock PullFeed 与 fake RPC. OUTPUT: keeper 名单和 tHYPE 保价刷新断言. POSITION: 离线 keeper 测试. SYNC: folder.md. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Keypair, PublicKey } from '@solana/web3.js';
import { deriveKeypair } from '../../scenario/lib/actors';
import { resultRegion } from '../../scenario/lib/mock-feed';
import { OFFSET } from '../decoder/switchboard';
import { PRICE_TOKENS, priceInstruction } from './price';

test('price keeper includes tHYPE without changing scenario tokens', async () => {
  assert.deepEqual(PRICE_TOKENS, ['tUSDC', 'tSOL', 'tHYPE']);
  const feed = deriveKeypair('feed/tHYPE'), program = Keypair.generate().publicKey;
  const data = Buffer.from(readFileSync('fixtures/switchboard-pullfeed-uncranked.bin'));
  resultRegion(80, 1, 1).copy(data, OFFSET.sampleSize);
  const rpc = {
    getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map(key => key.equals(feed.publicKey) ? { data, owner: program, lamports: 1, executable: false, rentEpoch: 0 } : null),
    getSlot: async () => 99,
    getBlockTime: async () => 1234,
  } as never;
  const result = await priceInstruction(rpc, program, 'tHYPE');
  assert.ok(result.signer.publicKey.equals(feed.publicKey));
  assert.ok(result.instruction.keys[0].isSigner);
  assert.equal(result.instruction.data.readUInt32LE(16), 177);
});
