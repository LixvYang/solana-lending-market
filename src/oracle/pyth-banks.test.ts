/** INPUT: Pyth 银行配置、确定性 actor 派生。 OUTPUT: 参数默认值、feed 覆盖、pSOL 种子兼容与 CLI 参数断言。 POSITION: 离线测试。 SYNC: folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveKeypair } from '../../scenario/lib/actors';
import { FEED_IDS } from './pyth';
import { parsePythBankArgs, PYTH_BANKS, pythBankSeeds } from './pyth-banks';
import { HYPE_BANK_SEEDS, HYPE_FEED_LABEL, HYPE_PRICE, fixed18Price, parseHypeOracleArgs } from './hype';

test('Pyth 银行配置只保留 SOL/BTC/ETH，HYPE 改用自有 mock 价格', () => {
  assert.deepEqual(PYTH_BANKS.pSOL, { feed: 'SOL/USD', decimals: 9, maxAge: 300, faucetAmount: '10', setupAmount: '20000' });
  assert.deepEqual([PYTH_BANKS.pBTC.feed, PYTH_BANKS.pETH.feed], ['BTC/USD', 'ETH/USD']);
  assert.equal('pHYPE' in PYTH_BANKS, false);
  for (const symbol of ['pBTC', 'pETH'] as const) {
    assert.equal(PYTH_BANKS[symbol].decimals, 8);
    assert.equal(PYTH_BANKS[symbol].maxAge, 900);
    assert.ok(FEED_IDS[PYTH_BANKS[symbol].feed]);
  }
});

test('按符号派生 mint/bank,pSOL 仍使用线上地址和原 run-id 种子', () => {
  const psol = pythBankSeeds('pSOL');
  assert.equal(psol.mint, 'mint/pSOL'); assert.equal(psol.bank, 'bank/pSOL');
  assert.equal(deriveKeypair(psol.mint).publicKey.toBase58(), 'bjwmjXvFypKzUwfFEp4ZraarSWsF79e72HbLftQ3z33');
  assert.equal(deriveKeypair(psol.bank).publicKey.toBase58(), 'D77PE9gnPYQD16kwDFSHgXfReA8Ud133PF3bKVfPr4pN');
  assert.equal(deriveKeypair(pythBankSeeds('pSOL', 'r4').bank).publicKey.toBase58(), 'AdBjMNTQp9coDdn6HtrmLDAkBruNbNEYGcU51ZTCkHeG');
});

test('tHYPE 复用已部署 pHYPE mint/bank seeds,新 feed 使用 tHYPE 标签且默认固定 $80', () => {
  assert.deepEqual(HYPE_BANK_SEEDS, { mint: 'mint/pHYPE', bank: 'bank/pHYPE' });
  assert.equal(deriveKeypair(HYPE_BANK_SEEDS.mint).publicKey.toBase58(), 'F3nzz3p8L6maUBs8kmS4xi7Jzbiu9DP1z8aFXye1JKGs');
  assert.equal(deriveKeypair(HYPE_BANK_SEEDS.bank).publicKey.toBase58(), 'H3eVeTmiHAP3jhd46ubVxVf58nMhQK4dJ2ScFFTtDRaE');
  assert.equal(deriveKeypair(`feed/${HYPE_FEED_LABEL}`).publicKey.toBase58(), '35JES1e18iBY9Wm3T4LCjErHM3vSbvimsHQXxXnHoCot');
  assert.equal(HYPE_FEED_LABEL, 'tHYPE'); assert.equal(HYPE_PRICE, '80');
  assert.equal(parseHypeOracleArgs([]), '80'); assert.equal(parseHypeOracleArgs(['--price', '81.25']), '81.25');
  assert.equal(fixed18Price('80'), 80n * 10n ** 18n);
  for (const price of ['0', '-1', '1.0000000000000000001', '1e3']) assert.throws(() => fixed18Price(price));
});

test('CLI 参数默认 pSOL,并支持 symbol 与 run-id 任意顺序', () => {
  assert.deepEqual(parsePythBankArgs([]), { symbol: 'pSOL', runId: '' });
  assert.deepEqual(parsePythBankArgs(['--run-id', 'r4']), { symbol: 'pSOL', runId: 'r4' });
  assert.deepEqual(parsePythBankArgs(['--symbol', 'pBTC', '--run-id', 'r4']), { symbol: 'pBTC', runId: 'r4' });
  assert.deepEqual(parsePythBankArgs(['--run-id', 'r4', '--symbol', 'pETH']), { symbol: 'pETH', runId: 'r4' });
  assert.throws(() => parsePythBankArgs(['--symbol', 'DOGE']), /invalid arguments/);
});
