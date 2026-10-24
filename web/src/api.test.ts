import assert from 'node:assert/strict';
import test from 'node:test';
import { api, apiUrl } from './api';
import { deskBase } from './wallet/chain';

test('API base applies to same-origin paths and leaves public faucet URLs intact', () => {
  assert.equal(apiUrl('/api/pool'), '/api/pool');
  assert.equal(apiUrl('https://api.example.com:8788/swap/rates'), 'https://api.example.com:8788/swap/rates');
  assert.equal(deskBase('/api/desk/faucet'), '/api/desk');
  assert.equal(apiUrl(`${deskBase('/api/desk/faucet')}/swap/rates`), '/api/desk/swap/rates');
});

test('pool banks are ordered by total deposits in USD, with unknown values last', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    banks: [
      { label: 'unknown', total_deposits_usd: null },
      { label: 'small', total_deposits_usd: 10 },
      { label: 'large', total_deposits_usd: 100 },
    ],
  }), { status: 200 });
  try {
    const pool = await api.pool();
    assert.deepEqual(pool.banks.map((bank) => bank.label), ['large', 'small', 'unknown']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
