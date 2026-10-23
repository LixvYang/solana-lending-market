# EP3 看懂借贷协议,造出链上数据

## 本集要回答的问题

marginfi 的数据长什么样?怎么在 devnet 上造出一段**每次都一样**、覆盖所有关键指令的借贷行为?

## 数据模型:四样东西

| 对象 | 是什么 | 谁拥有 |
|---|---|---|
| **MarginfiGroup** | 一个借贷池,管理员是谁、手续费怎么收 | 管理员创建 |
| **Bank** | 池子里的一种代币:存了多少、借了多少、利率曲线、抵押权重、价格来自哪个预言机 | 管理员添加 |
| **MarginfiAccount** | 一个用户在这个池子里的账户,里面最多 16 个 `Balance` | 用户自己 |
| **Balance** | 用户在某个 Bank 里的头寸:存款份额、借款份额 | 在 MarginfiAccount 里 |

### 份额,而不是数量

Bank 不记"某人存了多少",而是记**份额**(shares)和**份额价值**(share value):

```
数量 = 份额 × 份额价值
```

利息怎么发?**份额不动,份额价值缓慢变大。** 存款人的份额价值涨一点,借款人的份额价值也涨一点,不需要给每个人逐个改余额。所以链上账户里你看不到"余额",只看得到份额。要得到数量必须乘上 Bank 里的份额价值。

份额和份额价值都是 **I80F48** 定点数:128 位有符号整数,低 48 位是小数。EP5 会逐字节拆它。

### 利率曲线

利用率 = 借款 / 存款。基础利率是一条分段线性曲线:

```
利用率 ≤ 最优点:  基础利率 = 利用率 / 最优点 × 平台利率
利用率 >  最优点:  基础利率 = 平台利率 + (利用率 − 最优点)/(1 − 最优点) × (最大利率 − 平台利率)

借款利率 = 基础利率 × (1 + 按比例费用) + 固定费用 APR
存款利率 = 基础利率 × 利用率
```

借款人付的比存款人收的多,差额就是协议费和保险费。EP5 会用真实数据验证这个守恒。

### 健康度与清算

```
健康度 = Σ(存款 × 价格 × 资产权重) − Σ(借款 × 价格 × 负债权重)
```

资产权重小于 1(抵押品打折),负债权重大于 1(借款加价)。**维持健康度小于 0,账户就可以被别人清算**:清算人替借款人还一部分债,按折扣价拿走抵押品。

## 为什么要自己部署一份

用主网上的 marginfi 看不到我们想看的所有指令,也没法重复。自己部署一份,就能**按需造出每一种行为,并且可以反复造**。

版本选 `mrgn-0.1.0`,是上游较早、较简单的版本。构建时有两处补丁(见 `program/build.sh`):

1. **换程序地址。** 上游的地址我们没有私钥,没法部署到同一个地址,构建时把源码里的 `declare_id!` 换成我们自己生成的 keypair。
2. **换价格账户的 owner。** 见下文。

工具链:Solana CLI 2.1.20 的 `cargo build-sbf` 就能构建,不需要上游要求的 1.18.17。

## 剧本:12 步,固定顺序

`pnpm scenario` 默认只打印计划,加 `--execute` 才真的发交易(整次约 0.3 SOL)。

| # | 步骤 | 触发的指令 |
|---|---|---|
| 1 | 创建 tUSDC(6 位)、tSOL(9 位),铸币,给三个人转 SOL | (SPL Token) |
| 2 | 写入价格:tUSDC = $1,tSOL = $100 | |
| 3 | 创建 group | `marginfi_group_initialize`、`init_global_fee_state` |
| 4 | 添加两个 bank,绑定价格账户 | `lending_pool_add_bank`、`lending_pool_configure_bank_oracle` |
| 5 | 三人各创建 marginfi 账户 | `marginfi_account_initialize` |
| 6 | alice 存入 10,000 tUSDC | `lending_account_deposit` |
| 7 | bob 存入 100 tSOL | `lending_account_deposit` |
| 8 | bob 借出 5,000 tUSDC | `lending_account_borrow` |
| 9 | 两个 bank 计息 | `lending_pool_accrue_bank_interest` |
| 10 | **tSOL 价格降到 $50** | |
| 11 | carol 存入 6,000 tUSDC,然后清算 bob 10 tSOL | `lending_account_deposit`、`lending_account_liquidate` |
| 12 | alice 取出 1,000 tUSDC;bob 还清剩余债务 | `lending_account_withdraw`、`lending_account_repay` |

权重是这样选的:tSOL 抵押权重 0.8(开仓)/ 0.9(维持),借款权重 1.1 / 1.05。tSOL = $100 时,bob 抵押 100 tSOL、借 5000 tUSDC 是健康的;降到 $50 后,维持健康度 = 100 × 50 × 0.9 − 5000 × 1.05 = **−750**,可以被清算。

### 账户是"确定性派生"的

三个用户、两个代币、group、bank 的密钥都由一个固定字符串经 SHA-256 得到,**不落盘**:

种子中的旧项目名是历史标识,改动会改变派生地址,因此不能修改。

<!-- snippet: scenario/lib/actors.ts#ep3-actors -->
```ts
// 教学账户的种子公开，任何人都能签名；只用于 devnet，不能存真实资产。
// 历史项目名参与地址派生，改动会指向链上不存在的账户。
export function deriveKeypair(label: string): Keypair {
  const seed = createHash('sha256').update(`solana-lending-indexer/${label}`).digest();
  return Keypair.fromSeed(seed);
}
```
<!-- /snippet -->

所以任何人在任何机器上跑剧本,得到同样的地址。代价是密钥公开,**只能放测试币**。

## 价格:布局一致的 mock

这是本集最需要诚实说明的一块。

**原计划**:每个代币在 Switchboard 上建一个 feed,用固定值任务(`valueTask`)钉死价格,每次借贷前 crank 一次。

**实测**:我们跑通了 feed 的创建(要走 Crossbar 的 v1 `/store`,用 v2 存的定义 crank 时会返回 400),但 crank 一直失败——排查到最后发现 **devnet 上 191 个 Switchboard oracle 的心跳全部超时**,最新的也已经一天半没动。这不是我们的代码问题,软件上也绕不开:价格账户归 Switchboard 程序所有,只有它能写。

**替代方案**:marginfi 对价格账户只检查两件事——owner 是不是预期的程序,内容能不能按 Switchboard 的 `PullFeedAccountData` 布局解析。所以:

1. 构建 marginfi 时,把"预期的 Switchboard 程序地址"换成上游自带的 `mocks` 程序;
2. 让价格账户归 `mocks` 所有,字节布局与真实账户**逐字节一致**;
3. 价格通过 `mocks` 的 `write(offset, data)` 指令写入,"crank"就是用链上时间重写一次时间戳。

价格区域只有 177 字节:

<!-- snippet: scenario/lib/mock-feed.ts#ep3-mock-feed-region -->
```ts
/** 从 sample_size(2215) 到 max_staleness(2392) 之前的 177 字节：时间戳、结果值、slot。 */
export function resultRegion(price: number | bigint, timestamp: number, slot: number): Buffer {
  // keeper 传链上 i128 原值，避免 Number/6 位小数舍入悄悄改变价格。
  const value = typeof price === 'bigint' ? price : toFixed18(price);
  const buf = Buffer.alloc(OFFSET.maxStaleness - OFFSET.sampleSize);
  buf.writeUInt8(1, 0); // sample_size
  buf.writeBigInt64LE(BigInt(timestamp), 1); // last_update_timestamp，marginfi 用它判断是否过期
  const result = OFFSET.result - OFFSET.sampleSize;
  // value(中位数)、std_dev、mean、range、min、max，各 16 字节；std_dev 与 range 为 0。
  [value, 0n, value, 0n, value, value].forEach((v, i) => i128(v).copy(buf, result + i * 16));
  const slotAt = result + 6 * 16 + 8; // 6 个 i128 之后还有 8 字节 padding
  [slot, slot, slot].forEach((s, i) => buf.writeBigUInt64LE(BigInt(s), slotAt + i * 8));
  return buf;
}
```
<!-- /snippet -->

**偏移是怎么确认的?** 不是自己想的。从 `switchboard-on-demand` 的 Rust 源码按 `repr(C)` 算出来,再用一个链上**真实**的 Switchboard 账户逐项核对:authority、queue、名字、`min_responses`、`max_staleness` 全部对上。这个真实账户存在 `fixtures/switchboard-pullfeed-uncranked.bin`,有测试盯着它。

> 视频里请明确说:这是"布局一致的 mock",不是真实的 Switchboard 价格。真实 Switchboard 那条路只验证到创建 feed。

> **后续增补**(第 8 集代码定稿 `ep8-end` 之后才加的,只在 `main` 上,各集 tag 里没有):上面的"oracle 离线"是 2026-10-11 的实测。之后核实:Switchboard 已于 2026-09-19 宣布整体关停、09-25 停止支持,devnet 的 oracle 不会恢复(D-018)。所以剧本继续用这个 mock——它本来也是演示清算所必需的(真实行情没法按需打低)。另外新增了一个价格来自 **Pyth** devnet 真实行情的资产 pSOL,用来演示真实预言机(EP8,D-019)。

## 跑完之后

一次完整运行:**32 笔交易全部 finalized**,覆盖存款、借款、还款、取款、清算、计息。tSOL 从 $100 降到 $50 后,carol 清算 bob 成功,最后 bob 还清了债务。这次运行的原始数据存在 `fixtures/m1-run.json`,是后面所有解码器的金标准。

## 常见坑

- **Crossbar 的老域名已经解析不到。** SDK 默认的 `crossbar.switchboard.xyz` 现在没有 DNS 记录,换成 `crossbar.switchboardlabs.xyz` 才能存任务定义。
- **价格有有效期。** marginfi 要求价格在 `oracle_max_age` 秒内更新过,所以每次借款、清算之前都要先写一次价格。
- **创世哈希写错会把正常的 devnet 当成非 devnet。** 剧本在发交易前会核对 RPC 的创世哈希,防止误用主网。
- **`MarginfiAccount` 不记余额,只记份额。** 想看余额要读 Bank。

## 下一集

EP4:有了真实的链上数据,开始解析。第一步:一笔交易里的指令,怎么还原成"谁调用了什么、传了什么"。
