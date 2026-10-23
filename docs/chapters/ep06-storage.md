# EP6 存储设计

## 本集要回答的问题

怎样存数据,才能做到:**同一批数据入库两次、中途崩溃后重跑、清库后重新来过,结果完全一样**?

## 三条原则

**1. 先存原始,再解码。** `raw_tx` 保存 RPC 返回的完整交易 JSON,它是**唯一的事实来源**。指令表、事件表都是从它**算出来**的,随时可以清空重建。解码器写错了,改完重放,不用重新拉链上数据。

**2. 一切写入都幂等。** 主键由链上事实决定,重复写入什么都不发生。

**3. 游标和数据在同一个事务里推进。** 要么这个 slot 的数据和游标一起落库,要么都不落。

## 表结构

<!-- snippet: src/store/migrations/002_decoded.sql#ep6-schema -->
```sql
ALTER TABLE raw_tx ADD COLUMN decoded_version INT;

-- signature + 顶层位置 + CPI 位置确定一次指令调用。
-- 顶层用 -1：NULL 的普通唯一性比较不相等，且 PRIMARY KEY 禁止 NULL。
CREATE TABLE instructions (
  signature TEXT NOT NULL REFERENCES raw_tx(signature) ON DELETE CASCADE,
  ix_index INT NOT NULL, inner_index INT NOT NULL DEFAULT -1,
  slot BIGINT NOT NULL, block_time TIMESTAMPTZ, stack_height INT,
  name TEXT NOT NULL, args JSONB NOT NULL, accounts JSONB NOT NULL,
  remaining JSONB NOT NULL, decode_error TEXT,
  PRIMARY KEY (signature, ix_index, inner_index)
);

-- 同一交易日志里的位置唯一；同一顶层指令可以 emit 多个事件。
CREATE TABLE events (
  signature TEXT NOT NULL REFERENCES raw_tx(signature) ON DELETE CASCADE,
  log_index INT NOT NULL, ix_index INT NOT NULL, slot BIGINT NOT NULL,
  block_time TIMESTAMPTZ, name TEXT NOT NULL, data JSONB NOT NULL,
  truncated BOOL NOT NULL,
  PRIMARY KEY (signature, log_index)
);
-- 同一地址同一 context.slot 是一次快照；原始字节存在 data 的 raw_data，支持再解码。
CREATE TABLE account_states (
  address TEXT NOT NULL, slot BIGINT NOT NULL, type TEXT NOT NULL,
  owner TEXT NOT NULL, lamports BIGINT NOT NULL, data JSONB NOT NULL,
  PRIMARY KEY (address, slot)
);
```
<!-- /snippet -->

几个设计取舍:

- **`inner_index` 用 `-1` 表示顶层指令,而不是 `NULL`。** 主键里的 `NULL` 不参与唯一性比较,两行 `NULL` 可以同时存在,幂等就破了。
- **失败的交易也进 `raw_tx`。** `err` 非空,它们是事实;只是解码时不产出事件。成功交易的 `err` 必须是 SQL 的 `NULL`,不是 JSON 的 `null`(这是真实联调里踩过的坑,见下)。
- **解码结果带版本号。** `raw_tx.decoded_version` 记录这一行是被哪一版解码器解码的。升级解码器后,只重做旧版本的行。
- **账户状态只存快照。** RPC 只给**当前**状态,历史状态需要在每笔交易之后各取一次。我们不做,在 README 的"局限"里写明。

## 代码走读

### 幂等入库

<!-- snippet: src/store/raw.ts#ep6-idempotent-insert -->
```ts
/** finalized=false 表示乐观入库(confirmed):之后要由终局清扫确认或删除。默认 true,与此前的行为一致。 */
export async function insertRawTx(db: Db, tx: RawTransaction, finalized = true): Promise<boolean> {
  const signature = tx.transaction.signatures[0];
  if (!signature || !Number.isSafeInteger(tx.slot) || tx.slot < 0) throw new Error('invalid transaction signature/slot');
  const result = await db.query(`INSERT INTO raw_tx(signature, slot, block_time, err, tx, finalized)
    VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
    ON CONFLICT (signature) DO NOTHING RETURNING signature`,
  [signature, tx.slot, tx.blockTime == null ? null : new Date(tx.blockTime * 1000),
    // 成功交易的 err 必须是 SQL NULL；toJson(null) 会得到 JSONB 的 null(不是 SQL NULL)，
    // 那样 `WHERE err IS NULL` 一笔成功交易都查不到。真实 Postgres 上才发现的 bug。
    tx.meta?.err == null ? null : toJson(tx.meta.err), toJson(tx), finalized]);
  return result.rows.length === 1;
}
```
<!-- /snippet -->

> **后续增补**(第 8 集代码定稿 `ep8-end` 之后才加的,只在 `main` 上,各集 tag 里没有):上面的 `finalized` 参数是为实时跟随按 confirmed 乐观入库加的(EP8「页面多快能反映出你刚发的交易」、D-017);`ep6-end` 里的版本没有它,行为等同于 `finalized = true`。

### 游标与原始数据同事务

<!-- snippet: src/ingest/tail.ts#ep6-cursor-tx -->
```ts
inserted += await db.transaction(async tx => {
  await tx.query("INSERT INTO ingest_cursor(name, slot) VALUES ('blocks', $1) ON CONFLICT (name) DO NOTHING", [initial]);
  const current = (await tx.query("SELECT slot FROM ingest_cursor WHERE name = 'blocks' FOR UPDATE")).rows[0];
  if (Number(current.slot) >= slot) return 0;
  let count = 0;
  for (const transaction of transactions) if (await insertRawTx(tx, transaction)) count++;
  // 空块/跳过 slot 也推进；异常会同时回滚本 slot 的 raw_tx 与游标。
  await tx.query("UPDATE ingest_cursor SET slot = $1 WHERE name = 'blocks'", [slot]);
  return count;
});
```
<!-- /snippet -->

空 slot、被跳过的 slot 也要推进游标。**中途出错,这个 slot 的数据和游标一起回滚**,重跑时从原来的位置继续,既不重复也不遗漏。

### 重建解码表

<!-- snippet: src/store/decode.ts#ep6-rebuild -->
```ts
export function rebuildDecoded(db: Db, idl: Idl): Promise<number> {
  return db.transaction(async tx => {
    await tx.query('DELETE FROM instructions');
    await tx.query('DELETE FROM events');
    await tx.query('UPDATE raw_tx SET decoded_version = NULL');
    // account_states 同时保留原始快照，不能删掉唯一的历史字节。
    const states = (await tx.query('SELECT address, slot, data FROM account_states')).rows;
    for (const state of states) {
      const { type, data } = accountData((state.data as { raw_data: string }).raw_data, idl);
      await tx.query('UPDATE account_states SET type = $1, data = $2::jsonb WHERE address = $3 AND slot = $4',
        [type, toJson(data), state.address, state.slot]);
    }
    return pending(tx, idl);
  });
}
```
<!-- /snippet -->

### 账户快照要检查 owner

解码器只收字节,不知道这个账户属于谁。别人可以造一个格式一模一样的账户,所以**入库前必须检查它的 owner 是 marginfi 程序**:

<!-- snippet: src/store/accounts.ts#ep6-owner-check -->
```ts
export async function snapshotAccounts(db: Db, rpc: AccountRpc, addresses: string[], idl = marginfiIdl, skipMissing = false): Promise<number> {
  const unique = [...new Set(addresses)];
  let count = 0;
  // getMultipleAccounts 每次最多 100 个；每批使用自己的 context.slot，不假装不同批次同时采样。
  for (let start = 0; start < unique.length; start += 100) {
    const batch = unique.slice(start, start + 100), response = await rpc.getMultipleAccounts(batch);
    if (response.value.length !== batch.length) throw new Error('account response length mismatch');
    const states = batch.flatMap((address, i) => {
      const account = response.value[i];
      if (!account) {
        if (!skipMissing) throw new Error(`missing account ${address}`);
        // 历史账户可已关闭；CLI 报告缺失但不拿旧快照冒充当前状态。
        console.error(`missing account ${address} at finalized slot ${response.context.slot}; snapshot skipped`);
        return [];
      }
      if (account.owner !== idl.address) throw new Error(`owner mismatch ${address}: ${account.owner}`);
      if (account.data[1] !== 'base64') throw new Error(`unexpected account encoding ${address}`);
      return [{ address, account, ...accountData(account.data[0], idl) }];
    });
    await saveSnapshotBatch(db, states, response.context.slot);
    count += states.length;
  }
  return count;
}
```
<!-- /snippet -->

> **后续增补**(`ep8-end` 之后，见 `docs/frontend-revamp.md` 的 T7):`ep6-end` 里这里直接 `INSERT … ON CONFLICT (address, slot) DO NOTHING`,每次采样都把全部账户写一遍。长时间 `--follow` 后，本机库积到 27.8 万行，而银行数据真正变化的只有 36 次。现在 `saveSnapshotBatch` 先比较该地址最新一行的 `data`,相同就跳过;"最近一次采样到哪个 slot"另存在 `ingest_cursor`(`account_snapshot`)。于是 `account_states` 只剩变化点，正好就是资产页历史曲线要的数据。

## 两种取数据的方式

| | 回填 | 实时 |
|---|---|---|
| 命令 | `ingest --backfill` | `ingest --tail [--from S] [--to E]` |
| 怎么取 | `getSignaturesForAddress(程序)` → `getTransaction`,跳过库里已有的 | 逐 slot `getBlock`,筛出调用了程序的交易 |
| 适合 | 历史 | 实时跟随、扫一小段 |
| 注意 | 会拿到程序的部署、升级交易(它们把程序地址当账户引用,没有 marginfi 指令) | 追赶历史很慢,每个 slot 一次请求 |

## 在真实环境验证

离线测试用的是进程内的 PGlite。真正连上 Postgres 16 和 Helius 的 devnet 之后,又发现了 **四个离线测试看不到的问题**:

1. **`pg` 对无参数的多语句 SQL(迁移文件)返回的是结果数组**,而不是单个结果。PGlite 语义不同,所以离线通过。
2. **成功交易的 `err` 被存成了 JSONB 的 `null`**,而不是 SQL 的 `NULL`,于是 `WHERE err IS NULL` 一笔成功交易也查不到。
3. **devnet 的区块里已经出现 v1 交易。** `getBlock` 声明只支持版本 0 时整块报错,indexer 会卡死在这个 slot。支持的版本上限要设到 1。
4. **`getBlock` 与 `getTransaction` 的 `meta.rewards` 不同**:前者是 `null`(我们传了 `rewards:false`),后者是 `[]`。除此之外两条路径的交易逐字段相等。

每一个都补了回归测试,并且我把修复拿掉确认测试会失败。

真实数据上的验收结果:

| 检查 | 结果 |
|---|---|
| 回填 | 20 笔原始交易 = 18 笔含 marginfi 指令 + 2 笔程序部署/升级 |
| 解码 | 18 条指令、25 条事件,指令分布与独立基准一致 |
| **清库重跑一致** | `reindex` 前后,指令表与事件表的 md5 **完全相同** |
| 不同路径灌数据 | 清库后用"区块扫描 1 笔 + 签名回填其余",md5 同样相同 |
| 区块扫描 | 只扫清算前后 5 个 slot,找到且只找到清算那一笔,与回填那条的 `slot`、`block_time`、`transaction`、`meta`(除 rewards)全部相等 |
| 重复运行 | 同一区间再跑一次,`inserted=0` |
| 读回对账 | 从数据库读出事件和账户状态做 EP5 的对账,`issues = []` |

自己验证:

```bash
pnpm exec tsx scripts/verify-db.ts
pnpm exec tsx scripts/reindex.ts && pnpm exec tsx scripts/verify-db.ts   # md5 不变
```

## 常见坑

- **JSONB 不保留键顺序**(按键的长度再按字节序重排)。解码出的账户映射存成 JSONB 后,账户顺序变了,而账户在指令里的**位置是有语义的**。要保序就存数组,或者读出来再按 IDL 重排(EP7 的 API 就这样做)。
- **`BIGINT` 的类型差异。** PGlite 返回 JS 的 `bigint`,`pg` 默认返回字符串。适配层统一成字符串。
- **不处理链重组。** 只入库 finalized。(后续增补:实时跟随改为 confirmed 乐观入库 + 终局清扫,回填仍只认 finalized,见 EP8 与 D-017。)
- **追赶历史别用 tail。** devnet 一天约 20 万个 slot,逐个请求太慢。

## 下一集

EP7:把这些数据变成页面,并让观众亲眼看到一笔交易的三种形态。
