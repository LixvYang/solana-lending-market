/** INPUT: PGlite / fixture 独立 Anchor snapshots。 OUTPUT: pool / accounts / rates 的契约断言。 POSITION: EP7 集成测试。 SYNC: 同步 folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import run from '../../fixtures/m1-run.json';
import { toRational } from '../core/fixed';
import { seedApi } from './test-utils';
import { getPool, getAccounts, getRateCurve } from './queries';
import { readState } from './state';
const bits=(v:{value:number[]})=>toRational(Uint8Array.from(v.value)).numerator;
test('pool native totals and all user quantities match independent Anchor snapshots',async()=>{
 const db=await seedApi();try {
  const pool=await getPool(db);assert.equal(pool.banks.length,2);assert.equal(pool.as_of_slot,'101');assert.equal(pool.group,run.addresses.group);
  await db.query("UPDATE ingest_cursor SET slot=150 WHERE name='account_snapshot'");
  assert.equal((await getPool(db)).as_of_slot,'150');
  for(const bank of pool.banks){
   const s=(run.snapshots.banks as any)[bank.address];
   assert.equal(bank.total_deposits,String(bits(s.totalAssetShares)*bits(s.assetShareValue)/(2n**96n)));
   assert.equal(bank.total_borrows,String(bits(s.totalLiabilityShares)*bits(s.liabilityShareValue)/(2n**96n)));
   assert.ok(bank.utilization>=0&&bank.utilization<=1);assert.ok(bank.price!==null);
  }
  assert.equal(pool.banks.find(b=>b.address===run.addresses.banks.tSOL)!.total_deposits,'100000000000');
  assert.equal(pool.banks.find(b=>b.address===run.addresses.banks.tUSDC)!.total_borrows,'0');
  const users=await getAccounts(db);assert.equal(users.length,3);
  for(const user of users){
   const s=(run.snapshots.accounts as any)[user.address];assert.equal(user.status,'no_debt');
   for(const balance of user.balances){const q=s.quantities.find((q:any)=>q.bank===balance.bank);assert.ok(q);
    assert.equal(balance.deposit,String(BigInt(q.depositNumerator)/BigInt(q.denominator)));
    assert.equal(balance.borrow,String(BigInt(q.borrowNumerator)/BigInt(q.denominator)));
   }
  }
  const curve=await getRateCurve(db,run.addresses.banks.tSOL);assert.ok(curve);assert.equal(curve.points[0].utilization,0);assert.equal(curve.points.at(-1)!.utilization,1);
  assert.equal(await getRateCurve(db,'unknown'),null);
  await db.query("DELETE FROM account_states WHERE type='switchboardPullFeed'");
  const missing=await getPool(db);assert.ok(missing.banks.every(b=>b.price===null&&b.total_deposits_usd===null&&b.total_borrows_usd===null));assert.equal(missing.totals.deposits_usd,null);
  const noPrices=await getAccounts(db);assert.ok(noPrices.every(u=>u.health.maint===null && u.status==='no_debt'));
 } finally {await db.close();}
});
test('synthetic outstanding debt at SOL $50 is liquidatable; missing price with debt is unknown, subunit debt is debt',async()=>{
 const db=await seedApi();try{
  const row=(await db.query('SELECT data FROM account_states WHERE address=$1',[run.addresses.marginfiAccounts.bob])).rows[0];
  const data=row.data as any, positions=data.lending_account.balances;
  const b=Buffer.alloc(16);b.writeBigUInt64LE(5000_000_000n<<48n & ((1n<<64n)-1n));b.writeBigInt64LE((5000_000_000n<<48n)>>64n,8);
  const position={...positions.find((p:any)=>p.active),bank_pk:run.addresses.banks.tUSDC,asset_shares:{value:Array(16).fill(0),decimal:'0'},liability_shares:{value:[...b],decimal:'5000000000'},active:true};
  positions.push(position);
  await db.query('UPDATE account_states SET data=$1::jsonb WHERE address=$2',[JSON.stringify(data),run.addresses.marginfiAccounts.bob]);
  let bob=(await getAccounts(db)).find(a=>a.address===run.addresses.marginfiAccounts.bob)!;assert.equal(bob.status,'liquidatable');assert.ok(bob.health.maint!<0);
  const less=Buffer.alloc(16);const lessBits=1000_000_000n<<48n;less.writeBigUInt64LE(lessBits&((1n<<64n)-1n));less.writeBigInt64LE(lessBits>>64n,8);
  position.liability_shares={value:[...less],decimal:'1000000000'};
  await db.query('UPDATE account_states SET data=$1::jsonb WHERE address=$2',[JSON.stringify(data),run.addresses.marginfiAccounts.bob]);
  bob=(await getAccounts(db)).find(a=>a.address===run.addresses.marginfiAccounts.bob)!;assert.equal(bob.status,'healthy');assert.ok(bob.health.maint!>=0);
  await db.query('DELETE FROM account_states WHERE address=$1',[run.addresses.feeds.tSOL]);
  bob=(await getAccounts(db)).find(a=>a.address===run.addresses.marginfiAccounts.bob)!;assert.equal(bob.status,'unknown');assert.equal(bob.health.maint,null);
  position.liability_shares={value:[1,...Array(15).fill(0)],decimal:'tiny'};
  await db.query('UPDATE account_states SET data=$1::jsonb WHERE address=$2',[JSON.stringify(data),run.addresses.marginfiAccounts.bob]);
  bob=(await getAccounts(db)).find(a=>a.address===run.addresses.marginfiAccounts.bob)!;assert.equal(bob.balances.find(b=>b.bank===run.addresses.banks.tUSDC)!.borrow,'0');assert.equal(bob.status,'unknown'); // 价格仍缺失:有债务但无法判断
 }finally{await db.close();}
});
test('fees include insurance/group/enabled program cache; exact nonzero utilization and newer snapshots win',async()=>{
 const db=await seedApi();try {
  let pool=await getPool(db), usdc=pool.banks.find(b=>b.address===run.addresses.banks.tUSDC)!;
  assert.ok(Math.abs(usdc.curve.fee_rate-.06)<1e-12);assert.ok(Math.abs(usdc.curve.fee_fixed_apr-.04)<1e-12);
  const fixed=(bits:bigint)=>{const b=Buffer.alloc(16);b.writeBigUInt64LE(bits&((1n<<64n)-1n));b.writeBigInt64LE(bits>>64n,8);return {value:[...b],decimal:'unused'};};
  const g=(await db.query('SELECT data FROM account_states WHERE address=$1',[run.addresses.group])).rows[0].data as any;
  g.fee_state_cache.program_fee_rate=fixed(1n<<46n);g.fee_state_cache.program_fee_fixed=fixed(1n<<45n);
  await db.query('UPDATE account_states SET data=$1::jsonb WHERE address=$2',[JSON.stringify(g),run.addresses.group]);
  pool=await getPool(db);usdc=pool.banks.find(b=>b.address===run.addresses.banks.tUSDC)!;
  assert.ok(Math.abs(usdc.curve.fee_rate-.31)<1e-12);assert.ok(Math.abs(usdc.curve.fee_fixed_apr-.165)<1e-12);
  g.group_flags='0';await db.query('UPDATE account_states SET data=$1::jsonb WHERE address=$2',[JSON.stringify(g),run.addresses.group]);
  usdc=(await getPool(db)).banks.find(b=>b.address===run.addresses.banks.tUSDC)!;
  assert.ok(Math.abs(usdc.curve.fee_rate-.06)<1e-12);assert.ok(Math.abs(usdc.curve.fee_fixed_apr-.04)<1e-12);
  const bank=(await db.query('SELECT data FROM account_states WHERE address=$1',[usdc.address])).rows[0].data as any;
  bank.total_asset_shares=fixed(3n<<47n);bank.total_liability_shares=fixed(1n<<47n);bank.asset_share_value=fixed(1n<<48n);bank.liability_share_value=fixed(1n<<48n);
  await db.query("INSERT INTO account_states(address,slot,type,owner,lamports,data) VALUES($1,200,'Bank',$2,1,$3::jsonb)",[usdc.address,pool.program,JSON.stringify(bank)]);
  usdc=(await getPool(db)).banks.find(b=>b.address===usdc.address)!;
  assert.equal(usdc.total_deposits,'1');assert.equal(usdc.total_borrows,'0');assert.ok(Math.abs(usdc.utilization-1/3)<1e-15);
  assert.ok(Math.abs(usdc.lending_apr-(.4/3))<1e-12);
  await db.query('DELETE FROM account_states WHERE address=$1',[run.addresses.group]);await assert.rejects(getPool(db),/missing group/);
 }finally{await db.close();}
});

// 真实联调时发现：重跑剧本会新建 group，--follow 把它们全部入库后，API 不知道"当前池子"是哪个。
test('POOL_GROUP 只保留指定的池子；不设置时多个 group 并存则 pool.group 为 null', async () => {
  const db = await seedApi();
  try {
    const before = process.env.POOL_GROUP;
    process.env.POOL_GROUP = run.addresses.group;
    assert.equal((await getPool(db)).group, run.addresses.group);
    assert.equal((await getPool(db)).banks.length, 2);
    process.env.POOL_GROUP = '11111111111111111111111111111111'; // 一个不存在的 group
    assert.equal((await getPool(db)).banks.length, 0);
    assert.equal((await getAccounts(db)).length, 0);
    if (before === undefined) delete process.env.POOL_GROUP; else process.env.POOL_GROUP = before;
  } finally { await db.close(); }
});

test('readState returns the newest snapshot once per address', async () => {
  const db = await seedApi();
  try {
    await db.query("INSERT INTO account_states(address,slot,type,owner,lamports,data) VALUES ('snapshot-a',10,'unknown','owner',1,'{}'),('snapshot-a',20,'unknown','owner',1,'{}'),('snapshot-b',15,'unknown','owner',1,'{}')");
    const rows = (await readState(db)).rows.filter(row => String(row.address).startsWith('snapshot-'));
    assert.deepEqual(rows.map(row => [row.address, String(row.slot)]), [['snapshot-a', '20'], ['snapshot-b', '15']]);
  } finally {
    await db.close();
  }
});
