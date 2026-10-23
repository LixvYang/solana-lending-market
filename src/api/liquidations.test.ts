/** INPUT: fixture 交易与 PGlite。 OUTPUT: 清算字段解析、银行过滤回归。 POSITION: EP7 清算 API 集成测试。 SYNC: 同步 folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import run from '../../fixtures/m1-run.json';
import { seedApi } from './test-utils';
import { getLiquidations } from './liquidations';

test('解析剧本清算并按抵押或债务 bank 过滤', async () => {
  const db = await seedApi();
  try {
    const all = await getLiquidations(db);
    assert.equal(all.length, 1);
    const liquidation = all[0];
    assert.equal(liquidation.liquidatee_account, run.addresses.marginfiAccounts.bob);
    assert.equal(liquidation.liquidatee_label, 'bob');
    assert.equal(liquidation.asset_bank, run.addresses.banks.tSOL);
    assert.equal(liquidation.liability_bank, run.addresses.banks.tUSDC);
    assert.equal(liquidation.seized_asset, 10_000_000_000);
    assert.ok(Math.abs(liquidation.repaid_liability - 475_000_000) < 0.01);
    assert.ok(Math.abs(liquidation.pre_health - -750.0018) < 0.0001);
    assert.ok(Math.abs(liquidation.post_health - -701.2518) < 0.0001);
    assert.equal((await getLiquidations(db, { bank: run.addresses.banks.tSOL })).length, 1);
    assert.equal((await getLiquidations(db, { bank: run.addresses.banks.tUSDC })).length, 1);
    assert.equal((await getLiquidations(db, { bank: '11111111111111111111111111111111' })).length, 0);
  } finally { await db.close(); }
});
