import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMarketHash, TAB_IDS } from './Tabs';

test('chain data replaces separate accounts and activity tabs', () => {
  assert.deepEqual(TAB_IDS, ['pool', 'wallet', 'swap', 'accounts']);
});

test('market hashes preserve an optional action and tolerate encoded symbols', () => {
  assert.deepEqual(parseMarketHash('market/pBTC/borrow'), { symbol: 'pBTC', action: 'borrow' });
  assert.deepEqual(parseMarketHash('market/t%2FUSD'), { symbol: 't/USD', action: null });
  assert.equal(parseMarketHash('market/unknown/action'), null);
});
