/** INPUT: PGlite、账户/borrow fixtures、假 RPC。 OUTPUT: M7 构建金标准。 POSITION: EP8 离线验收。 SYNC: folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { verify, createPublicKey } from 'node:crypto';
import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { deriveKeypair } from '../../../scenario/lib/actors';
import { seedApi } from '../test-utils';
import { addresses as a, services, builtTx, decodedInstructions, feedInfo, mockOwner } from '../wallet-test-utils';
import { buildTransaction, PriceStale } from './index';
import { walletAccount } from './state';
import { remainingBanks } from './remaining';
import { layout } from '../../decoder/layout';
import { marginfiIdl } from '../../decoder/idl';
import { decodeAccount } from '../../decoder/account';
import { decodeTransaction } from '../../decoder/transaction';
import { transactionFor } from '../../decoder/test-utils';
import { accountData, snapshotAccounts } from '../../store/accounts';
import { decodePriceUpdate } from '../../decoder/pyth';
import { PYTH_RECEIVER } from '../../oracle/pyth';
import { toJson } from '../../store/json';
import type { Db } from '../../store/db';
import type { Position } from '../state';
import { formatAmount } from '../wallet-input';
async function preBorrow(db: Db) {
  const row = (await db.query('SELECT data FROM account_states WHERE address=$1', [a.marginfiAccounts.bob])).rows[0];
  const raw = Buffer.from((row.data as { raw_data: string }).raw_data, 'base64');
  const lending = layout('MarginfiAccount', marginfiIdl).fields!.find(f => f.name === 'lending_account')!;
  const balanceArray = layout('LendingAccount', marginfiIdl).fields!.find(f => f.name === 'balances')!;
  const stride = layout('Balance', marginfiIdl).size, offset = 8 + lending.offset + balanceArray.offset;
  const decoded = decodeAccount(raw, marginfiIdl); assert.ok('data' in decoded);
  const positions = (decoded.data as unknown as { lending_account: { balances: Position[] } }).lending_account.balances;
  positions.forEach((p, i) => { if (p.bank_pk === a.banks.tUSDC) raw.fill(0, offset + stride * i, offset + stride * (i + 1)); });
  await db.query('UPDATE account_states SET data=$1::jsonb WHERE address=$2', [toJson(accountData(raw.toString('base64'), marginfiIdl).data), a.marginfiAccounts.bob]);
}
const borrow = { action: 'borrow', wallet: a.actors.bob, bank: a.banks.tUSDC, amount: '5000000000' };
test('borrow pre-state fixture matches every named account and ordered remaining of real borrow', async () => {
  const db = await seedApi(); try {
    await preBorrow(db);
    const response = await buildTransaction(db, services(), borrow), tx = builtTx(response.transaction), decoded = decodedInstructions(tx)[0];
    assert.ok('args' in decoded); assert.equal(decoded.name, 'lending_account_borrow');
    const golden = decodeTransaction(transactionFor('bob borrow 5000 tUSDC'), marginfiIdl)[0]; assert.ok('args' in golden);
    // 同一个 Bob/ATA：比较全部固定角色(group/account/signer/bank/vault/authority/token program/ATA)，没有排除角色。
    // payer 与 ComputeBudget/ATA 创建属于外围指令，不在 marginfi 指令账户列表里。
    assert.deepEqual(decoded.accounts, golden.accounts);
    assert.deepEqual(decoded.remaining, [a.banks.tSOL, a.feeds.tSOL, a.banks.tUSDC, a.feeds.tUSDC]);
    assert.deepEqual(decoded.remaining, golden.remaining); assert.deepEqual(decoded.args, golden.args);
    assert.equal(tx.version, 0); assert.equal(tx.message.staticAccountKeys[0].toBase58(), a.actors.bob);
    assert.equal(tx.message.staticAccountKeys[tx.message.compiledInstructions[0].programIdIndex].toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());
    assert.deepEqual([...tx.message.compiledInstructions[1].data], [2, 128, 26, 6, 0]);
    assert.equal(response.last_valid_block_height, 999); assert.equal(response.summary, '借出 5,000 tUSDC');
  } finally { await db.close(); }
});
test('first inactive slot is filled before later active bank; withdraw_all removes closed slot', () => {
  const positions = [{ active: false, bank_pk: '' }, { active: true, bank_pk: a.banks.tSOL }] as Position[];
  assert.deepEqual(remainingBanks(positions, 'borrow', a.banks.tUSDC, false), [a.banks.tUSDC, a.banks.tSOL]);
  assert.deepEqual(remainingBanks(positions, 'withdraw', a.banks.tSOL, true), []);
  assert.deepEqual(remainingBanks(positions, 'withdraw', a.banks.tSOL, false), [a.banks.tSOL]);
  assert.throws(() => remainingBanks([{ active: true, bank_pk: a.banks.tSOL }] as Position[], 'borrow', a.banks.tUSDC, false));
});
test('first deposit includes init, one-time valid partial signature and zero user signature; existing skips init', async () => {
  const db = await seedApi(); try {
    const wallet = deriveKeypair('m7/new-user').publicKey.toBase58();
    const first = await buildTransaction(db, services(), { action: 'deposit', wallet, bank: a.banks.tUSDC, amount: '1000000000' });
    const tx = builtTx(first.transaction), decoded = decodedInstructions(tx);
    assert.equal(first.creates_account, true); assert.deepEqual(decoded.map(d => d.name), ['marginfi_account_initialize', 'lending_account_deposit']);
    assert.equal(tx.message.header.numRequiredSignatures, 2); assert.ok(tx.signatures[0].every(b => b === 0));
    const index = tx.message.staticAccountKeys.findIndex(k => k.toBase58() === first.marginfi_account);
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), tx.message.staticAccountKeys[index].toBuffer()]), format: 'der', type: 'spki' });
    assert.ok(verify(null, tx.message.serialize(), key, tx.signatures[index]));
    assert.ok('args' in decoded[0]); assert.equal(decoded[0].accounts.fee_payer, wallet); assert.equal(decoded[0].accounts.authority, wallet);
    assert.equal(first.summary, '存入 1,000 tUSDC');
    const existing = await buildTransaction(db, services(), { action: 'deposit', wallet: a.actors.alice, bank: a.banks.tUSDC, amount: '1' });
    assert.equal(existing.creates_account, false); assert.deepEqual(decodedInstructions(builtTx(existing.transaction)).map(d => d.name), ['lending_account_deposit']);
    for (const action of ['borrow', 'withdraw', 'repay']) await assert.rejects(buildTransaction(db, services(), { action, wallet, bank: a.banks.tUSDC, amount: '1' }), /deposit first/);
  } finally { await db.close(); }
});
test('all four lending actions and optional all roundtrip decoder with exact u64 and simulate options', async () => {
  const db = await seedApi(); try {
    const seen: unknown[] = [], svc = services({ simulateTransaction: (async (_tx: unknown, options: unknown) => {
      seen.push(options); return { context: { slot: 1 }, value: { err: null, logs: [], unitsConsumed: 999 } };
    }) as never });
    for (const action of ['deposit', 'borrow', 'withdraw', 'repay'] as const) for (const all of [false, true]) {
      if (all && (action === 'borrow' || action === 'deposit')) continue;
      const response = await buildTransaction(db, svc, { action, wallet: a.actors.bob, bank: a.banks.tUSDC, amount: all ? 'ignored' : '18446744073709551615', all });
      const decoded = decodedInstructions(builtTx(response.transaction))[0]; assert.ok('args' in decoded);
      assert.equal(decoded.name, `lending_account_${action}`); assert.equal(decoded.args.amount, all ? 0n : 18446744073709551615n);
      if (action === 'withdraw' || action === 'repay') assert.equal(decoded.args[`${action}_all`], all);
      assert.equal(response.simulation.units_consumed, 999);
    }
    assert.equal(seen.length, 6); for (const options of seen) assert.deepEqual(options, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' });
    assert.equal(formatAmount(18446744073709551615n, 6), '18,446,744,073,709.551615');
    const other = PublicKey.default.toBase58();
    await assert.rejects(buildTransaction(db, svc, { ...borrow, bank: other }), /outside pool/);
    for (const amount of ['-1', '0', '1.1', '18446744073709551616']) await assert.rejects(buildTransaction(db, svc, { ...borrow, amount }), /positive u64/);
    await assert.rejects(buildTransaction(db, svc, { ...borrow, all: true }), /all requires/);
  } finally { await db.close(); }
});
// 用户撞到的真实问题:价格维护进程连续失败后退出,价格过期,借款/取款报"价格维护进程没有运行"。
// 这不该让用户感知。构建器现在在价格不够新时,把"刷新时间戳"的指令放进这笔交易里。
import { TIMESTAMP_OFFSET } from '../../oracle/mock-write';
import { mockFeedSigner } from '../../oracle/mock-write';
import { OFFSET } from '../../decoder/switchboard';
import { createHash } from 'node:crypto';
const writeDisc = createHash('sha256').update('global:write').digest().subarray(0, 8);
const refreshesIn = (tx: VersionedTransaction) => {
  const keys = tx.message.staticAccountKeys;
  return tx.message.compiledInstructions.filter(ix => Buffer.from(ix.data).subarray(0, 8).equals(writeDisc)).map(ix => ({
    program: keys[ix.programIdIndex].toBase58(), feed: keys[ix.accountKeyIndexes[0]].toBase58(),
    offset: Number(Buffer.from(ix.data).readBigUInt64LE(8)), length: Buffer.from(ix.data).readUInt32LE(16), value: Buffer.from(ix.data).subarray(20) }));
};
const signedBy = (tx: VersionedTransaction, key: string) => {
  const index = tx.message.staticAccountKeys.findIndex(k => k.toBase58() === key);
  return index >= 0 && index < tx.message.header.numRequiredSignatures && tx.signatures[index].some(b => b !== 0);
};
test('价格过旧或在未来时,自动在交易里刷新时间戳:只写 8 字节、价格数值不动、价格账户由服务端代签、用户无感', async () => {
  const db = await seedApi(); try {
    await preBorrow(db);
    for (const timestamp of [1699999000, 1700000001, 1699999879]) { // 过旧 1000 秒 / 在未来 / 121 秒前
      const response = await buildTransaction(db, services({ getAccountInfo: async () => feedInfo(timestamp) }), borrow);
      const tx = builtTx(response.transaction), writes = refreshesIn(tx);
      assert.ok(writes.length >= 1, `timestamp ${timestamp} 应该触发刷新`);
      for (const w of writes) {
        assert.equal(w.program, mockOwner.toBase58());
        assert.equal(w.offset, TIMESTAMP_OFFSET); assert.equal(w.length, 8); assert.equal(w.value.length, 8); // 只动时间戳
        assert.equal(w.value.readBigInt64LE(0), 1_700_000_000n);                                            // 刷新到"现在"
        assert.ok(w.offset + 8 <= OFFSET.result, '没有碰到结果值(价格)所在的区域');
        assert.ok(signedBy(tx, w.feed), '价格账户的签名由服务端补上');
      }
      assert.equal(decodedInstructions(tx)[0].name, 'lending_account_borrow'); // 业务指令仍在
      assert.ok(tx.serialize().length <= 1232);
    }
  } finally { await db.close(); }
});
test('价格够新时不刷新:交易保持最小', async () => {
  const db = await seedApi(); try {
    await preBorrow(db);
    for (const timestamp of [1700000000, 1699999980, 1699999970]) { // 刚更新 / 20 秒前 / 30 秒前
      const response = await buildTransaction(db, services({ getAccountInfo: async () => feedInfo(timestamp) }), borrow);
      assert.equal(refreshesIn(builtTx(response.transaction)).length, 0, `age ${1700000000 - timestamp}s 不需要刷新`);
    }
  } finally { await db.close(); }
});
test('不能刷新的才报 PriceStale(且文案不提内部细节):没有价格账户、从未有过价格、不是我们的 mock', async () => {
  const db = await seedApi(); try {
    await preBorrow(db);
    for (const svc of [services({ getAccountInfo: async () => null }),                                   // 账户不存在
      services({ getAccountInfo: async () => ({ ...feedInfo(1), owner: PublicKey.default }) })]) {         // owner 不在允许集合
      await assert.rejects(buildTransaction(db, svc, borrow), (e: unknown) => e instanceof PriceStale && e.status === 409
        && e.code === 'PRICE_UNAVAILABLE' && !/维护|进程|keeper/.test(e.message));
    }
    // 从未有过价格(sample_size 为 0)
    const never = feedInfo(1700000000); never.data[2215] = 0;
    await assert.rejects(buildTransaction(db, services({ getAccountInfo: async () => never }), borrow), PriceStale);
    // 不是我们的 mock(密钥不是公开派生的)就不能代为刷新
    assert.equal(mockFeedSigner(Keypair.generate().publicKey), null);
    assert.ok(mockFeedSigner(new PublicKey(a.feeds.tSOL)));
    assert.ok(mockFeedSigner(new PublicKey(a.feeds.tUSDC)));
    assert.ok(mockFeedSigner(deriveKeypair('feed/tHYPE').publicKey));
  } finally { await db.close(); }
});
test('simulation failure still returns transaction; custom IDL translations, unknown, sanitized logs', async () => {
  const db = await seedApi(); try {
    for (const code of [6010, 6017, 6029, 9999]) {
      const svc = services({ simulateTransaction: (async () => ({ context: { slot: 1 }, value: { err: { InstructionError: [2, { Custom: code }] }, logs: ['RPC_URL https://rpc?api-key=secret PRIVATE_KEY=abc'], unitsConsumed: 300 } })) as never });
      const response = await buildTransaction(db, svc, borrow);
      assert.ok(response.transaction); assert.equal(response.simulation.ok, false); assert.equal(response.simulation.error?.code, code);
      assert.equal(response.simulation.error?.name, ({ 6010: 'RiskEngineInitRejected', 6017: 'StaleOracle', 6029: 'BankLiabilityCapacityExceeded' } as Record<number, string>)[code] ?? 'Unknown');
      assert.ok(!/RPC_URL|api-key|secret|PRIVATE_KEY/.test(JSON.stringify(response))); assert.match(response.simulation.error!.message, /[\u4e00-\u9fff]/);
    }
  } finally { await db.close(); }
});

test('wallet account selects newest group/authority state and never resurrects old authority', async () => {
  const db = await seedApi(); try {
    const row = (await db.query('SELECT * FROM account_states WHERE address=$1', [a.marginfiAccounts.bob])).rows[0];
    const raw = Buffer.from((row.data as { raw_data: string }).raw_data, 'base64');
    const authority = layout('MarginfiAccount', marginfiIdl).fields!.find(f => f.name === 'authority')!;
    const fresh = deriveKeypair('m7/changed-authority').publicKey;
    fresh.toBuffer().copy(raw, 8 + authority.offset);
    await db.query('INSERT INTO account_states(address,slot,type,owner,lamports,data) VALUES($1,200,$2,$3,$4,$5::jsonb)',
      [row.address, row.type, row.owner, row.lamports, toJson(accountData(raw.toString('base64'), marginfiIdl).data)]);
    assert.equal(await walletAccount(db, a.actors.bob, a.group), null);
    assert.equal((await walletAccount(db, fresh.toBase58(), a.group))?.address, a.marginfiAccounts.bob);
    assert.equal(await walletAccount(db, fresh.toBase58(), PublicKey.default.toBase58()), null);
  } finally { await db.close(); }
});

// 真实使用中的问题：索引器有延迟。用户刚存完款，数据库里还没有他的账户时，若只看数据库，
// 构建器会把下一次存款当成"首次"而重复创建账户；快照里的余额槽位过期还会让 remaining 顺序出错。
import { chainWalletAccount } from './state';
import accountsFixture from '../../../fixtures/m1-accounts.json';
test('readUserFromChain：数据库没有账户时按 group+authority 在链上找到，并用链上最新字节；链上没有才算首次', async () => {
  const db = await seedApi(); try {
    await db.query("DELETE FROM account_states WHERE type = 'MarginfiAccount'"); // 模拟索引器还没追上
    const bobAddress = a.marginfiAccounts.bob;
    const bytes = Buffer.from((accountsFixture.accounts as Record<string, { data: string }>)[bobAddress].data, 'base64');
    const queried: unknown[] = [];
    const rpc = services({
      getProgramAccounts: (async (_program: unknown, config: { filters: unknown[] }) => { queried.push(config.filters); return [{ pubkey: new PublicKey(bobAddress), account: {} }]; }) as never,
      getAccountInfo: (async (key: PublicKey) => key.toBase58() === bobAddress
        ? { data: bytes, owner: new PublicKey(marginfiIdl.address), lamports: 1, executable: false, rentEpoch: 0 } : null) as never,
    }).rpc;
    const found = await chainWalletAccount(db, rpc, a.actors.bob, a.group);
    assert.equal(found?.address, bobAddress);
    // 过滤条件：账户大小 + group + authority 三项
    assert.equal((queried[0] as unknown[]).length, 3);
    // 链上没有 → 当作没有账户(首次)
    const none = await chainWalletAccount(db, services({ getProgramAccounts: (async () => []) as never }).rpc, a.actors.bob, a.group);
    assert.equal(none, null);
    // 构建：数据库为空但链上有账户 → 不再创建新账户
    const response = await buildTransaction(db, { ...services({
      getProgramAccounts: (async () => [{ pubkey: new PublicKey(bobAddress), account: {} }]) as never,
      getAccountInfo: (async (key: PublicKey) => key.toBase58() === bobAddress
        ? { data: bytes, owner: new PublicKey(marginfiIdl.address), lamports: 1, executable: false, rentEpoch: 0 } : null) as never,
    }), readUserFromChain: true }, { action: 'deposit', wallet: a.actors.bob, bank: a.banks.tUSDC, amount: '1000000' });
    assert.equal(response.creates_account, false);
    assert.equal(response.marginfi_account, bobAddress);
  } finally { await db.close(); }
});

/** 真实 pSOL 银行 + 验证账户 A(存 pSOL、借 tUSDC)放进库里;Pyth 价格账户由假 RPC 返回真实字节。 */
async function seedPyth(db: Db) {
  const fixture = (await import('../../../fixtures/pyth-accounts.json')).default;
  const accounts = fixture.accounts as Record<string, { owner: string; lamports: number; data: string }>;
  const by = Object.fromEntries(Object.entries(fixture.names).map(([address, name]) => [name, address]));
  await snapshotAccounts(db, { getMultipleAccounts: async list => ({ context: { slot: fixture.slot },
    value: list.map(x => ({ ...accounts[x], data: [accounts[x].data, 'base64'] as [string, 'base64'] })) }) }, [by.bank_pSOL, by.bank_tUSDC, by.account_A]);
  const user = decodeAccount(Buffer.from(accounts[by.account_A].data, 'base64'), marginfiIdl); assert.ok('data' in user);
  const pythInfo = { data: Buffer.from(accounts[by.pyth_SOL_USD].data, 'base64'), owner: PYTH_RECEIVER, lamports: 1, executable: false, rentEpoch: 0 };
  const svc = (blockTime: number) => ({ ...services({ getAccountInfo: (async (key: PublicKey) => key.toBase58() === by.pyth_SOL_USD ? pythInfo
    : Object.values(a.feeds).includes(key.toBase58()) ? feedInfo(blockTime) : null) as never,
    getSlot: (async () => 1) as never, getBlockTime: (async () => blockTime) as never }), oracleOwners: new Set([mockOwner.toBase58(), PYTH_RECEIVER.toBase58()]) });
  return { by, wallet: (user.data as unknown as { authority: string }).authority, published: Number(decodePriceUpdate(pythInfo.data).publish_time), svc };
}
test('Pyth 银行:remaining 里传换算出的价格账户(不是 oracle_keys 里的 feed id);价格够新不加任何写指令', async () => {
  const db = await seedApi(); try {
    const { by, wallet, published, svc } = await seedPyth(db);
    const response = await buildTransaction(db, svc(published + 10), { action: 'borrow', wallet, bank: by.bank_tUSDC, amount: '1000000' });
    const decoded = decodedInstructions(builtTx(response.transaction)); assert.ok('args' in decoded[0]);
    assert.deepEqual(decoded[0].remaining, [by.bank_pSOL, by.pyth_SOL_USD, by.bank_tUSDC, a.feeds.tUSDC]);
    assert.equal(response.summary, '借出 1 tUSDC');
  } finally { await db.close(); }
});
test('Pyth 价格超过银行的 oracle_max_age(300 秒)时拒绝构建:我们写不了 Pyth 账户,只能如实让用户稍后再试', async () => {
  const db = await seedApi(); try {
    const { by, wallet, published, svc } = await seedPyth(db);
    await buildTransaction(db, svc(published + 300), { action: 'borrow', wallet, bank: by.bank_tUSDC, amount: '1000000' }); // 恰好 300 秒仍可用
    await assert.rejects(buildTransaction(db, svc(published + 301), { action: 'borrow', wallet, bank: by.bank_tUSDC, amount: '1000000' }),
      (e: unknown) => e instanceof PriceStale && e.code === 'PRICE_UNAVAILABLE' && /Pyth/.test(e.message));
    // 存款不看价格,Pyth 过期也照常构建。
    await buildTransaction(db, svc(published + 10_000), { action: 'deposit', wallet, bank: by.bank_pSOL, amount: '1' });
  } finally { await db.close(); }
});
