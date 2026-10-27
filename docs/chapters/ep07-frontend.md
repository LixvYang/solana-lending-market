# EP7 借贷市场前端与总结

## 本集要回答的问题

怎样把数据库里的数据变成页面,并且让观众亲眼看到:**一笔交易的原始字节、解码结果、数据库行,是同一件事的三种样子**?

## 后端:只读 API

API 只读数据库,不连 RPC,也不碰任何密钥。六个路由:

| 路由 | 返回 |
|---|---|
| `GET /api/pool` | 每个 bank 的价格、存款、借款、利用率、利率、权重 |
| `GET /api/rate-curve?bank=` | 利率曲线上的 101 个点,和当前利用率落在哪 |
| `GET /api/accounts` | 每个账户的头寸、两种健康度、状态 |
| `GET /api/activity?limit=&before=&bank=&kind=` | 活动流,稳定游标分页;可按 bank 与 supply/borrow/liquidate 过滤 |
| `GET /api/tx/:signature` | **交易详情**:同一笔交易的三种形态 |
| `GET /api/health` | 存活检查 |

前后端之间的数据契约只有一个文件:`src/api/types.ts`。后端按它输出,前端按它读取;`import type` 在构建时会被擦掉,所以两边没有运行时依赖。

### 数量用字符串,显示用浮点

契约里的约定很重要:

- **原生数量**(比如 `5000000000`)是**十进制字符串**,服务端用 `bigint` 精确算出。
- **USD、APR、价格、健康度**是给人看的浮点数,**不能用来对账**。

前端把原生数量转成代币数量时也用 `BigInt`(`fmtToken`),不经过 `Number`。

### 利率

利率函数和 EP3 里的公式一致。借款利率是基础利率加上按比例的费用,再加固定费用的 APR;存款利率是基础利率乘以利用率:

<!-- snippet: src/api/math.ts#ep7-rates -->
```ts
export function curveRate(value: number, curve: InterestCurve): number {
  const u = utilization(value), o = curve.optimal_utilization;
  if (!(o > 0 && o < 1))
    throw new Error('optimal utilization must be between 0 and 1');
  return u <= o ? u / o * curve.plateau_rate
    : curve.plateau_rate + (u - o) / (1 - o) * (curve.max_rate - curve.plateau_rate);
}
export function rates(value: number, curve: InterestCurve) {
  const u = utilization(value), base = curveRate(u, curve);
  // marginfi_group.rs:320-334：insurance + group + enabled program 费用分别求和；原始配置的求和在 bank.ts。
  return { lending_apr: base * u, borrowing_apr: base * (1 + curve.fee_rate) + curve.fee_fixed_apr };
}
```
<!-- /snippet -->

### 健康度:金标准是程序自己算的

<!-- snippet: src/api/math.ts#ep7-health -->
```ts
/** prices:纯数字表示没有置信区间;区间时资产用 low、负债用 high(见 oracle-price.ts riskPrice)。 */
export function health(balances: HealthBalance[], banks: Record<string, HealthBank>, prices: Record<string, number | { low: number; high: number } | null>, mode: 'init' | 'maint'): number | null {
  let result = 0;
  for (const balance of balances) {
    if (!quantity(balance.deposit).numerator && !quantity(balance.borrow).numerator)
      continue;
    const bank = banks[balance.bank], price = prices[balance.bank];
    if (!bank || price == null)
      return null;
    const low = typeof price === 'number' ? price : price.low, high = typeof price === 'number' ? price : price.high;
    if (!Number.isFinite(low) || !Number.isFinite(high))
      return null;
    result += usd(balance.deposit, bank.decimals, low)! * bank.weights[`asset_${mode}`]
      - usd(balance.borrow, bank.decimals, high)! * bank.weights[`liability_${mode}`];
  }
  return result;
}
```
<!-- /snippet -->

> **后续增补**(第 8 集代码定稿 `ep8-end` 之后才加的,只在 `main` 上,各集 tag 里没有):函数里的 `low` / `high`(价格区间)是接入 Pyth 后加的,见下面「价格区间与 Pyth 账户」;`ep7-end` 里只有单一价格。对 mock 价格两者结果相同。

怎么知道算对了?清算事件里,**程序自己报告了被清算账户的健康度**:`liquidatee_pre_health = −750.00178`。我们用事件里的余额、当时的价格($50 和 $1)和 bank 的维持权重重新算一遍:

```
100 tSOL × $50 × 0.9  −  5000.0017 tUSDC × $1 × 1.05  =  4500 − 5250.00178  =  −750.00178
```

清算之后的 `post_health = −701.2518` 同样对得上。**与程序自己的结果在 1e-6 内相等。**


### 价格区间与 Pyth 账户(后续增补)

> **后续增补**(第 8 集代码定稿 `ep8-end` 之后才加的,只在 `main` 上,各集 tag 里没有):D-019。

上面的公式用的不是"一个价格"。程序算健康度时,资产按价格区间的**下沿**、负债按**上沿**,开仓用时间加权价、维持用实时价:

<!-- snippet: src/api/oracle-price.ts#ep7-price-bias -->
```ts
export interface PriceBand { low: number; high: number }
/**
 * 健康度用的不是一个价格,而是一个区间(mrgn-0.1.0 state/price.rs、marginfi_account.rs):
 * - 开仓(init)用时间加权价,维持(maint)用实时价;
 * - 资产按区间下沿算、负债按上沿算,对用户永远是保守的一侧;
 * - 区间半宽 = Pyth conf × 2.12 或 Switchboard std_dev × 1.96,最多不超过价格的 5%。
 * 我们的 mock 价格 std_dev 为 0,区间退化成一个点。
 */
export function riskPrice(feed: FeedData, mode: 'init' | 'maint'): PriceBand {
  const price = mode === 'init' ? feed.ema : feed.price.number, conf = mode === 'init' ? feed.ema_conf : feed.conf;
  const half = Math.min(conf * (feed.source === 'pyth' ? 2.12 : 1.96), price * 0.05);
  return { low: price - half, high: price + half };
}
```
<!-- /snippet -->

我们的 mock 价格 std_dev 为 0,区间退化成一个点,所以上面的清算对账不受影响;Pyth 价格带置信区间(SOL/USD 约 ±$0.05),健康度会比"只看中间价"略保守,`src/api/pyth.test.ts` 用 devnet 上的真实账户核对了方向与数值。

Pyth 的价格账户(`PriceUpdateV2`)布局里有一个变长枚举,所以不能写死偏移:

<!-- snippet: src/decoder/pyth.ts#ep7-pyth-layout -->
```ts
/**
 * Borsh 顺序(pyth_solana_receiver_sdk::price_update::PriceUpdateV2):
 *   discriminator 8 | write_authority 32 | verification_level 1 或 2 | price_message | posted_slot u64
 *   price_message = feed_id 32 | price i64 | conf u64 | exponent i32 | publish_time i64 | prev_publish_time i64 | ema_price i64 | ema_conf u64
 * verification_level 是枚举:0 = Partial { num_signatures: u8 }(2 字节),1 = Full(1 字节)。
 * 因为它变长,后面所有字段的偏移都取决于这一个字节——不能写死偏移表。
 * marginfi 只接受 Full(constants.rs MIN_PYTH_PUSH_VERIFICATION_LEVEL)。
 */
export function decodePriceUpdate(data: Uint8Array) {
  const bytes = Buffer.from(data);
  if (bytes.length !== ACCOUNT_SIZE) throw new Error(`PriceUpdateV2 length must equal ${ACCOUNT_SIZE}`);
  if (!bytes.subarray(0, 8).equals(DISCRIMINATOR)) throw new Error('invalid PriceUpdateV2 discriminator');
  const tag = bytes[40];
  if (tag > 1) throw new Error('invalid verification level');
  let o = tag === 0 ? 42 : 41;
  const feed_id = bytes.subarray(o, o + 32).toString('hex'); o += 32;
  const price = bytes.readBigInt64LE(o), conf = bytes.readBigUInt64LE(o + 8), exponent = bytes.readInt32LE(o + 16);
  const publish_time = bytes.readBigInt64LE(o + 20), ema_price = bytes.readBigInt64LE(o + 36), ema_conf = bytes.readBigUInt64LE(o + 44);
  const posted_slot = bytes.readBigUInt64LE(o + 52);
  // 价格 = price × 10^exponent。exponent 为负(SOL/USD 是 -8),用分母表示,不经过浮点。
  const scaled = (n: bigint) => {
    const numerator = exponent < 0 ? n : n * 10n ** BigInt(exponent), denominator = exponent < 0 ? 10n ** BigInt(-exponent) : 1n;
    return { numerator, denominator, decimal: decimal({ numerator, denominator }, Math.max(0, -exponent)), number: Number(numerator) / Number(denominator) };
  };
  return { write_authority: encodeBase58(bytes.subarray(8, 40)), verification: tag === 1 ? 'Full' as const : 'Partial' as const,
    num_signatures: tag === 0 ? bytes[41] : null, feed_id, price: scaled(price), conf: scaled(conf), ema_price: scaled(ema_price), ema_conf: scaled(ema_conf),
    exponent, publish_time, posted_slot };
}
```
<!-- /snippet -->

它在哪也要算:银行里存的是 feed id,账户地址由 feed id 推导:

<!-- snippet: src/oracle/pyth.ts#ep7-pyth-address -->
```ts
/**
 * mrgn-0.1.0 的 PythPushOracle 银行里,oracle_keys[0] 存的**不是账户地址,而是 32 字节 feed id**
 * (marginfi_group.rs get_pyth_push_oracle_feed_id)。交易里要传的价格账户是 Pyth 按 [分片 u16 LE, feed id] 推导的 PDA。
 * 程序只校验 owner、feed id 与校验级别,不校验地址,所以任何分片都行;我们用 Pyth 自己赞助的 0 号分片。
 */
export function pythPushAccount(feedId: string | Uint8Array, shard = SPONSORED_SHARD): PublicKey {
  const id = typeof feedId === 'string' ? Buffer.from(feedId.replace(/^0x/, ''), 'hex') : Buffer.from(feedId);
  if (id.length !== 32) throw new Error('feed id must be 32 bytes');
  const seed = Buffer.alloc(2);
  seed.writeUInt16LE(shard);
  return PublicKey.findProgramAddressSync([seed, id], PYTH_PUSH_ORACLE)[0];
}
```
<!-- /snippet -->

### 缺价格时:unknown

有负债但拿不到价格时,健康度算不出来。API 返回 `unknown`,**既不说健康,也不说可清算**——没有价格就没有清算资格的证据。(这是 codex 审查契约时提出的,我们采纳了。)

### 交易详情

<!-- snippet: src/api/xray.ts#ep7-xray -->
```ts
export async function getXray(db: Db, signature: string): Promise<XrayView | null> {
  const row = (await db.query('SELECT * FROM raw_tx WHERE signature=$1', [signature])).rows[0];
  if (!row)
    return null;
  const raw = row.tx as RpcTransaction, logs = raw.meta?.logMessages ?? [];
  const instructions = (await db.query('SELECT * FROM instructions WHERE signature=$1 ORDER BY ix_index,inner_index', [signature])).rows;
  const events = (await db.query('SELECT * FROM events WHERE signature=$1 ORDER BY log_index', [signature])).rows;
  const keys = [...raw.transaction.message.accountKeys, ...(raw.meta?.loadedAddresses?.writable ?? []), ...(raw.meta?.loadedAddresses?.readonly ?? [])];
  const positions: {
    ix: RpcInstruction;
    ix_index: number;
    inner_index: number | null;
  }[] = [];
  raw.transaction.message.instructions.forEach((ix, ix_index) => {
    positions.push({ ix, ix_index, inner_index: null });
    for (const group of raw.meta?.innerInstructions ?? [])
      if (group.index === ix_index)
        group.instructions.forEach((inner, inner_index) => positions.push({ ix: inner, ix_index, inner_index }));
  });
  const decoded = positions.map(({ ix, ix_index, inner_index }): XrayInstruction => {
    const stored = instructions.find(r => r.ix_index === ix_index && r.inner_index === (inner_index ?? -1));
    const program = keys[ix.programIdIndex] ?? 'unknown', name = stored ? String(stored.name) : 'unknown';
    const entry = marginfiIdl.instructions.find(i => i.name === name);
    let data_hex = '', spans: XrayInstruction['spans'] = [], decode_error = stored?.decode_error as string | null ?? null;
    try {
      const bytes = decodeBase58(ix.data);
      data_hex = bytes.toString('hex');
      if (program === marginfiIdl.address && stored && !decode_error) {
        try {
          spans = byteSpans(bytes);
        }
        catch (error) {
          decode_error = (error as Error).message;
          spans = rawSpans(bytes);
        }
      }
      else
        spans = rawSpans(bytes);
    }
    catch {
      decode_error = 'invalid base58 instruction data';
    }
    return { ix_index, inner_index, program, name, data_base58: ix.data, data_hex, spans,
      args: inIdlOrder(entry?.args.map(a => a.name) ?? [], stored?.args as Record<string, unknown>),
      accounts: inIdlOrder(entry ? accountNames(entry.accounts) : [], stored?.accounts as Record<string, string>),
      remaining: stored?.remaining as string[] ?? [], decode_error };
  });
  return { signature, slot: String(row.slot), block_time: iso(row.block_time), err: row.err ?? null, logs, instructions: decoded,
    events: events.map(e => ({ log_index: Number(e.log_index), ix_index: Number(e.ix_index), name: String(e.name),
      base64: (logs[Number(e.log_index)] ?? '').slice('Program data: '.length), data: e.data as Record<string, unknown> })),
    rows: { instructions, events } };
}
```
<!-- /snippet -->

一笔交易的三种形态:

1. **链上原始字节**:指令数据的 base58 原文、十六进制,以及按"discriminator + 每个参数"切好的字节段。
2. **解码结果**:指令名、参数、按 IDL 命名的账户。
3. **数据库行**:`instructions` 表和 `events` 表里存的那一行。

字节是怎么切的:

<!-- snippet: src/api/spans.ts#ep7-spans -->
```ts
export function byteSpans(data: Uint8Array, idl: Idl = marginfiIdl): ByteSpan[] {
  const bytes = Buffer.from(data);
  if (bytes.length < 8)
    throw new Error('need 8 discriminator bytes');
  const entry = idl.instructions.find(i => Buffer.from(i.discriminator).equals(bytes.subarray(0, 8)));
  if (!entry)
    return rawSpans(bytes);
  const spans: ByteSpan[] = [{ offset: 0, length: 8, label: 'discriminator', hex: bytes.subarray(0, 8).toString('hex'), value: entry.name }];
  const reader = new Reader(bytes.subarray(8));
  for (const field of entry.args) {
    const offset = bytes.length - reader.remaining;
    const value = JSON.parse(toJson(decodeType(field.type, reader, idl)));
    const length = bytes.length - reader.remaining - offset;
    spans.push({ offset, length, label: field.name, hex: bytes.subarray(offset, offset + length).toString('hex'), value });
  }
  if (reader.remaining)
    throw new Error(`trailing instruction bytes: ${reader.remaining}`);
  let end = 0;
  for (const span of spans) {
    if (span.offset !== end)
      throw new Error('non-contiguous spans');
    end += span.length;
  }
  if (end !== bytes.length)
    throw new Error('incomplete spans');
  return spans;
}
```
<!-- /snippet -->

断言:各段首尾相接,总长等于数据长度。

## 前端

Vite + React + TypeScript,图表**手写 SVG**,不引图表库。

- **总览**:一个大数字(总存款)+ 两个指标卡 + 利用率仪表。
- **利率曲线**:2px 折线,悬停有十字线和提示框,可展开数据表。
- **账户**:状态永远是"图标 + 文字",不只靠颜色。
- **活动流**:点任意一行打开交易详情。
- **交易详情抽屉**:三栏并排。左栏的字节按"discriminator / 各参数"着色,**鼠标移到某个字节段上,中栏对应的字段同步高亮**。

配色用的是经过验证的调色板:图里的蓝和橙在浅色、深色两种背景下,对比度和色盲区分度都用脚本检查过,而不是凭眼睛判断。

### 界面改版(后续增补)

> **后续增补**(第 8 集代码定稿 `ep8-end` 之后才加的,只在 `main` 上,各集 tag 里没有):D-020、D-021。

- 内容分到五个 tab(借贷池 / 我来操作 / 兑换 / 账户 / 链上活动),当前 tab 记在 URL hash 里。
- 借贷池改为市场列表(参照 Aave / marginfi / Kamino):每个资产一行,存借 APR 并排、利用率条、最高抵押率,行尾直接"存入 / 借出"。
- 兑换独立成页(参照 Jupiter / Uniswap):带图标与余额的代币选择器、翻转、汇率与费用明细。
- 代币有图标与说明(`web/src/tokens.tsx`),并写进了链上 Metaplex 元数据,钱包里也能显示(`scripts/token-metadata.ts`)。

### 对照另一个真实前端

mrgn 自己的前端(`fluxor-ui-v4`,Next.js)是"链 → Next 路由 → 浏览器",没有自建数据库;`WrappedI80F48` 作为 16 个数字的数组原样发到浏览器,再用 `decimal.js` + `BigNumber` 转换(精度细节见 EP5)。我们的区别是:

| | 它 | 我们 |
|---|---|---|
| 数据来源 | 直接读链 | 数据库(链上数据的有序副本) |
| 精确计算在哪 | 浏览器,`BigNumber` | 服务端,`bigint` |
| 有无历史活动流 | 无 | 有 |
| 能看原始字节 | 否 | 交易详情 |

## 真实联调中发现的问题

这些在离线测试里都没有暴露,接上真实数据库和真实 devnet 数据才出现:

1. **JSONB 重排了键的顺序。** 清算指令的账户在交易详情里变成了 `group, signer, liab_bank…`,而链上的顺序是 `group, asset_bank, liab_bank, …`。API 现在按 IDL 的声明顺序重排。**数据库里存的那一行本身仍是被重排的**,交易详情第三栏如实展示它——这是一个值得讲的点。
2. **清算行的代币是空的。** 清算事件没有 `bank` 字段,只有 `asset_bank` 和 `liability_bank`。现在取被清算资产所在的 bank。
3. **交易里还有别的程序的指令**(设置算力、SPL Token 转账)。它们没有数据库行,前端折叠起来并标出程序名,不再显示成 `unknown`。
4. **权重显示成 `0.7999999999999972`**:这是 I80F48 定点数的舍入噪声,显示时取 3 位小数。

## 整套流水线回顾

```
链上 → raw_tx(原始事实)→ 解码(纯函数,可重放)→ 指令/事件/账户状态 → API → 页面
```

- **EP2** 画了数据地图;**EP3** 造出了可重复的链上数据。
- **EP4–EP5** 手写解码:指令、事件、账户。
- **EP6** 保证幂等、可回填、可重放。
- **EP7** 把一切摆在眼前。

## 局限(诚实地说)

- **tSOL/tUSDC 的价格是布局一致的 mock。** 要能打低价格演示清算;Switchboard 已于 2026-09 关停(D-018)。pSOL 用 Pyth 真实行情(D-019)。
- **不处理链重组**,只入库 finalized。(后续增补:实时跟随改为 confirmed 乐观入库 + 终局清扫,见 EP8 与 D-017。)
- **账户状态只有快照**,没有逐笔历史。
- **只覆盖剧本涉及的指令。** 其余的存成 `unknown`。
- **本集的前端是只读的。** 钱包交互(在页面上发交易)、兑换、Pyth 价格与界面改版在可选的 [EP8](ep08-wallet.md) 及后续增补里。

## 换一个协议怎么办

整条流水线里**和 marginfi 绑定的只有两样**:IDL(`src/decoder/idl/`),以及账户的布局(由 IDL 算出,`layout.ts` 本身由 IDL 驱动,没有写死 marginfi 的偏移)。`ingest`、`store`、API 的骨架原则上都不用动——**但我们没有在别的协议上验证过这一点**。当然,利率、健康度这些业务公式(`src/api/math.ts`)和前端的指标是协议相关的,需要重写。
