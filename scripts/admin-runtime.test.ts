import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { encodeBase58 } from '../src/core/base58';
import { serviceKeypair } from './admin-runtime';

test('service key accepts JSON arrays and base58 without exposing secrets in errors', () => {
  const pair = Keypair.generate(), bytes = Array.from(pair.secretKey);
  assert.equal(serviceKeypair(` ${JSON.stringify(bytes)} `, undefined, 'KEEPER').publicKey.toBase58(), pair.publicKey.toBase58());
  assert.equal(serviceKeypair(encodeBase58(pair.secretKey), undefined, 'KEEPER').publicKey.toBase58(), pair.publicKey.toBase58());
  const secret = encodeBase58(pair.secretKey);
  assert.throws(() => serviceKeypair(secret, '/missing', 'KEEPER'), error => {
    assert.match((error as Error).message, /both be set/);
    assert.ok(!(error as Error).message.includes(secret));
    return true;
  });
  assert.throws(() => serviceKeypair('private-content', undefined, 'KEEPER'), error => {
    assert.match((error as Error).message, /invalid KEEPER secret/);
    assert.ok(!(error as Error).message.includes('private-content'));
    return true;
  });
});
