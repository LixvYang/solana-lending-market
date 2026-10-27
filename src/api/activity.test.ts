/** INPUT: 32 fixture 交易 / PGlite。 OUTPUT: 主事件、稳定游标、失败交易断言。 POSITION: EP7 活动集成测试。 SYNC: 同步 folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import run from '../../fixtures/m1-run.json';
import txs from '../../fixtures/m1-transactions.json';
import { seedApi } from './test-utils';
import { getActivity } from './activity';
import { insertRawTx } from '../store/raw';
import { decodePending } from '../store/decode';
import { marginfiIdl } from '../decoder/idl';
import type { RawTransaction } from '../ingest/rpc';
import type { ActivityItem } from './types';
test('18 top-level rows agree with independent steps/events; pages have no gaps including slot/ix ties',async()=>{
 const db=await seedApi();try {
  const all=await getActivity(db,{limit:100});assert.equal(all.items.length,18);assert.equal(all.next_before,null);
  const names: Record<string,number>={};for(const item of all.items)names[item.instruction]=(names[item.instruction]??0)+1;
  assert.deepEqual(names,{lending_account_repay:1,lending_account_withdraw:1,lending_account_liquidate:1,lending_account_deposit:3,lending_pool_accrue_bank_interest:2,lending_account_borrow:1,marginfi_account_initialize:3,lending_pool_configure_bank_oracle:2,lending_pool_add_bank:2,marginfi_group_initialize:1,init_global_fee_state:1});
  const stepNames: [RegExp,string][]=[[/^init global fee state$/,'init_global_fee_state'],[/^create group$/,'marginfi_group_initialize'],[/^add bank /,'lending_pool_add_bank'],[/^configure oracle /,'lending_pool_configure_bank_oracle'],[/^create marginfi account /,'marginfi_account_initialize'],[/ deposit /,'lending_account_deposit'],[/ borrow /,'lending_account_borrow'],[/^accrue interest /,'lending_pool_accrue_bank_interest'],[/ liquidate /,'lending_account_liquidate'],[/ withdraw /,'lending_account_withdraw'],[/ repay /,'lending_account_repay']];
  const expected=run.steps.flatMap(s=>{const match=stepNames.find(([pattern])=>pattern.test(s.label));return match?s.signatures.map(signature=>`${signature}/${match[1]}`):[];});
  assert.deepEqual(all.items.map(i=>`${i.signature}/${i.instruction}`).sort(),expected.sort());
  for(const item of all.items){assert.ok(run.steps.some(s=>s.signatures.includes(item.signature)));
   if(item.event){const e=run.events.find(e=>e.signature===item.signature && e.name===item.event)!;assert.ok(e);const d=e.data as any;
    assert.equal(item.account,d.header.marginfiAccount??null);assert.equal(item.bank,d.bank??d.assetBank??null); // 清算事件没有 bank，取 assetBankassert.equal(item.amount,typeof d.amount==='string'?d.amount:null);
   }
  }
  const borrow=all.items.find(i=>i.instruction==='lending_account_borrow')!;assert.equal(borrow.event,'LendingAccountBorrowEvent');assert.equal(borrow.amount,'5000000000');assert.equal(borrow.account_label,'bob');
  const raw=structuredClone((txs.transactions as Record<string,unknown>)[borrow.signature]) as RawTransaction;
  raw.transaction.signatures=['Z'+borrow.signature.slice(1)];raw.meta!.err={InstructionError:[borrow.ix_index,'failed']};await insertRawTx(db,raw);await decodePending(db,marginfiIdl);
  // 同 slot 下增加另一个顶层位置；相同 slot/ix 下的另一个签名由稳定第三键区分。
  await db.query('INSERT INTO instructions SELECT signature,ix_index+1,inner_index,slot,block_time,stack_height,name,args,accounts,remaining,decode_error FROM instructions WHERE signature=$1',[raw.transaction.signatures[0]]);
  const full=(await getActivity(db,{limit:100})).items;const pages: ActivityItem[]=[];let before: string | undefined;
  do{const p=await getActivity(db,{limit:2,before});pages.push(...p.items);before=p.next_before??undefined;}while(before);
  assert.deepEqual(pages,full);assert.equal(new Set(pages.map(i=>`${i.signature}/${i.ix_index}`)).size,pages.length);
  assert.ok(pages.filter(i=>i.signature===raw.transaction.signatures[0]).every(i=>!i.ok&&i.event===null));
  for(const limit of [0,101,NaN,1.5])await assert.rejects(getActivity(db,{limit}));
  for(const before of ['bad','1:0:','9223372036854775808:0:abc'])await assert.rejects(getActivity(db,{before}));
 }finally{await db.close();}
});

// 真实联调时发现：清算事件没有 bank 字段，活动流里这一行的代币曾是空的。
test('清算行的 bank 取被清算资产所在的 bank(tSOL)，数量为 null(f64 事件)', async () => {
  const db = await seedApi();
  try {
    const liquidation = (await getActivity(db, { limit: 100 })).items.find(i => i.instruction === 'lending_account_liquidate')!;
    assert.equal(liquidation.bank, run.addresses.banks.tSOL);
    assert.equal(liquidation.amount, null);
  } finally { await db.close(); }
});

test('按 bank 过滤流水；清算同时出现在抵押资产和债务资产中', async () => {
  const db = await seedApi();
  try {
    const tsol = await getActivity(db, { limit: 100, bank: run.addresses.banks.tSOL });
    const tusdc = await getActivity(db, { limit: 100, bank: run.addresses.banks.tUSDC });
    assert.ok(tsol.items.length > 0);
    assert.ok(tusdc.items.length > 0);
    assert.ok(tsol.items.every(i => i.bank === run.addresses.banks.tSOL));
    assert.ok(tusdc.items.every(i => i.bank === run.addresses.banks.tUSDC));
    assert.ok(tsol.items.some(i => i.instruction === 'lending_account_liquidate'));
    assert.ok(tusdc.items.some(i => i.instruction === 'lending_account_liquidate'));
  } finally { await db.close(); }
});

// 清算里程序会对两个银行各计一次息，计息事件带 bank 字段，曾掩盖了清算事件字段名写错(assetBank vs asset_bank)。
test('清算只靠清算事件本身的 asset_bank / liability_bank 也能按 bank 查到', async () => {
  const db = await seedApi();
  try {
    await db.query(`DELETE FROM events e USING events l WHERE l.signature=e.signature AND l.ix_index=e.ix_index
      AND l.name='LendingAccountLiquidateEvent' AND e.name<>'LendingAccountLiquidateEvent'`);
    for (const bank of [run.addresses.banks.tSOL, run.addresses.banks.tUSDC])
      assert.ok((await getActivity(db, { limit: 100, bank })).items.some(i => i.instruction === 'lending_account_liquidate'), bank);
  } finally { await db.close(); }
});

test('按活动类型过滤并可与 bank、分页游标组合', async () => {
  const db = await seedApi();
  try {
    const supply = await getActivity(db, { limit: 100, kind: 'supply' });
    assert.ok(supply.items.length > 0);
    assert.ok(supply.items.every(i => ['lending_account_deposit', 'lending_account_withdraw'].includes(i.instruction)));
    const borrow = await getActivity(db, { limit: 100, kind: 'borrow' });
    assert.ok(borrow.items.length > 0);
    assert.ok(borrow.items.every(i => ['lending_account_borrow', 'lending_account_repay'].includes(i.instruction)));
    const liquidate = await getActivity(db, { limit: 100, kind: 'liquidate' });
    assert.deepEqual(liquidate.items.map(i => i.instruction), ['lending_account_liquidate']);
    const bankAndKind = await getActivity(db, { limit: 100, kind: 'borrow', bank: run.addresses.banks.tUSDC });
    assert.ok(bankAndKind.items.length > 0);
    assert.ok(bankAndKind.items.every(i => ['lending_account_borrow', 'lending_account_repay'].includes(i.instruction) && i.bank === run.addresses.banks.tUSDC));
    const page = await getActivity(db, { limit: 1, kind: 'supply' });
    assert.ok(page.next_before);
    const next = await getActivity(db, { limit: 100, kind: 'supply', before: page.next_before! });
    assert.ok(next.items.every(i => ['lending_account_deposit', 'lending_account_withdraw'].includes(i.instruction)));
    await assert.rejects(getActivity(db, { kind: 'other' as never }), /invalid activity kind/);
  } finally { await db.close(); }
});
