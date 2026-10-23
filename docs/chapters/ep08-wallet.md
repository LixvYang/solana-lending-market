# EP8 钱包交互:让外部用户操作借贷池(可选集)

## 本集要回答的问题

怎么让连着钱包的用户对借贷池存款、取款、借款、还款,同时**不给服务端任何不该有的权力**?

## 架构

```
 浏览器 + 钱包(Phantom 等)
      │  ① POST /api/build   {动作, 钱包地址, 代币, 数量}
      │  ←  未签名的交易 + 模拟结果(成功/失败的人话)
      │  ② 钱包签名(用户确认)
      │  ③ POST /api/send    {已签名的交易}
      ▼
   API ──► RPC(Helius 密钥只在服务端)
   
 水龙头 + 兑换台(独立进程,专用钱包)
```

交易**由服务端构建、钱包签名、服务端转发**。这样做有三个理由:浏览器里不需要塞进 Anchor;RPC 的 API key 不会暴露给浏览器;发送之前能先**模拟**,把链上错误翻译成人话,用户不会白花手续费。

## 谁能签什么

这是整集最重要的一张表。

| 密钥 | 在哪 | 签什么 | 能做什么坏事 |
|---|---|---|---|
| **用户钱包** | 用户自己的钱包 | 自己的交易,并付手续费 | 只能动自己的资产 |
| **一次性 marginfi 账户密钥** | 构建接口里临时生成,不落盘 | 只签"创建这个账户" | 无 |
| **公开的价格账户密钥** | 由固定字符串派生,**公开** | 刷新价格时间戳(随用户的借款/取款交易) | 任何人本来就能写,所以不构成新风险 |
| **水龙头专用钱包** | 只在水龙头进程里 | 转账测试币 | 最多转走水龙头里有的那点测试币 |
| **管理员钱包**(group admin、mint authority) | **只在命令行工具里**(`faucet-setup`;可选的 `price-keeper`) | 铸币、写价格 | **绝不进任何常驻的、对外的服务** |

API 进程里没有管理员密钥。转发接口还会拒绝:交易里没有 marginfi 指令的、手续费付款人没有签名的、含地址表的、超过 1232 字节的、签名无法通过 Ed25519 验证的——它不是一个"任意交易中继"。

## 三个 marginfi 的特殊点

**1. 账户不是 PDA。** 在 mrgn-0.1.0 里,用户的 marginfi 账户是一个**随机生成的 keypair**,创建它必须由它自己签名。所以首次存款的交易里同时包含"创建账户"和"存款",账户密钥只用来签这一次,然后丢掉。

<!-- snippet: src/api/builder/index.ts#ep8-first-deposit -->
```ts
// 账户不是 PDA；唯一一次性 keypair 只签自己的创建，不为用户付费，也不落盘。
const fresh = user ? null : Keypair.generate(), account = user ? new PublicKey(user.address) : fresh!.publicKey;
for (const r of refresh) instructions.push(refreshTimestampIx(r.program, r.feed, now));
if (fresh) instructions.push(await initInstruction(group, account, wallet));
const amount = request.all ? 0n : BigInt(request.amount);
instructions.push(await lendingInstruction(request.action, group, account, wallet, target, ata, amount, request.all === true, metas));
const latest = await services.rpc.getLatestBlockhash('confirmed');
const tx = new VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: latest.blockhash, instructions }).compileToV0Message());
const preSigners = [...(fresh ? [fresh] : []), ...refresh.map(r => r.signer)];
if (preSigners.length) tx.sign(preSigners); // 一次性账户与公开的价格账户由服务端代签;用户的签名由钱包补上
```
<!-- /snippet -->

**2. 借款和取款要传"操作之后所有头寸的 bank + 价格账户"(remaining accounts),顺序必须和余额槽位一致。** 风险引擎按槽位顺序读它们。新开的头寸占用**第一个空闲槽位**,而不是追加到末尾:

<!-- snippet: src/api/builder/remaining.ts#ep8-remaining -->
```ts
export function remainingBanks(balances: Position[], action: WalletAction, target: string, all: boolean): string[] {
  const slots = balances.map(b => b.active ? b.bank_pk : null);
  // find_or_create 用第一个 inactive，不能把新 bank 简单 append 到 active 列表末尾。
  if (action === 'borrow' && !slots.includes(target)) {
    const index = slots.indexOf(null);
    if (index < 0) throw new ApiError(400, 'balance slots full');
    slots[index] = target;
  }
  // mrgn-0.1.0 withdraw_all 在健康检查前 close balance；部分取款保留槽位。
  if (action === 'withdraw' && all) return slots.filter((b): b is string => b !== null && b !== target);
  return slots.filter((b): b is string => b !== null);
}
export function observation(addresses: string[], banks: Record<string, BuildBank>, group: string): AccountMeta[] {
  return addresses.flatMap(address => {
    const bank = banks[address];
    if (!bank || bank.group !== group) throw new ApiError(400, 'active bank outside pool');
    // 每个银行跟一个价格账户。Pyth 银行存的是 feed id,要换算成账户地址(oracle/pyth.ts)。
    const oracle = oracleAccountOf(bank.config);
    if (!oracle) throw new ApiError(503, 'bank has no oracle');
    return [address, oracle].map(key => ({ pubkey: new PublicKey(key), isSigner: false, isWritable: false }));
  });
}
```
<!-- /snippet -->

怎么确认排对了?用 EP2 里那笔真实的借款交易当金标准:账户列表和 remaining 的顺序**与链上真实交易完全一致**。

**3. 同一个 bank 的头寸要么是存款、要么是负债。** 如果你在 tUSDC 里有存款,再"借 tUSDC",程序会**先把你自己的存款取出来**,扣完才开始产生负债。这不是 bug,但非常容易让人困惑——我们自己写测试剧本时就踩过:存了 500 tUSDC 再借 200 tUSDC,结果存款变成了 300,借款还是 0,后面"还款"报"没有待偿还的借款"。想借出来,请用**另一种**代币做抵押。界面里会提示这一点。

## 发送之前先模拟

<!-- snippet: src/api/builder/index.ts#ep8-simulate -->
```ts
const simulated = (await services.rpc.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' })).value;
const simulation = { ok: simulated.err === null, error: simulated.err === null ? null : programError(simulated.err),
  logs: publicLogs(simulated.logs), units_consumed: simulated.unitsConsumed ?? null };
```
<!-- /snippet -->

模拟失败**仍然返回交易**,只是 `simulation.ok = false`,由前端决定能不能签名。常见的链上错误被翻译成人话,例如借款后健康度不足(`RiskEngineInitRejected`):"借款后健康度不足,请减少借款数量或先增加抵押"。

## 转发的安全守卫

<!-- snippet: src/api/send.ts#ep8-send-guard -->
```ts
/**
 * 默认只接受含 marginfi 指令的交易(钱包转发接口)。水龙头的兑换台复用同一套签名/格式检查，
 * 但允许另一组程序——由调用方传入 accept，所以这里的检查不会被放宽给钱包转发接口。
 */
const hasMarginfi = (programs: string[]) => programs.includes(marginfiIdl.address);
export function guardTransaction(input: unknown, accept: (programs: string[], signers: string[]) => boolean = hasMarginfi,
  rejection = 'missing marginfi instruction'): { bytes: Buffer; signature: string } {
  const value = objectBody(input).transaction;
  if (typeof value !== 'string' || !value.length || value.length > 1644 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new ApiError(400, 'invalid transaction encoding/size');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > 1232) throw new ApiError(400, 'transaction exceeds 1232 bytes');
  let tx: VersionedTransaction;
  try { tx = VersionedTransaction.deserialize(bytes); }
  catch { throw new ApiError(400, 'invalid transaction'); }
  if (tx.version !== 0 || tx.message.addressTableLookups.length) throw new ApiError(400, 'only v0 transactions without lookup tables are supported');
  const message = tx.message, count = message.header.numRequiredSignatures;
  if (!count || !message.isAccountSigner(0) || tx.signatures.length !== count) throw new ApiError(400, 'fee payer must be a signer');
  const programs = message.compiledInstructions.map(ix => message.staticAccountKeys[ix.programIdIndex]?.toBase58() ?? '');
  const signers = message.staticAccountKeys.slice(0, count).map(k => k.toBase58());
  if (!programs.length || !accept(programs, signers)) throw new ApiError(400, rejection);
  // 非零字节不是签名证据；验证所有 required signatures，尤其是 payer 的 Ed25519 签名。
  // 服务端绝不补签或承担费用；ALT 拒绝，避免未解析的地址绕过程序检查。
  const data = message.serialize();
  for (let i = 0; i < count; i++) {
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), message.staticAccountKeys[i].toBuffer()]), format: 'der', type: 'spki' });
    if (!verify(null, data, key, tx.signatures[i])) throw new ApiError(400, 'missing or invalid signature');
  }
  if (!Buffer.from(tx.serialize()).equals(bytes)) throw new ApiError(400, 'noncanonical transaction');
  return { bytes, signature: encodeBase58(tx.signatures[0]) };
}
```
<!-- /snippet -->

## 获取测试币的第二种方式:SOL 与测试币任意兑换(后续增补)

> **后续增补**(第 8 集代码定稿 `ep8-end` 之后才加的,只在 `main` 上,各集 tag 里没有):D-016 引入兑换台,D-017 改为任意两两互换,D-019 起汇率按预言机价格。

水龙头免费但有限流。想要更多,或者想换成别的币,可以**兑换**——SOL 与池子里已配置的测试币任意两两互换。测试币是我们自己发行的,没有真实的 AMM 池子,所以做成一个**原子兑换台**:一笔交易里同时有两件事——你把 A 转给兑换台、兑换台把 B 转给你。汇率不写死,按借贷池用的同一批价格账户来定(见下)。

<!-- snippet: src/faucet/swap.ts#ep8-swap-tx -->
```ts
// 一笔交易里两件事:用户把 from 转给兑换台 + 兑换台把 to 转给用户。付手续费和 ATA 租金的是用户(payerKey = wallet)，
// 兑换台只是"转出资产"的授权签名者，不垫付手续费。兑换台的签名覆盖整条消息，用户改动任何内容都会让它失效。
const instructions: TransactionInstruction[] = [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 })];
if (from.mint) instructions.push(createTransferInstruction(getAssociatedTokenAddressSync(from.mint, wallet), getAssociatedTokenAddressSync(from.mint, desk.publicKey), wallet, amountIn));
else instructions.push(SystemProgram.transfer({ fromPubkey: wallet, toPubkey: desk.publicKey, lamports: amountIn }));
if (to.mint) {
  const userAta = getAssociatedTokenAddressSync(to.mint, wallet);
  instructions.push(createAssociatedTokenAccountIdempotentInstruction(wallet, userAta, wallet, to.mint),
    createTransferInstruction(getAssociatedTokenAddressSync(to.mint, desk.publicKey), userAta, desk.publicKey, out));
} else instructions.push(SystemProgram.transfer({ fromPubkey: desk.publicKey, toPubkey: wallet, lamports: out }));
const block = await rpc.getLatestBlockhash('confirmed');
const tx = new VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: block.blockhash, instructions }).compileToV0Message());
tx.sign([desk]);
```
<!-- /snippet -->

几个关键点:

- **原子的。** 两件事在同一笔交易里,要么都发生要么都不发生,不存在"付了币没收到"。
- **兑换台先签名,用户再签名。** 兑换台的签名覆盖整条交易消息,用户若改动任何内容,兑换台的签名就失效,交易失败。
- **手续费和账户租金由用户付**,兑换台只是"转出资产"的授权签名者,不垫付手续费。
- **十二个方向都支持(四种资产两两)。** 卖出 SOL 是系统转账,卖出代币是 SPL 转账;买入 SOL 是兑换台系统转账给你,买入代币是兑换台 SPL 转账给你(你的代币账户不存在时由你付租金创建)。
- **汇率由同一次报价里的 USD 单价表推导**,所有资产自洽:

<!-- snippet: src/faucet/swap.ts#ep8-swap-math -->
```ts
/**
 * 卖出 amountIn(原生单位)能换到多少:整数运算、向下取整,永远不会多给。
 *   换出 = 卖出 × 单价(卖出) × 10^小数位(换出) / (单价(换出) × 10^小数位(卖出))
 * 例:1 SOL($50) → tUSDC($1):1e9 × 50e6 × 1e6 / (1e6 × 1e9) = 50e6,即 50 tUSDC。
 * 同一次报价里所有汇率都来自同一张 USD 单价表,SOL→tSOL→tUSDC→SOL 绕一圈只会因取整而略少,不会凭空变多(没有套利环)。
 * 单价跟着预言机走(Pyth 是真实行情),所以不同时刻的报价会不同。
 */
export const swapOut = (amountIn: bigint, from: PricedAsset, to: PricedAsset): bigint =>
  amountIn * from.usdMicro * 10n ** BigInt(to.decimals) / (to.usdMicro * 10n ** BigInt(from.decimals));
/** 这笔卖出的价值(USD × 1e6),用来做上下限。 */
export const notionalMicro = (amountIn: bigint, from: PricedAsset): bigint => amountIn * from.usdMicro / 10n ** BigInt(from.decimals);
```
<!-- /snippet -->

  单价在每次报价时从链上读(`src/faucet/prices.ts`):SOL 和已配置的 Pyth 银行读对应 USD feed(真实行情),tSOL、tUSDC 读池子里的 mock 价格账户——**兑换价和借贷池估值永远是同一个数**。Pyth 价格超过 10 分钟没更新、或价格为 0 时拒绝报价,不按旧价成交。单笔价值 $0.05 到 $100。同一次报价用同一张价格表,SOL → tUSDC → tSOL → SOL 绕一圈只会因为向下取整略少一点点,**不会凭空变多**(没有套利环),测试里对多个起点数量验证过。
- **兑换台保留 0.05 SOL。** 买入 SOL 时,兑换台的可付出数量是"余额减去 0.05 SOL",留着付代币账户租金等。
- **转发接口只放行兑换交易。** 兑换台自己的转发接口会检查:兑换台是签名者、所有签名有效、只含 计算预算 / 系统 / 代币 / ATA 这四个程序。复用的是钱包转发接口的同一套签名检查,但程序白名单由调用方传入,**不会放宽钱包转发接口本身**。
- **SOL 与 Pyth 定价测试币是市场价**,tSOL / tUSDC 仍是我们设的 mock 价,视频里要说明。

(2026-10-14 固定汇率版本)真实 devnet 上用界面点过三个方向:tUSDC → SOL(25 tUSDC 换 0.5 SOL)、SOL → tSOL(0.2 → 0.2)、tSOL → tUSDC(0.2 tSOL 换 10 tUSDC),预估数量与实际到账一致。

## 真实价格:Pyth 定价的 pSOL 银行(后续增补)

> **后续增补**(第 8 集代码定稿 `ep8-end` 之后才加的,只在 `main` 上,各集 tag 里没有):D-018、D-019。

Switchboard 已于 2026-09 关停(D-018),devnet 上还在持续更新的真实价格只剩 Pyth 赞助的价格账户。mrgn-0.1.0 本来就支持 `PythPushOracle`,不用升级程序。我们新发了一个测试币 **pSOL**,在同一个池子里加一个银行,价格绑定 Pyth SOL/USD(`scripts/add-pyth-bank.ts`):

<!-- snippet: scripts/add-pyth-bank.ts#ep8-pyth-configure -->
```ts
// 3. 绑定 Pyth:setup = 3(PythPushOracle),"oracle" 参数传的是 feed id(32 字节当 Pubkey),
//    remaining account 传真正的价格账户,程序用它核对 feed id 是否一致(price.rs check_ai_and_feed_id)。
const current = await fetchAccount(ctx, 'bank', bank.publicKey);
if (!(current.config.oracleKeys[0] as PublicKey).equals(feedIdAsKey(FEED_IDS[asset.feed]))) {
  await send(ctx, `configure oracle ${symbol} (Pyth)`, [await ctx.program.methods.lendingPoolConfigureBankOracle(3, feedIdAsKey(FEED_IDS[asset.feed]))
    .accountsStrict({ group, admin: ctx.admin.publicKey, bank: bank.publicKey })
    .remainingAccounts([{ pubkey: feed, isSigner: false, isWritable: false }]).instruction()]);
}
```
<!-- /snippet -->

和 mock 价格的银行比,有三处不同:

- **`oracle_keys[0]` 存的是 feed id,不是账户地址。** 交易里要传的价格账户由 feed id 推导(EP7「价格账户在哪」),构建器与索引器都要先换算。
- **价格我们写不了。** mock 账户可以在借款交易里顺手刷新时间戳(下一节);Pyth 账户归 Pyth 程序所有,只能检查它没超过银行的 `oracle_max_age`(设为 300 秒,devnet 赞助账户约 1–2 分钟更新一次),超过就如实提示"稍后再试"。
- **价格不能按需打低**,所以清算演示仍用 tSOL(mock)。pSOL 用来演示"真实预言机"。

`scripts/verify-pyth-bank.ts` 在 devnet 上验证了两个方向:存 pSOL 借 tUSDC(Pyth 价格作抵押)、存 tUSDC 借 pSOL(Pyth 价格作负债)。

### 更多 Pyth 资产(代码增补,链上待执行)

`scripts/add-pyth-bank.ts --symbol pBTC|pETH|pHYPE` 可按符号添加 Pyth 银行,默认仍是 pSOL;各资产 feed、精度与最大价格年龄集中在 `src/oracle/pyth-banks.ts`。新币统一 8 位,风险权重照搬 tSOL,`oracle_max_age` 设为 900 秒以适应实测最长约 7 分钟的赞助更新间隔。水龙头默认量约值 $500(按参考价格估算,可用 `FAUCET_PBTC_AMOUNT`、`FAUCET_PETH_AMOUNT`、`FAUCET_PHYPE_AMOUNT` 调整),兑换台读取银行当前 Pyth 账户报价。

这次只完成代码与离线验收;新银行尚未由链上脚本创建,`program/devnet.json` 的新 mint/bank 地址、前端 mock 数据及钱包元数据需在后续相应步骤补齐。

## 价格保鲜:在交易里顺手刷新,前端无感(后续增补)

> **后续增补**(第 8 集代码定稿 `ep8-end` 之后才加的,只在 `main` 上,各集 tag 里没有):D-017。`ep8-end` 时的版本用的是后台价格维护进程(`scripts/price-keeper.ts`,仍保留但已不是必需)。

marginfi 要求价格在 `oracle_max_age`(我们配的是 240 秒)内更新过,否则借款和取款会失败。真实的 Switchboard 靠 oracle 持续推送;我们用的是 mock 价格(EP3),需要有人定时把价格账户的时间戳重写一次。

**最初的做法是一个后台"价格维护进程"**,每 60 秒刷新一次。它上线不久就暴露了问题:连续 5 次刷新失败后它按设计退出了,价格 8 个多小时没更新,用户借款时看到"价格维护进程没有运行"。**这种错误不该让用户感知,更不该依赖一个会挂掉的进程。**

现在的做法:构建借款/取款交易时,如果价格账户的时间戳不够新(超过 30 秒),服务端**直接在这笔交易里加一条"刷新时间戳"的指令**:

<!-- snippet: src/api/builder/index.ts#ep8-price-refresh -->
```ts
// 借款/取款要求价格新鲜。价格由谁来保鲜不该让用户操心:如果价格账户是我们自己的 mock(密钥公开派生),
// 就在这笔交易里顺手把时间戳刷新到当前链上时间——价格数值不动,手续费包含在用户这笔交易里。
// 这样不依赖任何后台进程;进程挂了、刚重启、网络抖动都不会让用户看到"价格过期"。
const refresh: { feed: PublicKey; program: PublicKey; signer: Keypair }[] = [];
let now = 0n;
if (request.action === 'borrow' || request.action === 'withdraw') {
  now = await clusterTime(services);
  for (const address of new Set([...remaining, request.bank])) {
    const config = banks[address].config, oracle = oracleAccountOf(config);
    if (!oracle) throw new PriceStale();
    const feedKey = new PublicKey(oracle);
    const feed = await services.rpc.getAccountInfo(feedKey, 'confirmed'); // 读链上当前值，库里的快照不能作为新鲜度证据
    if (!feed || !(services.oracleOwners ?? oracleOwners()).has(feed.owner.toBase58())) throw new PriceStale();
    if (isPythPush(config.oracle_setup)) {
      // Pyth 的价格由 Pyth 自己推送,我们写不了;只能确认它还在银行允许的年龄内,否则如实告诉用户等一下。
      const pyth = decodePriceUpdate(feed.data);
      if (pyth.verification !== 'Full' || now - pyth.publish_time > BigInt(config.oracle_max_age)) throw new PriceStale('Pyth 价格暂未更新，请过一两分钟再试。');
      continue;
    }
    const price = decodePullFeed(feed.data);
    if (!price.sample_size) throw new PriceStale(); // 从未有过价格:没有可保鲜的值
    const age = now - price.last_update_timestamp;
    if (age <= REFRESH_AFTER_SECONDS && age >= 0n) continue; // 够新,不动(正常运行时这笔交易保持最小)
    const signer = mockFeedSigner(feedKey);
    if (!signer) throw new PriceStale(); // 不是我们的 mock(比如真实预言机):不能代为刷新
    refresh.push({ feed: feedKey, program: feed.owner, signer });
  }
}
```
<!-- /snippet -->

- **只写 8 字节的时间戳**,价格数值一个字节都不动。测试里断言写入偏移落在时间戳字段上,没有碰到结果值区域。
- **价格账户的密钥是公开派生的**(`feed/tSOL`、`feed/tUSDC`),服务端可以代签;手续费包含在用户这笔交易里。这不是新风险:这些密钥本来就是公开的,任何人都能写这些价格(这是 mock 的性质)。
- **用链上时间,不用本机时间**,避免本机时钟偏快写出"未来"的时间戳。
- **只有真正无法刷新时才报错**:价格账户不存在、从未有过价格、价格账户不是我们的 mock(比如将来换成真实预言机),此时提示"价格暂时不可用,请稍后重试",不提内部细节。
- **验证方式**:把价格维护进程**关掉**,价格过期 140 秒以上,再用全新钱包走完 借款、还款、取款——全部通过。借款的计算单元从 51,503 增加到 53,216,多出来的就是两条刷新指令。

`scripts/price-keeper.ts` 还保留着,但**不再是必需的**。

## 页面多快能反映出你刚发的交易(后续增补)

> **后续增补**(第 8 集代码定稿 `ep8-end` 之后才加的,只在 `main` 上,各集 tag 里没有):D-017。

最初的实时跟随只入库 `finalized` 的数据,交易确认后还要再等 30 秒以上页面才变化——用户点完借款,借贷池的数字半天不动。

现在跟随模式默认按 **`confirmed`** 入库:交易确认后几秒内页面就能更新(实测:链上确认用了 4.0 秒,API 在确认后 2.1 秒看到了变化)。前端在交易确认后还会**加速轮询** 45 秒(1.5 秒一次)。

`confirmed` 的代价是极少数情况下会回滚,所以配了一个**终局确认清扫**:

<!-- snippet: src/ingest/finalize.ts#ep6-finalize-sweep -->
```ts
/**
 * 乐观入库的安全网:confirmed 就入库让页面更快,之后逐步确认它们是否真的 finalized。
 *  - 状态是 finalized          → 标记为终局;
 *  - 查不到,且 finalized slot 已超过它 150 个 slot → 它在被丢弃的分叉上,删除(解码出的指令/事件随外键级联删除);
 *  - 其余(还在 confirmed、或还没过观察期)→ 下一轮再看。
 */
export async function finalizeSweep(db: Db, rpc: SweepRpc, batch = 100): Promise<{ finalized: number; dropped: number; pending: number }> {
  const rows = (await db.query('SELECT signature, slot FROM raw_tx WHERE NOT finalized ORDER BY slot LIMIT $1', [batch])).rows;
  if (!rows.length) return { finalized: 0, dropped: 0, pending: 0 };
  const finalizedSlot = await rpc.getFinalizedSlot();
  const statuses = await rpc.getSignatureStatuses(rows.map(r => String(r.signature)));
  let finalized = 0, dropped = 0, pending = 0;
  for (const [i, row] of rows.entries()) {
    const status = statuses[i], signature = String(row.signature);
    if (status?.confirmationStatus === 'finalized') {
      await db.query('UPDATE raw_tx SET finalized = TRUE WHERE signature = $1', [signature]); finalized++;
    } else if (!status && finalizedSlot >= Number(row.slot) + DROP_AFTER_SLOTS) {
      await db.query('DELETE FROM raw_tx WHERE signature = $1', [signature]); dropped++;
    } else pending++;
  }
  return { finalized, dropped, pending };
}
```
<!-- /snippet -->

- 入库时 `raw_tx.finalized = false`;清扫每轮检查这些交易的签名状态:已 `finalized` 的标记为终局;
- 如果一笔交易**查不到**,并且 finalized slot 已经超过它 150 个 slot(约 60 秒),就认定它在被丢弃的分叉上,**删除它,解码出的指令和事件随外键级联删除**;
- **观察期内查不到的不删**:负载均衡的 RPC 节点可能落后,暂时查不到一笔真实存在的交易,误删比晚删糟糕得多。

回填和扫区间(`--backfill`、`--tail`)仍然只认 `finalized`;`--commitment confirmed` 只允许用于 `--follow`。

## 水龙头

用户需要测试代币才能玩。水龙头是**独立进程**,只持有一个专用钱包,**只转账、不铸币**:管理员用 `faucet-setup` 一次性把足量的测试币铸造到水龙头钱包里,之后水龙头只是从里面转给用户。

<!-- snippet: src/faucet/limit.ts#ep8-faucet-limit -->
```ts
export function reserve(state: LimitState, wallet: string, ip: string, now: number, dailyMax = 2000):
  { ok: true; state: LimitState; next: number } | { ok: false; next: number } {
  const day = new Date(now).toISOString().slice(0, 10), count = state.day === day ? state.count : 0;
  const ips = Object.fromEntries(Object.entries(state.ips).map(([key, times]) => [key, times.filter(t => t > now - 3600_000)]).filter(([, times]) => times.length));
  const wallets = Object.fromEntries(Object.entries(state.wallets).filter(([, time]) => time + 600_000 > now));
  const hits = ips[ip] ?? [], deadlines = [now];
  if (wallets[wallet] !== undefined) deadlines.push(wallets[wallet] + 600_000);
  if (hits.length >= 5) deadlines.push(hits[hits.length - 5] + 3600_000);
  if (count >= dailyMax) deadlines.push(Date.parse(`${day}T00:00:00Z`) + 86400_000);
  const next = Math.max(...deadlines);
  if (next > now) return { ok: false, next };
  const updated = [...hits, now];
  const nextAfterGrant = Math.max(now + 600_000, updated.length >= 5 ? updated[updated.length - 5] + 3600_000 : now,
    count + 1 >= dailyMax ? Date.parse(`${day}T00:00:00Z`) + 86400_000 : now);
  return { ok: true, state: { wallets: { ...wallets, [wallet]: now }, ips: { ...ips, [ip]: updated }, day, count: count + 1 }, next: nextAfterGrant };
}
```
<!-- /snippet -->

限流:同一个钱包 10 分钟一次;同一个 IP 每小时 5 次;每天全局有上限。限流状态在内存里,**重启会清零**。

## 跑一遍

```bash
pnpm exec tsx scripts/faucet-setup.ts          # 一次性:创建水龙头钱包并充值(需管理员钱包)
pnpm exec tsx scripts/serve-api.ts             # 终端 1:API(需要 RPC_URL;POOL_GROUP 指定池子)
pnpm exec tsx scripts/faucet.ts                # 终端 2:水龙头 + 兑换台
pnpm exec tsx scripts/ingest.ts --follow       # 终端 3:实时跟随链上新交易(confirmed 乐观入库,见下)
(cd web && pnpm dev)                           # 终端 4:前端 http://localhost:5173
```

不想点界面,可以用端到端脚本——它用一个全新的钱包通过真实的 HTTP 接口走完整个流程:

```bash
pnpm exec tsx scripts/e2e-wallet.ts
```

> **后续增补**(第 8 集代码定稿 `ep8-end` 之后才加的,只在 `main` 上,各集 tag 里没有):Pyth 定价的 pSOL 银行有三个脚本:`add-pyth-bank.ts` 建币、加银行、绑定 Pyth(幂等);`verify-pyth-bank.ts` 直接调程序验证两个方向的借款;`e2e-pyth.ts` 经 HTTP 走完 SOL 换 pSOL → 存 → 借 → 还清 → 取出。代币的链上元数据(钱包里的名称与图标)用 `token-metadata.ts` 写入(D-021)。

在真实 devnet 上的一次运行:

| 步骤 | 结果 | 计算单元 |
|---|---|---:|
| 领测试币(水龙头) | 1,000 tUSDC + 10 tSOL 到账 | — |
| 首次存款 10 tSOL(自动创建账户) | ✓ | 27,328 |
| 借 200 tUSDC | ✓ 借份额 199,999,910 | 51,503 |
| 还清(`repay_all`) | ✓ 借份额归零 | 35,811 |
| 再存 100 tUSDC(账户已存在,不再创建) | ✓ | 22,579 |
| 取出全部 tUSDC | ✓ | 36,733 |
| 取出全部 tSOL | ✓ | 22,424 |

最后钱包里 tSOL 回到 10,tUSDC 是 999.999997——借了 200 又还清,**差的 0.000003 就是利息**。

没有 Phantom 的环境怎么测?前端有一个**只在开发模式可用**的测试钱包:`http://localhost:5173/?testwallet=任意种子`,密钥由种子派生、只在内存里。用它在界面上走了一遍同样的流程。生产构建里没有这段代码(构建后 `grep` 验证过)。

## 真实联调中发现的问题

离线测试 130 多项全部通过之后,接上真实 devnet 和真实浏览器,又暴露了这些问题:

1. **索引器有延迟,会让用户重复创建账户。** 最初的构建器只看数据库里的账户快照。用户刚存完款、索引器还没追上时,下一次存款会被当成"首次",**再创建一个账户**;快照里的余额槽位过期还会让 remaining 顺序排错。现在**用户账户的内容永远从链上读最新**,地址先查数据库,查不到就按 `group + authority` 过滤链上账户。
2. **数据库里有多个池子。** 每次重跑剧本都会新建一个 group,实时跟随会把它们全部入库,API 就不知道"当前池子"是哪个(此前的行为是返回 `null`,因为它不猜)。现在用环境变量 `POOL_GROUP` 指定;池子、账户、活动流都只看这个 group。
3. **跨域被浏览器拦下。** 页面用 `127.0.0.1` 打开时,水龙头(另一个端口)的请求被拦——放行名单写死了 `localhost`。`/api` 走同源代理,所以只有水龙头暴露了问题。现在按请求的 `Origin` 匹配白名单。
4. **`oracle_max_age = 0` 的默认值。** 最初的实现在 0 时默认取 240 秒。核对上游源码:对 `SwitchboardPull`,0 就是 0,没有默认值。编造默认值会掩盖配置错误,已去掉。
5. **脚本跑完不退出。** `sendAndConfirmTransaction` 会开 WebSocket 订阅,脚本成功后不主动退出,进程会一直挂着。

## 局限

- **仅 devnet、仅测试币。** 水龙头的限流在内存里,没有真正的防刷;没有信任代理时只看 socket IP,不信 `X-Forwarded-For`。
- **只支持普通 SPL Token。** 不支持 Token-2022 和 staked asset 这类特殊的 remaining accounts。
- **维护进程和改价工具并发时可能互相覆盖。** 它们都会写价格账户,可能读到旧价格后覆盖新值。如果不运行可选的维护进程,就没有这个问题。
- **Pyth 价格我们写不了。** Pyth 银行的借款/取款依赖 devnet 赞助账户持续更新;断更超过该银行配置的最大年龄时会被拒绝。pSOL 是 300 秒,pBTC/pETH/pHYPE 配置为 900 秒。
- **转发超时不等于交易没上链。** 原签名可能稍后成功,不要直接重复构建。
- **tSOL/tUSDC 的价格是 mock**(Switchboard 已关停,D-018);pSOL/pBTC/pETH/pHYPE 的配置价格来自 Pyth 真实行情(新增三家银行仍待链上执行)。

## 回顾

整个系列从"一笔链上交易长什么样",一直走到"让别人也能往里发交易"。能放心做最后这一步,靠的是前面七集打下的东西:**解码器能把任何一笔交易还原成人话**,所以我们发出去的交易,也能被同一套流水线解析、对账、展示。
