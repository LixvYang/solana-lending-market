/** INPUT: deterministic mock feed addresses. OUTPUT: default signer recognition for user-transaction refresh. POSITION: offline oracle write test. SYNC: folder.md. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveKeypair } from '../../scenario/lib/actors';
import { mockFeedSigner } from './mock-write';

test('默认只把 tSOL/tUSDC/tHYPE 的 mock feeds 识别为可刷新账户', () => {
  for (const label of ['tSOL', 'tUSDC', 'tHYPE']) {
    assert.ok(mockFeedSigner(deriveKeypair(`feed/${label}`).publicKey));
  }
  assert.equal(mockFeedSigner(deriveKeypair('feed/pHYPE').publicKey), null);
});
