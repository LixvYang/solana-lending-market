/** INPUT: PGlite、剧本 fixture 与合成历史快照。 OUTPUT: 银行变化点、历史价格与阶梯序列契约。 POSITION: EP7 历史曲线集成测试。 SYNC: 同步 folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import run from '../../fixtures/m1-run.json';
import { marginfiIdl } from '../decoder/idl';
import { seedApi } from './test-utils';
import { getBankHistory } from './queries';

test('bank history returns only changed snapshots with historical APR, USD, and transaction time', async () => {
  const db = await seedApi();
  try {
    const address = run.addresses.banks.tSOL;
    await db.query("INSERT INTO raw_tx(signature,slot,block_time,tx) VALUES('history-time',150,'2026-10-20T00:00:00Z','{}'::jsonb)");
    const row = (await db.query('SELECT data FROM account_states WHERE address=$1 ORDER BY slot DESC LIMIT 1', [address])).rows[0];
    const changed = structuredClone(row.data) as Record<string, unknown>;
    changed.last_update = '1700000200';
    await db.query("INSERT INTO account_states(address,slot,type,owner,lamports,data) VALUES($1,200,'Bank',$2,1,$3::jsonb)",
      [address, marginfiIdl.address, JSON.stringify(changed)]);
    await db.query("INSERT INTO account_states(address,slot,type,owner,lamports,data) VALUES($1,201,'Bank',$2,1,$3::jsonb)",
      [address, marginfiIdl.address, JSON.stringify(changed)]);
    const history = await getBankHistory(db, address);
    assert.ok(history);
    assert.equal(history.points.length, 2); // duplicate slot-content is omitted by lag(data)
    assert.deepEqual(history.points.map(point => point.slot), ['100', '200']);
    assert.equal(history.points[0].total_deposits, '100000000000');
    assert.equal(history.points[0].total_deposits_usd, null); // first oracle sample is slot 101
    assert.equal(history.points[1].total_deposits_usd, 5000);
    assert.ok(history.points[1].block_time);
    assert.equal(history.points[1].lending_apr, history.points[0].lending_apr);
    assert.equal(await getBankHistory(db, 'missing'), null);
  } finally { await db.close(); }
});
