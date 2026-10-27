import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { demoKeyPath, netPosition, positionPlan, rateCurve, rateCurveSummary } from './demo-config';

test('利率曲线参数以 I80F48 编码并按 tUSDC 与波动资产区分', () => {
  const decode = (value: { value: number[] }) => Number(Buffer.from(value.value).readBigUInt64LE(0)) / 2 ** 48;
  const stable = rateCurve('tUSDC'), volatile = rateCurve('pSOL');
  const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-10);
  close(decode(stable.optimalUtilizationRate), 0.8);
  close(decode(stable.plateauInterestRate), 0.07);
  close(decode(stable.maxInterestRate), 1);
  close(decode(volatile.optimalUtilizationRate), 0.45);
  close(decode(volatile.plateauInterestRate), 0.08);
  close(decode(volatile.maxInterestRate), 1.5);
  close(decode(stable.protocolIrFee), 0.05);
  assert.equal(stable.protocolOriginationFee, null);
  assert.match(rateCurveSummary('tUSDC'), /optimal=80% plateau=7% max=100%/);
  assert.match(rateCurveSummary('pSOL'), /optimal=45% plateau=8% max=150%/);
});

test('播种计划只补目标与已有头寸之间的正差额', () => {
  assert.deepEqual(positionPlan({ deposits: { tSOL: '10', pBTC: '0.3' }, borrows: { tUSDC: '100' } },
    { deposits: { tSOL: '4' }, borrows: { tUSDC: '120' } }),
  { deposits: { tSOL: '6', pBTC: '0.3' }, borrows: {} });
});

test('同一 marginfi 账户同一银行的存借目标按净头寸处理', () => {
  assert.deepEqual(netPosition({ deposits: { tSOL: '200', pSOL: '80' }, borrows: { tSOL: '45' } }),
    { deposits: { pSOL: '80', tSOL: '155' }, borrows: {} });
});

test('演示私钥路径位于用户配置目录且不会通过仓库路径生成', () => {
  assert.equal(demoKeyPath('demo-lender', '/Users/alice'), '/Users/alice/.config/solana/lending-market-demo/demo-lender.json');
  assert.throws(() => demoKeyPath('arbitrary', '/Users/alice'));
  assert.equal(JSON.parse(JSON.stringify([...Keypair.generate().secretKey])).length, 64);
});

test('链上份额换算的截断误差不产生灰尘交易', () => {
  const plan = positionPlan({ deposits: { tSOL: '155' }, borrows: { tUSDC: '4000' } },
    { deposits: { tSOL: '154.999999999' }, borrows: { tUSDC: '3999.999999' } });
  assert.deepEqual(plan, { deposits: {}, borrows: {} });
});
