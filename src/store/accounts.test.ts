/** INPUT: 账户 fixtures 与假 RPC。 OUTPUT: owner/context.slot/数据库对账断言。 POSITION: EP6 离线测试。 SYNC: 同步 folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../../fixtures/m1-accounts.json';
import txFixture from '../../fixtures/m1-transactions.json';
import { marginfiIdl } from '../decoder/idl';
import { reconcile } from '../decoder/reconcile';
import type { DecodedAccount } from '../decoder/account';
import type { DecodedEvent } from '../decoder/event';
import { pgliteDb } from './db';
import { migrate } from './migrate';
import { snapshotAccounts } from './accounts';
import { insertRawTx } from './raw';
import { decodePending, rebuildDecoded } from './decode';
import type { RawTransaction } from '../ingest/rpc';
import { fromJson } from './json';
const addresses = Object.keys(fixture.accounts);
const values = Object.values(fixture.accounts).map(a => ({ ...a, data: [a.data, 'base64'] as [string, 'base64'] }));
test('snapshots use context.slot, keep raw bytes, and database accounts/events reconcile', async () => {
  const db = pgliteDb();
  try {
    await migrate(db);
    for (const tx of Object.values(txFixture.transactions)) await insertRawTx(db, tx as RawTransaction);
    await decodePending(db, marginfiIdl);
    const rpc = { getMultipleAccounts: async () => ({ context: { slot: 123 }, value: values }) };
    await snapshotAccounts(db, rpc, addresses); await snapshotAccounts(db, rpc, addresses);
    const rows = (await db.query('SELECT * FROM account_states ORDER BY address')).rows;
    assert.equal(rows.length, 7); assert.ok(rows.every(row => row.slot === '123'));
    const accounts = Object.fromEntries(rows.map(row => [row.address, { name: row.type, data: fromJson(row.data, row.type as string, marginfiIdl) }])) as Record<string, DecodedAccount>;
    const events = (await db.query('SELECT signature, name, data, log_index AS "logIndex", ix_index AS "ixIndex" FROM events ORDER BY slot, log_index')).rows
      .map(row => ({ ...row, data: fromJson(row.data, row.name as string, marginfiIdl) })) as DecodedEvent[];
    assert.deepEqual(reconcile(events, accounts).issues, []);
    assert.ok(rows.every(row => typeof (row.data as Record<string, unknown>).raw_data === 'string'));
    await db.query("UPDATE account_states SET type = 'damaged', data = jsonb_set(data, '{group}', '\"damaged\"')");
    await rebuildDecoded(db, marginfiIdl);
    assert.deepEqual((await db.query('SELECT * FROM account_states ORDER BY address')).rows, rows);
  } finally { await db.close(); }
});
test('wrong owner or missing account rejects the whole snapshot batch without writing', async () => {
  const db = pgliteDb();
  try {
    await migrate(db);
    const bad = structuredClone(values); bad[1].owner = 'foreign';
    await assert.rejects(snapshotAccounts(db, { getMultipleAccounts: async () => ({ context: { slot: 1 }, value: bad }) }, addresses), /owner.*foreign/);
    assert.equal((await db.query('SELECT * FROM account_states')).rowCount, 0);
    await assert.rejects(snapshotAccounts(db, { getMultipleAccounts: async () => ({ context: { slot: 1 }, value: [null] }) }, [addresses[0]]), /missing/);
  } finally { await db.close(); }
});
test('unchanged account data is deduplicated while the sampled slot advances', async () => {
  const db = pgliteDb();
  try {
    await migrate(db);
    let slot = 123;
    let snapshot = values;
    const rpc = { getMultipleAccounts: async () => ({ context: { slot }, value: snapshot }) };
    await snapshotAccounts(db, rpc, addresses);
    slot = 124;
    await snapshotAccounts(db, rpc, addresses);
    assert.equal((await db.query('SELECT * FROM account_states')).rowCount, 7);
    assert.equal((await db.query("SELECT slot FROM ingest_cursor WHERE name='account_snapshot'")).rows[0].slot, '124');
    snapshot = values.map((value, i) => i === 0 ? { ...value, data: [values[1].data[0], 'base64'] as [string, 'base64'] } : value);
    slot = 125;
    await snapshotAccounts(db, rpc, addresses);
    assert.equal((await db.query('SELECT * FROM account_states')).rowCount, 8);
    assert.equal((await db.query("SELECT slot FROM ingest_cursor WHERE name='account_snapshot'")).rows[0].slot, '125');
  } finally { await db.close(); }
});
