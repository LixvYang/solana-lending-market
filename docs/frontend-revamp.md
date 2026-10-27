# 前端改版：devnet 可用的借贷产品(D-023)

由 Codex 逐个实现，Claude 审查后在本文件写结论。状态:`todo` / `doing` / `review` / `done` / `rework`。

## 所有任务共同的规则

- **用词：界面上一律写"债务",不写"负债"**(用户要求，2026-10-22)。

- 先读 `AGENTS.md`、`docs/decisions.md` 的 D-020 与 D-023。遵守其中约定：一文件一概念、单文件尽量 ≤150 行、注释讲"为什么"、不加抽象层、依赖版本固定。
- **不新增依赖。** 图表继续手写 SVG(参照 `web/src/RateCurve.tsx`)。
- 界面文字用中文;颜色只用 `styles.css` 里的 CSS 变量，深浅色都要可读;窄屏(390px)不出现横向滚动。
- `?mock`(以及 `?mock&testwallet=bob` 连接开发测试钱包)必须能完整预览;如果新增了接口，同步在 `web/src/mock.ts` 里给出假数据。
- 不提交 git、不改 `.env`、不发送链上交易、不运行 `pnpm scenario --execute`。
- 完成前必须通过:`pnpm typecheck && pnpm test`(仓库根目录)与 `(cd web && pnpm typecheck)`。
- **不要修改本文件和 `docs/progress.md`**(可能有多个任务并行，由 Claude 统一记录)。结束时在最终回复里写"自述":改了哪些文件、怎么验证的、哪些没做或不确定;Claude 会抄进本文件。

## 任务

顺序:T0 ∥ T2 → T3 → T8 → T4 → T5 → T6 → T7(评估)。

### T0 API 读取性能 — done

现象:`/api/pool`、`/api/accounts` 每次 0.8–1.6 秒(本机 Postgres 实测),前端每 5 秒各轮询一次，首屏也要等它。

根因(Claude 已核实):`src/api/state.ts` 的 `readState` 用 `SELECT DISTINCT ON (address) * FROM account_states ORDER BY address, slot DESC`。`account_states` 有 27.8 万行、只有 37 个地址(每个地址约 7500 份快照),这条语句要对全表排序:`EXPLAIN ANALYZE` 1206 ms。用主键 `(address, slot)` 做递归跳跃扫描是 1.2 ms:

```sql
WITH RECURSIVE a AS (
  (SELECT address FROM account_states ORDER BY address LIMIT 1)
  UNION ALL
  SELECT (SELECT address FROM account_states WHERE address > a.address ORDER BY address LIMIT 1) FROM a WHERE a.address IS NOT NULL)
SELECT s.* FROM a CROSS JOIN LATERAL (SELECT * FROM account_states x WHERE x.address = a.address ORDER BY slot DESC LIMIT 1) s;
```

- 改 `readState` 用这条查询(结果集与原查询相同：每个地址最新 slot 的一行)。注释写清楚为什么不用 `DISTINCT ON`。PGlite 测试必须照样通过;加一个测试：同一地址多个 slot 时只取最新一行、多个地址各取一行。
- **不加缓存。** 理由：查询降到毫秒级后，缓存只会带来失效问题(用户刚发完交易要立刻看到变化)。
- 不在本任务里改写入逻辑。另外观察到 27.8 万行里只有 2173 种不同的(地址, 数据)组合，即 99% 的快照与上一份完全相同;"内容没变就不写"放进 T7 一起评估(它会影响 `verify-db` 的 md5 与历史曲线)。
- 自述里给出你能做到的验证(离线测试);真实 Postgres 的前后耗时由 Claude 实测。


### T1 资产详情页与路由 — done

目标：点市场列表的一行，进入该资产的详情页，而不是在列表下方切换卡片。

- hash 路由:`#market/<符号>`(如 `#market/tUSDC`)是"市场"tab 下的详情页;`#pool` 仍是列表。浏览器后退能回到列表，刷新能停留在详情页。扩展 `web/src/Tabs.tsx` 的 hash 解析即可，不引入路由库。
- 新组件 `web/src/market/AssetPage.tsx`(可拆小文件)。版式参照 Aave 资产页：
  - 顶部："← 返回市场"、图标 + 符号 + 名称 + 价格来源角标;右侧 4 个 KPI:总存款、可借流动性、利用率、预言机价格。
  - 左栏(主体):存款信息(存款 APR、总存款)、借款信息(借款 APR、总借款)、抵押参数(开仓/维持权重)、利率模型(复用 `RateCurve`,标出当前利用率与最优利用率)、代币说明。
  - 右栏：先放一个占位卡片"操作面板(T3)",宽约 380px,`position: sticky`。窄屏时右栏移到主体上方。
- 市场列表(`Markets.tsx`)的行点击改为进入详情页;"存入/借出"按钮暂时也进入详情页。列表下方原有的利率曲线 + `BankDetail` 区块移除(内容已并入详情页)。
- 验收：浏览器 `?mock` 下点 tUSDC 行进入详情页、后退回列表、直接打开 `#market/tSOL` 可用、未知符号显示"找不到这个资产"并给返回链接;1280 与 390 宽无横向溢出。

#### Codex 自述

- 修改 `web/src/Tabs.tsx`、`web/src/Markets.tsx`、`web/src/App.tsx`、`web/src/styles.css`，新增 `web/src/market/AssetPage.tsx`；为使指定 web typecheck 通过，在已有未提交改动的 `web/src/Xray.tsx` 补上其正在使用的 `explorer` 导入，保留原有改动。
- 验证：根目录 `pnpm typecheck && pnpm test` 通过（174 项）；`cd web && pnpm typecheck` 通过。
- 未做 T2–T7。浏览器验收未完成：本地 Vite 启动因环境限制返回 `listen EPERM`，未能核对 `?mock` 的实际点击、后退和 1280/390 布局；哈希路由行为已通过代码检查，视觉溢出仍待浏览器确认。

### T2 风险预览的纯函数与测试 — done

目标：给 T3 的操作面板提供"操作前 → 操作后"的风险数字。

- 新文件 `web/src/risk.ts`,纯函数、无 React、只用 `import type` 引用 `@contract` 类型(这样根目录的 node 测试能直接跑)。
- 输入：banks(`BankView[]`)、当前头寸(`BalanceView[]`,可为空)、一次操作 `{ action, bank, amount(原生单位字符串) }`。
- 输出:
  - `before` / `after` 各含:加权资产 USD、加权负债 USD(维持口径与开仓口径都要)、健康因子 = 维持加权资产 ÷ 维持加权负债(无负债时为 `null`,界面显示"∞/无负债")、已用借款额度 = 开仓加权负债 ÷ 开仓加权资产。
  - `maxBorrow`:该资产在开仓口径下还能借多少(原生单位)。
  - `liquidationPrice`:仅当只有一种抵押资产时，给出该抵押资产价格跌到多少会触发清算;否则 `null`。
  - `blocked`:操作后开仓健康度 < 0 时为该原因字符串("超过可借额度"),否则 `null`。
- marginfi 规则：同一资产的头寸要么是存款要么是负债;借某资产时先抵扣该资产的存款(见 `ActionForm.tsx` 里的提示)。还款/取款不超过现有头寸。
- 公式与 `src/api/math.ts` 的 `#region ep7-health` 一致(资产 × 价格 × asset 权重，负债 × 价格 × liability 权重)。前端只有单一价格，在文件头注释说明：程序对 Pyth 价格用置信区间低/高价，所以 pSOL 预览会略偏乐观，以服务端模拟为准。
- 测试 `web/src/risk.test.ts`(node:test),并把 `web/src/**/*.test.ts` 加入根 `package.json` 的 `test` 脚本。至少覆盖：无负债存款、借款后健康因子下降、借超额度被 `blocked`、单一抵押的清算价、借款抵扣同资产存款、还清后回到无负债;再用 `web/src/mock.ts` 里 `?mock=liquidation` 的 Bob 数据核对维持健康度与 `health.maint`(−750)一致。

### T3 资产页右侧操作面板 — done

目标：在资产页内完成存/借/还/取，签名前看到风险变化(参照 Morpho 市场页右栏)。

- 把 `wallet/ActionForm.tsx` 改造成可固定资产的面板(详情页里隐藏代币选择器)，替换 T1 的占位卡片。未连接钱包时面板显示"连接钱包"按钮与一句说明。
- 输入数量时实时显示(用 T2):健康因子 `前 → 后`(颜色：≥1.5 正常、1.1–1.5 警告、<1.1 危险)、已用借款额度条、借款时"最多可借"并让"最大"按钮用它、单一抵押时的清算价。数字旁注明"预估，以模拟为准"。
- `blocked` 时主按钮禁用并显示原因;否则沿用"预览 → 签名并发送"流程。服务端模拟失败时显示模拟的错误，优先于前端预估。
- 删除"存款借款"tab;它的"钱包资产 / 我的头寸"内容暂时保留在一个新 tab "我的仓位"里(T4 再重做)。其他 tab 里跳转到"存款借款"的入口改为跳到对应资产页。
- 顺带处理 T1 审查遗留的三项(见文末"T1 审查")。
- 验收:`?mock&testwallet=bob` 下在 tUSDC 页输入存款数量看到预览;切到借款输入超额数量看到 blocked;`?mock=liquidation&testwallet=...` 下健康因子 <1 显示危险色。

### T4 我的仓位页与新手引导 — done(经 T4b 返工)

另：市场列表的"存入/借出"按钮目前都只是进入资产页(默认停在"存款")。本任务实现预选动作，例如 `#market/tUSDC/borrow`,"我的仓位"各行的按钮也用它。

参照 Aave Dashboard:顶部净资产、净 APY、健康因子、已用额度;下面"我的存款 / 我的借款 / 可存资产 / 可借资产"四个列表，每行带按钮跳到对应资产页并预选动作。未连接或没有头寸时，显示上手清单：①连接钱包(devnet)②领 SOL(faucet.solana.com)③领测试币(复用 `GetTokens`)④存入抵押 ⑤借出;已完成的步骤打勾(根据钱包余额与头寸判断)。

### T5 资产页的流水与清算记录 — done(经 T5b 返工)

资产页主体增加两个区块(参照 Morpho 的 Activity / Risk):本资产的交易流水、本资产的清算记录;每行可点开"交易拆解"。先查 `/api/activity` 是否支持按 bank 过滤，不支持就在后端加一个可选参数(带测试),不要在前端拉全量再过滤。

### T4b 我的仓位返工 — done

Claude 审查 T4 的结论见文末"T4 审查"。需要改的:
1. 没有任何头寸时，健康因子 KPI 显示绿色"∞",应为"—"(与 T3 修复 3 同理：没有资产也没有债务，不是"无限健康")。有存款无债务时才显示"∞ · 无债务"。
2. "钱包资产"卡片与"可存资产"列表内容重复(都是余额 + 存入按钮)。删掉"钱包资产"卡片;SOL 余额(付手续费)与"领取测试币"(`GetTokens`)改成 KPI 下方的一条紧凑提示条，例如"钱包 SOL 2.5 · 领取测试币 · 用 SOL 兑换"。SOL 不足 0.01 时提示条变成警告色并给 faucet 链接(保留原逻辑)。
3. `web/src/mock.ts` 的 `/api/wallet/` 给每种币都发 1e10 原生单位，pBTC 变成 100 个(约 $840 万)。改为与水龙头一次发放量相当的数量(`src/oracle/pyth-banks.ts` 的 faucetAmount;tUSDC 1000、tSOL 10)。
4. `portfolio.ts` 的加权资产/债务、健康因子、已用额度与 `risk.ts` 的 `metrics` 重复实现。改为复用 `risk.ts`(必要时从 risk.ts 导出 metrics 计算),只保留净资产与净 APY 的计算;测试相应调整。

### T5b 资产页流水与清算记录返工 — done

Claude 审查 T5 的结论见文末"T5 审查"。需要改的:
1. **布局**:资产页左栏的流水表比栏宽(708 px vs 692 px),伸到右侧操作面板下面，"拆解 ›"被盖住。表格必须在栏内(外层 `min-width: 0` + `overflow-x: auto`,或减少列)。
2. **去掉"代币"列**(单一资产页每行都是同一个币);该列单元格还与同行其他单元格垂直错位。
3. **紧凑行**:时间一行显示(例如 `10/14 18:31`,悬停 `title` 给完整时间与 slot),IDL 原名只在"拆解"里出现;每行一行高。最多先显示 10 行，"加载更多"沿用分页。
4. **清算记录改为专用表**(参照 Morpho 的 Risk 区块):列为 时间 · 被清算账户(有标签显示标签)· 没收抵押(数量 + 币)· 偿还债务(数量 + 币)· 健康度 前 → 后 · 拆解。数据都在 `LendingAccountLiquidateEvent` 里(字段是下划线写法):`liquidatee_marginfi_account`、`asset_bank`/`liability_bank`、`pre_balances`/`post_balances`(`liquidatee_asset_balance` 之差 = 没收的抵押，`liquidatee_liability_balance` 之差 = 偿还的债务;原生单位、f64)、`liquidatee_pre_health`/`liquidatee_post_health`。后端新增 `GET /api/liquidations?bank=…`(可选 bank,匹配 asset_bank 或 liability_bank),返回已解析的字段，带 PGlite 测试(剧本里那笔清算：没收 10 tSOL、健康度 −750.0018 → −701.2518)。同步 `web/src/mock.ts`(只改新增接口的处理)与 `src/api/types.ts`。

### T6 细节打磨 — done

上一轮已完成：市场按总存款美元值降序(放在 `web/src/api.ts`,所有页面一致，接受)。本轮完成其余各项，并追加:
- 资产页的流水/清算区块只在打开时请求一次，失败后不重试(API 重启的几秒内打开页面会一直显示"读取活动失败")。改为与其他数据一样随轮询刷新，或失败后自动重试。
- 清算表"健康度 前 → 后"显示的是程序报告的 USD 差值(−750 → −701),而其他页面的"健康因子"是比值(2.14)。同一个词两种口径会误导。清算表列名改为"健康度(USD 差值)",并用 `title` 说明"加权资产 − 加权债务，小于 0 可清算"。

另：现在有 6 个资产，市场列表顺序取决于数据库返回顺序(实测是乱的:pETH、pBTC、pSOL、tSOL、tUSDC、pHYPE)。按总存款美元值降序排列(Aave/Morpho 的默认),并在 API 层排序，让所有页面一致。

钱包按钮汉化为"连接钱包"并修复连接后左侧图标空白;交易结果改为右下角 toast(仍提供 Explorer 与"交易拆解"链接);"链上数据"tab 合并链上活动与账户(账户部分改名"清算监控")，活动行压成单行。

### T8 新增资产 pBTC / pETH / pHYPE(Pyth 实时价)— done(已上链)

用户要求借贷池增加 BTC、ETH、HYPE。真实行情来自 Pyth devnet 赞助推送(与 pSOL 同一机制,D-019)。Claude 已在 devnet 核实四个推送账户都存在、owner 是 Pyth Receiver、校验级别 Full:

| 资产 | feed id | shard 0 账户 | 实测距上次更新 |
|---|---|---|---|
| BTC/USD | `e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` | `4cSM2e6r…PSPo` | 141 s |
| ETH/USD | `ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace` | `42amVS4K…FX6XC` | 141 s |
| HYPE/USD | `4279e31cc369bbcc2faf022b382b080e32a8e689ff20fbc530d2a603eb6cd98b` | `6usXZCEM…m19Y` | 274 s |

命名沿用 `p` 前缀(= Pyth 定价的测试币)。Codex 只写代码与离线测试，**链上执行由 Claude 跑**。

- `src/oracle/pyth.ts` 的 `FEED_IDS` 增加三项。
- 把 `scripts/add-pyth-bank.ts` 改成按符号参数化(`--symbol pBTC` 等，默认 pSOL 保持原行为与原派生种子，已上链的 pSOL 不能变)。每个资产的小数位与风险参数集中在一张表里：pBTC 8 位、pETH 8 位、pHYPE 8 位(与 Solana 上常见的跨链 BTC/ETH 一致，三者统一便于讲解);风险参数先照搬 tSOL;`oracle_max_age` 三者都用 900 秒。理由(Claude 2026-10-22 实测：约 22 分钟内每 15 秒读一次账户数据，记录数据变化的间隔):SOL 60–243 秒;BTC 149/308/340 秒(采样开始前已 141 秒未更新，推算另有约 440 秒);ETH 149/463/161 秒;HYPE 262–376 秒。若照搬 pSOL 的 300 秒，借款/取款会经常因 `PriceStale` 被拒;900 秒约为观测最大间隔的 2 倍，测试网的代价只是价格可能旧几分钟。注释写明这一点。
- 水龙头与兑换台(`src/faucet/`)支持新资产：兑换按 Pyth 价格，水龙头每种发放约值 $500 的数量(按当时价格算，或写死合理整数并说明)。
- `program/devnet.json` 的 labels 结构支持新资产(地址等 Claude 上链后填)。
- 前端 `web/src/tokens.tsx`:BTC、ETH、HYPE 的内联 SVG 图标(风格与现有一致：圆形底 + 简化标志 + 右下角 `P` 角标)与中文说明;`web/src/mock.ts` 加入这三个银行，让 `?mock` 能预览 5–6 个资产的列表。
- 测试：参数化后 pSOL 的派生地址与原来一致;新 feed 账户地址与上表一致;兑换台对新资产的报价。

### T9 项目改名为"借贷市场"(文档、README、教程、分镜)— done

作者决定(D-025 之后):不再把项目当作索引器，项目对外就叫"借贷市场"(英文 `solana-lending-market`),文档与界面一致。

**改:**
- `README.md`、`AGENTS.md`、`docs/00-goals.md`、`docs/chapters/*.md`、`video/*.md`、`docs/recording-checklist.md` 里**对项目本身的称呼与定位**:"solana-lending-indexer / 借贷池 X 光 / Solana 借贷看板 / 我们的索引器项目"等 → "借贷市场"。项目一句话定位改为：在 Solana devnet 上部署 marginfi,做一个能真实存借的借贷市场;从部署协议、造数据、解析链上数据、存储到前端，全部自己实现。
- "X 光"(界面上已改名)→"交易详情"。
- `package.json` 的 `name`:`solana-lending-market`;`web/package.json`:`solana-lending-market-web`。
- 合集结构保留 EP1–EP8 的技术内容不变，只调整各集标题/导语里的项目称呼(例如 EP7 不再叫"X 光前端",而是"借贷市场前端")。

**不改(改了会出错或失真):**
- `scenario/lib/actors.ts` 与 `web/src/wallet/test-wallet.ts` 里的派生种子字符串 `solana-lending-indexer/…`——所有确定性地址(剧本账户、mint、银行、group、测试钱包)都由它算出，改了就指向链上不存在的账户。在两处加一行注释说明"历史名称，地址由它派生，不能改"。`docs/chapters/ep03-protocol-and-scenario.md` 与 `docs/tasks/m1-scenario.md` 里引用这段代码/种子的地方同理保持原样，可加一句说明。
- `assets/tokens/*.json`、`scripts/token-metadata.ts` 里的 GitHub 地址(链上元数据指向它们;是否改由 GitHub 仓库改名决定，Claude 另行处理)。
- 描述技术机制时的"索引 / 解析 / 解码 / 入库"等词照常使用(EP4–EP6 讲的就是这些);只是不再用"索引器"指代整个项目。`src/` 代码注释里描述模块职责的"索引器"(如 `src/ingest`)可以保留。
- `.agents/runs/` 是历史运行记录，不动;`docs/decisions.md` 的历史条目不改写。
- 代码片段区域(`#region`)与 `{{ snippet }}` 引用不要破坏:完成后 `node --import tsx scripts/snapshot-docs.ts --check` 必须 0 过期 0 失败。

### T10 HYPE 改为自有固定价格(不依赖 Pyth)— done(D-027)

**背景:** D-026,Pyth devnet 的 HYPE 推送断更 36 分钟，持有 pHYPE 的账户借款/取款全部失败。作者决定:HYPE 不再用 Pyth,改成固定价格，由后台程序定时把价格写上链;BTC、ETH 仍用 Pyth。

**核实过的约束:** mrgn-0.1.0 的 `OracleSetup` 只有 None / PythLegacy / SwitchboardV2 / PythPushOracle / SwitchboardPull / StakedWithPythPush,**没有 Fixed**(那是更新版本才有的)。所以沿用 tSOL/tUSDC 的做法:mocks 程序拥有的 Switchboard 布局价格账户，银行按 `SwitchboardPull(4)` 读;价格由我们写入(`scenario/lib/mock-feed.ts`、`src/oracle/mock-write.ts`)。

**要做(代码与离线测试;链上执行由 Claude 跑):**
1. **符号改名 pHYPE → tHYPE**(`t` 前缀 = 我们定价的测试币，与 tSOL/tUSDC 一致)。只改链下标签与代码里的符号;**mint 与 bank 的派生种子保持 `mint/pHYPE`、`bank/pHYPE`**(已上链，改了地址就变了),在派生处加注释说明。新价格账户种子用 `feed/tHYPE`。
2. **价格:** 固定 $80(约为 2026-10-22 的市价，取整),脚本参数 `--price` 可改。
3. **新脚本 `scripts/fix-hype-oracle.ts`(幂等):** 创建或更新 `feed/tHYPE` 价格账户并写入价格;把 HYPE 银行的预言机改为 `lending_pool_configure_bank_oracle(4, feed)`;写入链下标签 `tHYPE`(mint 与 bank)。已是目标状态的步骤跳过。完成后显式 `process.exit`(D-024 的教训)。
4. **后台刷新:** `src/keeper/price.ts` 的 `refreshPrices` 与 `src/oracle/mock-write.ts` 的 `mockFeedSigner` 默认名单都加入 `tHYPE`,使 `scripts/price-keeper.ts` 定时刷新它、交易构建器在用户交易里也能顺便刷新。注意 `scenario/lib/actors.ts` 的 `tokens`(剧本只用 tUSDC/tSOL)不要改，避免影响剧本。
5. **其他引用:** `src/oracle/pyth-banks.ts` 移除 pHYPE(BTC/ETH/SOL 不变);水龙头/兑换台的发放与定价改为 tHYPE(价格账户读银行实际用的那个);`web/src/tokens.tsx` 图标角标改为 `t`、说明改为"价格由我们固定为 $80,后台程序定时写上链";`web/src/mock.ts`;`program/devnet.json` 的 labels 由 Claude 上链后再改。
6. **测试:** `feed/tHYPE` 地址派生;keeper 刷新名单含 tHYPE;`mockFeedSigner` 能识别 tHYPE 价格账户;水龙头发放 tHYPE;兑换台按 mock 价报价。

### T11 降低 Helius RPC 用量 — done

**背景(2026-10-22):** Helius 免费版每月 100 万额度,**devnet 也计费**(作者控制台截图:本周期已用 113,792)。按代码估算,price-keeper 现在每 60 秒对 3 个价格账户各发一笔交易，每个约 8 次 RPC,每月约 104 万，单项就超额;额度用完后借贷、兑换、钱包余额全部失效。浏览器标签页切到后台时 `usePoll` 已暂停(不用改)。

**要做:**
1. **keeper**(`src/keeper/price.ts`、`scripts/price-keeper.ts`):一次 `getMultipleAccountsInfo` 读全部 mock 价格账户;`getSlot` + `getBlockTime` 每轮只调一次;所有需要刷新的价格写在**同一笔交易**里(多个 feed signer 一起签);默认间隔改为 180 秒(tSOL/tUSDC 的 `oracle_max_age` 是 240 秒、tHYPE 是 900 秒，交易构建器还会在用户交易里顺便刷新，180 秒是安全的),注释写明理由。每轮在标准输出打印一行(时间、刷新了哪些、签名或失败原因),便于确认它在工作。
2. **兑换汇率**(`src/faucet/swap.ts`、`src/faucet/prices.ts`):`rates()` 用一次 `getMultipleAccountsInfo` 读全部价格账户;**服务端缓存 15 秒**,所有客户端共用。`quote()` 不走缓存(成交价必须现读)。保留 D-026 的逐资产降级。
3. **前端兑换页**(`web/src/swap/SwapPage.tsx`):只在"兑换"tab 激活时轮询汇率(把当前 tab 传进去，或在 TabPanel 隐藏时不挂载轮询)。
4. **钱包余额**(`src/api/wallet.ts`):`getBalance` + `getMultipleAccountsInfo` 合并为一次 `getMultipleAccountsInfo([钱包, ...ATA])`(钱包账户不存在时 lamports 为 0)。前端 `App.tsx` 钱包轮询空闲时 15 秒，发完交易后的快速刷新(1.5 秒、45 秒)保持不变。
5. **测试:** keeper 一轮只发一笔交易、包含全部过期 feed 的写入;汇率 15 秒内重复调用不再访问 RPC、过期后重新读取;`quote` 不使用缓存;钱包只调用一次 RPC 且余额正确。

### T12 索引进程跟随新交易时降低 RPC 用量 — done

**背景:** 现在没有常驻的索引进程，用户在界面上发的交易不会入库("我的仓位""链上活动"不更新;Claude 实测 tHYPE 端到端的几笔交易不在 `raw_tx`)。但 `ingest --follow` 每 5 秒一轮，每轮约 4 次 RPC(查新签名、账户快照、价格快照、终局清扫),每月约 200 万次，超过 Helius 免费额度(100 万，devnet 也计费)两倍。

**要做:**
1. `--follow` 默认每 15 秒一轮(`--interval 秒` 可改)。每轮只做一次 `getSignaturesForAddress`(遇到已知签名即停，保持现状)。
2. **只在有新交易入库时**才做账户快照(`syncStored`);此外每 5 分钟做一次兜底快照(Pyth 价格账户会自己变，资产页价格需要新快照)。终局清扫只在有待确认(pending)的交易时做。
3. 每轮打印一行(时间、新交易数、是否快照、是否清扫),便于确认它在工作。
4. 测试：无新交易时一轮只调用 1 次 RPC;有新交易时会快照;距上次快照满 5 分钟会兜底快照;无 pending 时不清扫。
5. 预计每月约 9 万次(15 秒 × 1 次)+ 兜底快照约 2 万次 + 有交易时的增量。注释写明这个预算。

### T13 部署准备 — done

目标：前端放 Vercel;API、兑换台、price-keeper、索引进程放一台常驻主机;数据库用托管 Postgres(Supabase)。

1. **监听地址**:`scripts/serve-api.ts`、`scripts/faucet.ts` 现在写死 `127.0.0.1`。改为环境变量 `HOST`(默认仍 `127.0.0.1`,部署时设 `0.0.0.0`);端口沿用 `PORT` / `FAUCET_PORT`。
2. **跨域**:`src/api/http-body.ts` 的 `ALLOWED_ORIGINS` 写死本地地址。改为本地默认值 + 环境变量 `ALLOWED_ORIGINS`(逗号分隔，部署时填 Vercel 域名)。兑换台同理。
3. **前端后端地址**:前端现在用相对路径 `/api` 靠 Vite 代理。增加 `web/vercel.json`,把 `/api/*` 转发到环境变量指定的后端(Vercel rewrites 不能读环境变量的话，就在构建时用 `VITE_API_BASE`;两种方式选一种，注释写清楚为什么)。兑换台地址同理(现在从 `/api/config` 读，保持)。
4. **mocks 程序地址**:`scenario/lib/mock-feed.ts` 的 `mocksProgram()` 只读 `program/out/program-ids.json`,而 `program/out/` 不入库(含程序私钥),服务器上 clone 后 keeper 会启动失败。没有构建产物时退回读入库的 `program/devnet.json`(与 D-022 的 `oracleOwners` 一致)。
5. **keeper 不用管理员钱包**:现在 keeper 用 `ANCHOR_WALLET`(group 管理员)付手续费。写 mock 价格只需要 feed 签名者(由公开种子派生)+ 一个付费账户，不需要管理员权限。改为读 `KEEPER_KEYPAIR`(只放少量 SOL 的专用钱包);没设时报错说明，不要静默退回管理员钱包。管理员私钥不应出现在服务器上。
6. **部署文件**:根目录 `Dockerfile`(一个镜像，按启动命令区分 api / faucet / keeper / ingest)与 `docker-compose.prod.yml`(四个服务 + `restart: unless-stopped`,数据库连外部 `DATABASE_URL`,不含 Postgres);`.env.example` 列出全部变量(不含真实值)。私钥通过环境变量传 JSON 数组或挂载文件，二选一并说明。
7. **文档**:新增 `docs/deploy.md`:Vercel 前端、主机上四个服务、Supabase 数据库、迁移命令(`scripts/migrate.ts`)、首次回填、需要的钱包与各自最少 SOL、每月 RPC 预算。
8. 测试：监听地址与允许来源读取环境变量;`mocksProgram()` 在没有 `program/out` 时读 `devnet.json`;keeper 缺 `KEEPER_KEYPAIR` 时明确报错。

### T14 界面设计规范落地 + 交易后同步状态 — done

作者给出十条界面规范(2026-10-23),并要求：因 T12 把索引跟随放慢到 15 秒，用户发完交易后界面可能十几秒不变，要避免困惑。Claude 已清点现状：字号 19 种、圆角 10 种、阴影 17 处、动画 7 处、卡片左侧色条 3 处、中点"·"33 处、大量硬编码颜色、边框全是 1px。

**A. 颜色(Radix UI Colors)**
- `web/src/radix-colors.css` 已由 Claude 从 `@radix-ui/colors@3.0.0` 原样生成(slate、blue、green、red、amber、orange、violet,浅色 + 深色)。在 `main.tsx` 引入;**不要改其中的值，不新增依赖**。
- `styles.css` 里所有颜色改为引用这些变量，删除原有色板与全部硬编码颜色(含 `#fff`;按钮上的白字用 Radix 约定:实色 9 步配白字,amber 9 配深字)。按 Radix 步阶用法：页面背景 slate-1,卡片 slate-2;控件底色 3/4/5(常态/悬停/按下);分隔线与卡片边框 slate-6,可交互控件边框 slate-7,聚焦 blue-8;主按钮 blue-9/悬停 blue-10;次要文字 slate-11;主要文字 slate-12。状态：正向 green-11、危险 red-11、警告 amber-11;状态底色用对应色阶的 3。图表系列：借款 blue-9、存款 orange-9;SVG 里的颜色同样用变量。
- 代币图标里的品牌色(SOL 渐变、USDC 蓝、BTC 橙、ETH 紫等)是代币标识，保留;角标颜色改用 Radix(t 角标 orange-9,P 角标 violet-9)。

**B. 字号、边框、圆角、阴影、动画**
- 字号只用三种:**12px**(标签、次要信息、表头)、**14px**(正文、表格、按钮)、**24px**(页面标题与关键数字)。层级靠字重(400/500/600)和颜色(slate-11 / slate-12)区分。删除 11px、12.5px、13px、15px、17px、18px、20px、22px、28px、36px、48px。代币图标 SVG 内部的角标文字不算界面字号。
- 边框一律 `0.5px solid`(用 `border`,不用 `inset box-shadow` 模拟)。
- 圆角两档：卡片/浮层 12px,控件(按钮、输入框、选择器、标签)8px;嵌套时内层 = 外层 − 内边距(例如 12px 卡片内、内边距 4px 的分段控件 → 8px)。状态标签 4px。去掉 `999px` 胶囊形状(头像/图标圆形除外)。
- 阴影只留在浮层(交易详情抽屉、代币下拉、toast):一种 `0 8px 24px` 低透明度阴影;卡片、按钮、输入框不用阴影。
- 删除全部卡片/toast/字段的**左侧色条**(含 `.transaction-toast` 与交易详情的 `.field`)。
- 动画：删除装饰性动画(脉冲圆点、翻转按钮旋转等);保留的过渡统一 `250ms ease-out`。加载用文字而不是旋转图标。
- 对齐：数字列右对齐且使用 `tabular-nums`;图标与文字按视觉中心对齐(图标与相邻文字同一基线组);卡片内边距统一 16px,区块间距统一 16px。

**C. 文案(面向会用钱包、但不熟悉 marginfi 内部的普通用户)**
- **不用"·"做分隔**:改为分列、换行或空格分组。
- **删除冗余解释**:健康度公式、区块标题旁的说明小字、"按当前 APR 估算""预估，以模拟为准""五步完成首次借贷……""汇率每 30 秒更新……""连接 devnet 钱包后，可在此存入……"等。需要时用 `title` 也不要，直接删。
- 空状态一句话:"还没有存款""还没有借款""还没有交易"。
- 价格来源角标:Pyth 定价的资产显示"Pyth";我们定价的资产**不显示角标**(原"mock 价"对用户是术语)。代币副标题去掉"(mock 价)"之类括注，例如"测试 SOL"。
- 术语统一：存款、借款、还款、取款、债务、健康因子、利用率、可借、抵押率。不要造新词;"维持健康度""开仓"等内部术语只留在交易详情抽屉里。
- 资产页参数表的"抵押权重 · 开仓 / 维持"等改为两行或两列:"抵押率"(开仓权重)、"清算线"(维持权重);债务权重同理用"借款权重"一行即可(开仓/维持两列)。

**D. 交互(减少需要判断的地方)**
- **操作面板一步完成**:去掉"预览 → 签名并发送 / 修改"。主按钮文案为"存入 1.5 tUSDC"这类动作 + 数量;点击后构建并模拟，通过则直接请求钱包签名;模拟失败在按钮上方显示原因，按钮保持可点。风险预览照常在输入时显示。
- **去掉"还清全部 / 取出全部"复选框**:还款/取款时点"最大"即设为全部(`all = true`,含利息由程序结算),输入框显示"全部";再编辑数量即取消。
- **市场列表去掉每行的"存入 / 借出"按钮**:整行进入资产页(行尾一个 › 提示可点)。
- **去掉主题切换按钮**,跟随系统(删除 `useTheme` 与 `data-theme` 写入;`radix-colors.css` 的 `data-theme` 选择器保留无妨)。

**E. 交易后同步状态(作者要求)**
- **后端立即入库**:`/api/send` 在交易 `confirmed` 后，立即 `getTransaction` 这一笔 → `insertRawTx(…, finalized=false)` → `decodePending` → 对该交易涉及的 marginfi 账户与银行及其价格账户 `snapshotAccounts`/`snapshotOracles`。失败不影响返回(交易已上链;索引进程稍后也会补上),返回体加 `indexed: boolean`。`WalletRpc` 增加 `getTransaction`。只在用户发交易时多几次 RPC,不增加平时轮询。测试：确认后立即可在 `/api/activity` 查到;入库失败时 `indexed=false` 且发送结果仍是 confirmed。
- **前端"同步中"**:交易确认后把签名记为待同步;在"我的仓位"标题旁、资产页操作面板顶部显示"同步中"(12px,slate-11,无动画),直到 `/api/activity` 里出现该签名(或 60 秒后)才消失;期间加速轮询保持(现有 45 秒 1.5 秒轮询)。超过 60 秒仍未出现时改为"数据稍后更新",不弹窗。
- toast 保留"交易已确认"与"在 Explorer 查看""交易详情"两个链接，不加说明文字。

**F. 验收**:`pnpm typecheck && pnpm test`、`(cd web && pnpm typecheck)`;自查 `grep` 结果：`styles.css` 与 `*.tsx` 中除 `radix-colors.css` 外无十六进制/rgb 颜色(代币图标品牌色除外)、无 "·"、`font-size` 只有 12/14/24、无 `border-left`、`border` 宽度只有 0.5px。浏览器视觉验收由 Claude 做。

### T14b 界面审查返工 — done

Claude 在浏览器(浅色、深色、390 宽)逐页审查 T14 后的结论。机械检查已通过(无中点、无左色条、无硬编码颜色、边框 0.5px、字号 12/14/24、阴影只在浮层、无动画)。以下按页面列出要改的:

**全局**
1. 删除页头副标题"在 Solana devnet 上存款赚息、抵押借款"(有 Devnet 标签已足够)。窄屏时钱包按钮与标题同一行、靠右，不要另起一行。
2. 钱包按钮的图标与文字之间缺间距(8px)。
3. **字号漏网**:`.card h2 small` 等处去掉了显式字号，浏览器按 `smaller` 算成 11.67px(低于 12px 下限)。所有 `small` 明确设为 12px。
4. 空值统一用"—",不要混用"–"。
5. 页脚只留"测试网演示，代币没有真实价值。基于 marginfi mrgn-0.1.0。",去掉程序地址与"不是 marginfi 官方前端"。

**市场页**
6. 指标卡"总存款"下的"6 个资产"删掉(列表标题已有"全部资产 6 个")。
7. 列名"最高抵押率"改为"抵押率"(与 T14 统一的术语一致)。

**资产页**
8. 信息去重：页头指标卡改为 存款 APR、借款 APR、总存款、利用率 四项;"资产状况"卡片改名"参数",只保留 抵押率(开仓资产权重，百分比)、清算线(维持资产权重，百分比)、借款权重(开仓债务权重，百分比)三行;删除"价格账户"行和与页头重复的 APR/总量块。参数显示为百分比(100%、80%、110%),不要显示 1、1.1 这样的小数，不要"开仓/维持"字样。
9. 资产符号标题用 24px(现在 14px,弱于旁边 24px 的价格)。
10. 操作面板删除标题"操作 tUSDC";数量标签去掉重复的符号("还款数量",右侧代币标签已显示 tUSDC)。
11. 没有输入有效数量时不显示风险预览(现在显示"健康因子 — → —"和空的额度条)。

**我的仓位**
12. 删除页面大标题"我的仓位"(与选中的 tab 重复)。
13. 新手引导改为一行紧凑步骤条：已完成的步骤只显示勾和标题;未完成的显示序号和标题;**只有当前这一步**带操作入口(按钮或链接)。删除每步下面的说明句。全部完成后整块不显示。
14. 没有任何头寸时不显示四个指标卡(全是"—"),引导是主角;有头寸后才显示。
15. 钱包提示条:"领取测试币"链接与"领取"按钮重复，只留一个按钮"领取测试币";"用 SOL 兑换"保留为链接。
16. 没有抵押时不显示"可借资产"列表(现在整列 0 与置灰按钮),改为一行空状态"存入抵押后可借款"。
17. 列表行内的数量列右对齐并紧贴操作按钮(现在悬在行中间)。

**兑换页**
18. 删除右上角"成交数量按报价锁定"。
19. `?mock` 预览缺兑换台配置与汇率接口，兑换页显示"兑换台未配置"。在 `web/src/mock.ts` 补上 `/api/config` 的 `faucet_url` 以及兑换台 `/swap/rates`、`/swap/quote` 的假数据，让 mock 能预览兑换页。

**链上数据**
20. "链上活动"标题旁的说明小字删除(T14 漏删)。

验收：两处 typecheck 与全量测试通过;不新增字号、颜色、圆角种类。浏览器复查由 Claude 做。

### T15 适配云厂商容器平台 — done

目标：同一个镜像可直接部署到 Railway / Render / Fly.io / Cloud Run / ECS 这类容器平台，不依赖某一家的专有功能(12-factor:配置走环境变量、日志走标准输出、进程无本地状态)。

1. **端口**:平台注入 `PORT` 时监听 `0.0.0.0:$PORT`;没有 `PORT` 时保持本地默认(`127.0.0.1`,API 8787、兑换台 8788)。显式设置的 `HOST` 优先。
2. **单一入口**:`scripts/start.ts` 按 `SERVICE=api|faucet|keeper|ingest` 启动对应服务(ingest 为 `--follow`);Dockerfile 的 `CMD` 改为它。`docker-compose.prod.yml` 四个服务都用同一镜像，只是 `SERVICE` 不同。
3. **健康检查**:API 与兑换台 `GET /healthz`(执行 `SELECT 1`,失败返回 503,不调用 RPC)。keeper 与 ingest 也开一个只有 `/healthz` 的 HTTP 端口(`$PORT`,本地默认不开),返回最近一次成功轮次的时间;超过 3 个周期没有成功就返回 503,让平台重启卡住的进程。健康检查不能消耗 RPC 额度。
4. **平滑退出**:收到 `SIGTERM`/`SIGINT` 时,HTTP 服务停止接收新连接、等进行中的请求结束;keeper/ingest 等当前轮次结束;最后关闭数据库连接池。设 10 秒上限，超时强制退出。
5. **私钥从环境变量注入**:`KEEPER_SECRET_KEY`、`FAUCET_SECRET_KEY`,接受 JSON 数组或 base58 字符串;与现有 `*_KEYPAIR` 文件路径二选一，两者都设时报错。错误信息、日志里不得输出私钥内容(写测试)。
6. **启动时迁移**:`SERVICE=api` 启动前执行 `migrate`,用 `pg_advisory_lock` 防止多实例并发迁移;其他服务启动时只检查迁移已完成(没完成就报错退出，由平台重启重试)。
7. **数据库连接**:连接池上限 `PG_POOL_MAX`(默认 5;Supabase 免费版连接数有限，四个服务共享);连接串带 `sslmode=require` 时正常工作;文档说明 Supabase 用会话模式连接池(transaction 模式与会话级的 advisory lock 不兼容)。
8. **平台说明**:`docs/deploy.md` 增加通用部署步骤(任意容器平台：一个镜像、四个服务、各自的 `SERVICE`、环境变量表、健康检查路径、需要公网的只有 api 与 faucet),再给 Railway 的具体步骤作为示例。不提交各平台专有的配置文件。
9. **测试**:端口/主机解析;`SERVICE` 取值校验;`/healthz` 在数据库不可用时 503;worker 健康状态超时变 503;私钥两种格式解析、两种来源同时设置报错、报错不含私钥;迁移锁。
10. **验收(Claude 做)**:`docker build` 后用 `SERVICE=api/faucet/keeper/ingest` 分别起容器，连本机 Postgres,`/healthz` 200;`docker stop` 能在 10 秒内平滑退出。

### T7 历史曲线 — done(第 2 步存量清理已于 2026-10-23 经作者同意执行)

**现状(Claude 2026-10-22 实测，本机库)。**
- `account_states` 27.8 万行、527 MB,只有 37 个地址。Bank 类型 71,975 行里 **数据真正变化的只有 36 次**;Bank/Group/MarginfiAccount 各有 8,516 个快照 slot(跨约 360 万 slot,约 16 天)。
- 来源:`ingest --follow` 每轮调用 `syncStored`,把全部 37 个账户整批再写一遍(`src/store/accounts.ts` 只靠主键去重，同一 slot 不重写，不同 slot 即使内容相同也写)。
- `account_states` 不参与 `verify-db` 的 md5(脚本注释写明，它随链上当前状态变化),所以去重不影响"清库重跑 md5 一致"的验收。但 `reindex`(`src/store/decode.ts`)会逐行重写全部快照，现在要处理 27.8 万行。

**能不能画历史曲线：能，而且数据是够的。** marginfi 的银行状态只在有交易时改变(计息也发生在交易里),所以"内容变化的快照"就是完整的历史——36 个变化点就是这个池子 16 天里银行状态的全部变化。每个变化点可以算出当时的总存款、总借款、利用率、存借 APR;时间取"该快照 slot 之前最近一笔 `raw_tx` 的 `block_time`"(银行状态只可能被那笔交易改变)。曲线应画成阶梯线(状态在两次交易之间不变),不要画成平滑插值，否则会暗示中间有变化。Pyth 价格账户的变化点(3,867 个 slot)可以顺带画价格曲线。

**建议的三步(按顺序):**
1. **写入去重(代码)**:写快照前比较该地址最新一行的 `data`,相同就不写;"最近一次采样的 slot"另存(例如 `ingest_cursor` 里一行),`/api/pool` 的 `as_of_slot` 从那里读，语义不变。
2. **清理存量(一次性脚本，会删数据，执行前需用户确认)**:每个地址只保留"内容与上一行不同"的行，外加最新一行。预计 27.8 万行 → 约 2,200 行;删除前先 `pg_dump account_states` 备份。
3. **历史接口与图表**:`GET /api/bank-history?bank=…` 返回变化点(时间、利用率、存借 APR、总量);资产页加一张阶梯线图(手写 SVG,参照 `RateCurve.tsx`),可切换"利用率 / APR / 总量"。

第 1、3 步可以交给 Codex;第 2 步动用户的数据库，等用户点头。

**给 Codex 的实现要求(第 1、3 步):**
- 第 1 步：在 `src/store/accounts.ts` 写入前，按地址取最新一行 `data`(走主键索引),相同就跳过;另存"最近一次采样的 slot"(放进 `ingest_cursor` 或新的一行配置，需要迁移就加 `src/store/migrations/005_*.sql`,幂等)。`/api/pool` 的 `as_of_slot` 改读它，语义不变。测试：连续两次相同快照只写一行、`as_of_slot` 前进;内容变化时写新行。注意 `src/store/decode.ts` 的 reindex 仍要能处理现有的重复行。
- 第 3 步:`GET /api/bank-history?bank=…` 返回该银行的变化点(现有库里有大量重复行，用窗口函数 `lag(data)` 只取变化点，单个地址走主键索引);每个点给出 slot、时间(该 slot 之前最近一笔 `raw_tx` 的 `block_time`)、总存款/总借款(原生单位与 USD)、利用率、存借 APR(用与 `/api/pool` 相同的计算函数，不要另写一套)。PGlite 测试用剧本 fixture。前端在资产页"资产状况"下方加一张阶梯线图(手写 SVG,参照 `RateCurve.tsx`),可切换"利用率 / APR / 总量";只有 1 个点时显示文字说明而不是空图。同步 `web/src/mock.ts`。

### T1 审查(2026-10-22)— 通过

- 复跑:`pnpm typecheck` 通过;`(cd web && pnpm typecheck)` 通过;`pnpm test` 全量一次出现 `src/api/server.test.ts` 失败，单独重跑 3/3 通过——即 D-013/D-015 记录的 PGlite 偶发崩溃，与本任务无关。
- 浏览器(`?mock`,Chrome DevTools):点 tUSDC 行 → `#market/tUSDC`;后退 → `#pool` 列表;直接打开 `#market/tSOL` 正常;`#market/XYZ` 显示"找不到这个资产"与返回链接，"市场"tab 保持选中;1280 浅色与 390 深色均无横向溢出(`scrollWidth = innerWidth`)。
- Codex 顺手补了 `Xray.tsx` 缺失的 `explorer` 导入——这是用户此前未提交改动里的真实编译错误，修得对。
- 遗留(并入 T3 处理，不单独返工):
  1. 价格出现两次(头部右上角与 KPI"预言机价格"),"总存款"出现三次(KPI、存款信息卡、列表)。把存款信息/借款信息/抵押参数合并为一张"资产状况"卡(参照 Aave 的 Reserve status & configuration),KPI 去掉与头部重复的价格。
  2. 利率曲线只在标题写了最优利用率，图上没有标线;T1 要求标出。
  3. `web/src/BankDetail.tsx` 已无引用，删除;`styles.css` 的 `.two`、`.curve`、`tr.sel` 随之清理(先确认无引用)。


### T0 审查(2026-10-22)— 通过

- Codex 的实现与 Claude 事先验证的查询一致;离线测试 182 项通过，新增"同一地址多个 slot 只取最新、多个地址各取一行"的 PGlite 用例。Claude 补了 `ORDER BY s.address`:旧查询的结果按地址排序，递归写法实际也是这个顺序，但 SQL 不保证，37 行的排序代价可以忽略。
- 真实环境发现的情况比"单次 1.2 秒"更糟：运行了 4 天的 API 进程(旧代码)有 25 个客户端连接在轮询，数据库里同时堆着 18 条旧查询，最长的跑了近 2 分钟。原因是单条查询 1.2 秒、前端每 5 秒轮询一次，查询一旦慢过轮询间隔，请求就层层堆积;排序超出内存后改用磁盘(`BufFileRead/Write`),于是越来越慢。
- 用原来的环境变量(`POOL_GROUP`、`FAUCET_URL`)重启 API 后实测:`/api/pool` 1–8 ms、`/api/accounts` 1–16 ms(各 5 次),数据库里不再有堆积的查询;返回 3 个银行、12 个账户，数据正确。
- 结论：不需要缓存。遗留:99% 的快照与上一份内容相同，表仍在增长(527 MB),放进 T7 评估。

### T2 审查(2026-10-22)— 通过(Claude 修了两处)

- 对照上游源码 `program/.upstream/programs/marginfi/src/state/marginfi_account.rs`:mrgn-0.1.0 的 `borrow` 用 `BalanceDecreaseType::Any`("will withdraw any existing assets"),所以"借款先取同资产存款"成立，Codex 实现正确(Claude 一度以为会报 `OperationBorrowOnly`,那是更新版本的行为，已核实排除)。
- **Bug 1(已修)**:`deposit` 同样是 `Any` 模式，有同资产负债时先还债、余下才记存款;`risk.ts` 原来直接加存款，会让"存入正在欠的币"同时显示存款和负债。
- **Bug 2(已修)**:`blocked` 原来对所有动作检查开仓健康度。程序只在 `borrow.rs:170`、`withdraw.rs:124` 调 `check_account_init_health`;存款/还款不检查。原实现会拦住资不抵债账户的补救存款/还款。
- 新增两项测试(同资产负债被存款抵扣;资不抵债时存款/还款不被拦、取款被拦),确认在修复前会失败;`risk.test.ts` 9/9 通过，两处 typecheck 通过。
- 取舍记录:Codex 为让测试过 web typecheck,在 `web/tsconfig.json` 加了 `node` 类型。代价是浏览器代码里误用 `Buffer`/`process` 不再被类型检查拦下;收益是测试与源码同一套检查。暂且接受。

### T3 审查(2026-10-22)— 通过(Claude 修了三处)

- 浏览器(`?mock&testwallet=bob`,并在页面内拦截 `/api/accounts` 给测试钱包注入"存 100 tSOL"的账户)逐项手算核对：借 2000 tUSDC → 健康因子 4500/2100 = 2.14 ✓、清算价 2100/90 = $23.33 ✓、已用额度 2200/4000 = 55% ✓、最多可借 4000/1.1 = 3636.36 ✓;借 3700 → 按钮变为"超过可借额度"并禁用 ✓。390 宽无横向溢出，操作面板排在资产信息之上 ✓。T1 遗留三项已处理(合并"资产状况"卡、利率曲线标出最优利用率、删除 `BankDetail.tsx`)。
- **修复 1**:`position?.deposit !== '0'` 在没有该资产头寸时为 true,导致任何人借款都看到"你在 tUSDC 里有存款"。
- **修复 2**:"最多可借"只看健康度，没用池子剩余流动性封顶;池子快被借空时"最大"会填出程序必拒的数。现取二者较小值。
- **修复 3**:账户为空时健康因子"操作前"显示"∞ · 无负债",改为"—"(没有资产也没有负债，不是"无限健康")。
- 全量测试里 `src/faucet/swap.test.ts` 的 6 项失败来自并行进行中的 T8(pHYPE 报价超出兑换限额),不属于 T3,在 T8 审查时处理。

### T8 审查与上链(2026-10-22)— 通过，已在 devnet 上线

代码审查(Claude 修了三处):
- **崩溃**:`add-pyth-bank.ts` 给水龙头备货用 `BigInt(setupAmount)`,pBTC 的备货是 `'0.5'`,`BigInt('0.5')` 直接抛异常。改用 `src/faucet/config.ts` 的 `nativeAmount` 按小数位换算。离线测试没覆盖，因为测试不跑链上脚本。
- **发放量**:Codex 按 BTC≈$100k、ETH≈$3.3k、HYPE≈$50 估算，按 devnet Pyth 现价(BTC $84.3k、ETH $2.5k、HYPE $80.9)实际是 $422 / $375 / $809。改为 0.006 pBTC、0.2 pETH、6 pHYPE(各约 $500),备货 100 倍，测试同步。
- **进程不退出**:脚本做完所有事后，web3.js `Connection` 的 websocket 让进程一直挂着——这就是机器上那两个 4 天前的 `add-pyth-bank` / `verify-pyth-bank` 进程(早已执行完，只是没退出;已结束)。两个脚本改为完成后显式 `process.exit`。

链上(管理员钱包，约 0.5 SOL):
| 资产 | mint | bank |
|---|---|---|
| pBTC | `21cLYwWgvUyy8o274jYhMSKmtMQVGbkQoau6PaSCnHUK` | `96YbFnubhTuipauMm7K9yUuZbnVtiVaG2ywh8gNSqFgo` |
| pETH | `4fhoQPcwf7tLwbHT1kUqAzje4vhpVGcduxhoRwbBSZvs` | `8SrSgi5EXVme1ayntfXEfKKTnPzMRBroG6o26ue2KEw8` |
| pHYPE | `F3nzz3p8L6maUBs8kmS4xi7Jzbiu9DP1z8aFXye1JKGs` | `H3eVeTmiHAP3jhd46ubVxVf58nMhQK4dJ2ScFFTtDRaE` |

- 每个资产 4 笔交易(建 mint、加银行、绑定 Pyth、给水龙头备货)全部确认;pBTC 重跑时全部跳过(幂等)且正常退出。地址已写入 `program/devnet.json`(全新 clone 也能识别，见 D-022)。
- 回填入库后 `/api/pool` 返回 6 个银行，新币 `oracle_source = pyth`。兑换台重启(加载新代码)后 7 个资产都按 Pyth 报价。
- **端到端**(`scripts/e2e-pyth.ts <符号>`,已参数化，默认仍是 pSOL):三个新币各自走完"SOL 兑换 → 首次存入(自动建账户)→ 抵押借 2 tUSDC → 还清含利息 → 全部取出",全部确认;借款约 8.1 万 CU,与 pSOL 一致。
- `web/src/mock.ts` 加入 pSOL/pBTC/pETH/pHYPE(地址取自 devnet.json),`?mock` 可预览 6 个资产。
- 未做：三个新币的 Metaplex 链上元数据(钱包里显示名称/图标，见 D-021);真实钱包里的显示效果。

### T4 审查(2026-10-22)— 需小幅返工(T4b)

- 浏览器(`?mock&testwallet=bob`,注入"存 100 tSOL、借 2000 tUSDC"账户)手算核对:净资产 5000 − 2000 = $3,000 ✓;健康因子 4500/2100 = 2.14 ✓;已用额度 2200/4000 = 55% ✓;净 APY (0 − 2000×4%)/3000 = −2.67% ✓。有头寸后上手清单自动隐藏 ✓;没有头寸时五步清单根据余额正确打勾 ✓;`#market/tUSDC/borrow` 预选动作 ✓(含 `Tabs.test.ts`)。
- 问题见 T4b 四项。

### T4b 审查(2026-10-22)— 通过

- 浏览器复查四项：空账户健康因子显示"—";"钱包资产"卡片已移除，改为"钱包 SOL · 领取测试币 · 用 SOL 兑换"提示条;mock 钱包余额为一次水龙头发放量;`portfolio.ts` 改用 `risk.ts` 导出的 `riskMetrics`,不再重复实现。390 宽无横向溢出。测试 223 项通过。

### T5 审查(2026-10-22)— 功能通过，需返工(T5b)

- **Bug(已修)**:后端按 bank 过滤清算时用 `e.data->>'assetBank'`/`'liabilityBank'`,实际字段是 `asset_bank`/`liability_bank`,这一段条件从不生效。原测试仍通过，是因为清算交易里程序会对两个银行各计一次息，计息事件带 `bank` 字段，碰巧匹配。Claude 改正字段名，并新增测试：删掉清算交易里的计息事件后，仍须能按 bank 查到清算;确认该测试在旧字段名下失败、修复后通过(4/4)。
- 真实数据(重启 API 后不加 `?mock` 打开 `#market/tSOL`):tSOL 流水 15 条，含剧本中的清算 ✓。排版与清算明细问题见 T5b。

### T5b 审查(2026-10-22)— 通过

- 真实数据(`#market/tSOL`):流水一行一条，表格 660 px 在 692 px 的栏内，不再压到操作面板;清算表显示"bob · 没收 10 tSOL · 偿还 475 tUSDC · −750.00 → −701.25",与链上事件一致。`/api/liquidations` 带 PGlite 测试。
- 发现两处，并入 T6:区块失败不重试;"健康度"在清算表是 USD 差值、在其他页面是比值。

### T6 审查(2026-10-22)— 通过(Claude 补了一处)

- 浏览器:tab 变为"市场 / 我的仓位 / 兑换 / 链上数据",链上数据页含"链上活动"与"清算监控";活动行高 40 px(原约 90 px);钱包按钮中文且有图标;用测试钱包在 `?mock` 下走完一笔存款，右下角 toast 显示"交易已确认 · 在 Explorer 查看 · 交易拆解",可关闭。
- **补漏**:`#accounts` 正确进入"链上数据",但旧链接 `#activity`(D-018 录制清单里用过)会落到"市场"。在 `Tabs.tsx` 加别名 `activity → accounts`。
- 全量：根目录与 web typecheck 通过;`pnpm test` 227/227。

### T7 审查(2026-10-22)— 通过(Claude 修了三处)

- 写入去重:`saveSnapshotBatch` 比较该地址最新一行 `data`,相同跳过;采样游标 `ingest_cursor.account_snapshot` 前进，`/api/pool` 的 `as_of_slot` 改读它(核对过没有别处依赖"最新行的 slot")。
- **性能**:`/api/bank-history` 原实现对每个银行把 Group 与价格账户的全部历史(各约 8500 行 JSON)读进内存再二分，真实库上 0.7–1.9 秒。改为每个变化点按主键取当时最新一行(约 0.05 ms),并按"该银行最新快照的 slot"缓存——银行状态一变这个 slot 就前进，失效是精确的;缓存按数据库实例分开，避免同一进程里的多个测试库互相串。实测首次约 1 秒(找变化点的查询需读全部存量重复行，385 ms,清理存量后会消失)、之后 8 ms,结果与修改前一致(tUSDC 13 个变化点)。
- **图表纵轴**:利用率固定画到 100%,测试池利用率最高 1.4%,整条线贴在 0 上。改为按数据取整到 1/2/5×10ⁿ(利用率封顶 100%)。真实数据可见 10/12 借款后约 1.4% 又还清回 0、10/17 后停在 0.7%。
- 第一个变化点没有美元值，是因为价格账户的快照比银行快照开始得晚——如实显示为空，不是错误。
- EP6 文档片段 `ep6-owner-check` 随代码更新，并加"后续增补"说明为什么去重;`snapshot-docs --check` 34/34。全量 229/229。

### T9 审查与改名执行(2026-10-22)— 通过

- 派生种子两处保留原字符串并加注释;剩余"索引器"6 处:5 处描述技术机制(按规则保留)、1 处是 EP3 引用的种子代码;README 第 100 行把采集方称作"索引器",Claude 改为"我们"。片段检查 0 过期。
- GitHub 仓库 `LixvYang/solana-lending-indexer` → `solana-lending-market`,本地 remote 已更新。旧的 raw 地址目前仍可访问(200)。`assets/tokens/*.json` 与 `scripts/token-metadata.ts` 已改指新仓库;**链上元数据尚未更新**——需要先把这些 JSON 推送到新仓库 main,再运行 `token-metadata.ts`(3 笔 devnet 管理交易)。
- 本地目录改名：先停服务与容器 → `mv` → 在新目录 `docker compose up -d`(数据在 `./pgdata` 绑定挂载，随目录移动)。核对 raw_tx 109 / account_states 277,726 / events 174 / labels 18,与改名前完全一致。新容器名 `solana-lending-market-postgres-1`。API、兑换台、Vite 已在新目录重启。
- 重启兑换台时发现 HYPE 推送断更 36 分钟导致整张汇率表 503,修复见 D-026。

### T10 审查与上链(2026-10-22)— 通过

- 代码：价格账户创建写入的字段(判别符、authority + 队列、名称、最大陈旧度)与 `createOrUpdateFeed` 一致;keeper 刷新名单与 `mockFeedSigner` 均含 tHYPE;派生种子保留 `pHYPE`;价格按 18 位精确换算。235 项测试通过。
- 链上:3 笔管理交易确认;tHYPE 端到端通过;keeper 实测在刷新。详见 D-027。

### T11 审查(2026-10-22)— 通过(Claude 修了一处)

- **边界(已修)**:keeper 原来在"年龄 < 最大年龄 − 一个间隔"时跳过。tHYPE(900 秒)可能在 719 秒被跳过、下一轮 899 秒才刷新，稍有延迟就过期。改为留两个间隔的余量:tHYPE 年龄过 540 秒即刷新,tSOL/tUSDC(240 秒)每轮刷新。测试同步改写(0 / 539 / 540 秒三个点)。
- **实测(重启后)**:keeper 一轮一笔交易同时刷新 tUSDC、tSOL(tHYPE 未到 540 秒，跳过),并打印一行日志;`/swap/rates` 首次 1.32 秒、15 秒内再次 1.5 毫秒(命中缓存);`/api/wallet` 一次批量读取，余额正确。
- 预计每月:keeper 约 10 万(原约 104 万);兑换汇率与用户数无关，每个兑换台进程最多约 240 次/小时(仅在有人打开兑换页时);每个已连钱包的在线用户约 240 次/小时(原 1,200)。实际用量以 Helius 控制台为准。

### T7 第 2 步：清理存量重复快照(2026-10-23,作者同意后执行)

- 备份:清理前做过 `pg_dump`(145 MB,仓库外);核对无误后，作者确认不需要，已删除。
- 规则：每个地址只保留"内容与上一行不同"的行，外加最新一行。试算 277,740 行 → 保留 2,227、删除 275,513,47 个地址全部保留;实际 `DELETE 275513`。`VACUUM FULL` 后表 527 MB → 2.6 MB,整库 11 MB(`pg_wal` 暂时仍占约 500 MB,随检查点回收，不影响 `pg_dump` 迁移)。
- 前后核对：每个地址最新一行的 md5、tUSDC 历史曲线响应的 md5、`/api/pool` 的 `as_of_slot` 与各银行总量，三项完全一致。`/api/bank-history` 无缓存首次查询约 1 秒 → 20 毫秒。

### T12 / T13 审查(2026-10-23)— 通过(Claude 修了三处)

- **T12 实测**:本地常驻 `ingest --follow`。首轮补入此前漏掉的 5 笔 tHYPE 交易(124 → 129);空闲轮次只查一次签名，不快照、不清扫，约 15 秒一轮;随后跑一次 tHYPE 端到端，最后一笔 03:46:52 确认,03:46:58 已入库(4 笔,129 → 133),有新交易的轮次会快照与清扫。
- **修复 1(Vercel 构建必失败)**:根目录 `vercel.json` 的安装命令只装根目录依赖，但项目不是 pnpm workspace,`web/` 有独立依赖;另有一份路径写错的 `web/vercel.json`。改为只执行 `pnpm --dir web install`,删除 `web/vercel.json`。
- **修复 2(全新环境构建失败)**:`web/tsconfig.json` 声明了 `node` 类型(T2 为测试文件加的),但 `@types/node` 不在 web 依赖里——本地靠上层目录的 `node_modules` 才通过。web 加入 `@types/node@22.10.2`(与根目录一致，固定版本)。
- **修复 3**:Dockerfile 基础镜像用浮动标签 `node:24-slim`,与"依赖版本全部固定"的约定不符，改为 `node:24.10.0-slim`。
- **全新环境模拟**:只拷贝受版本控制的文件、只装 web 依赖，按 `vercel.json` 构建成功;`VITE_API_BASE` 写入产物;生产包里没有 mock 与测试钱包代码。
- **镜像实测**:`docker build` 成功(524 MB);容器内 API 连本机 Postgres,`/api/pool` 200,`Access-Control-Allow-Origin` 正确回显 `ALLOWED_ORIGINS` 中的域名。
- 全量测试 243/243。未实测：真实 Vercel 发布、Supabase、域名与 TLS。

### T14 / T14b 审查(2026-10-23)— 通过(Claude 修了四处)

- 机械检查(grep):无中点、无左侧色条、除 `radix-colors.css` 与代币图标品牌色外无硬编码颜色、边框全部 0.5px、样式字号只有 12/14/24、阴影只在抽屉/下拉/toast、无动画。
- 浏览器(浅色、深色、390 宽)审查 T14 后列出 20 项(见 T14b),Codex 返工;复查通过。浏览器里才发现的:`<small>` 去掉显式字号后被算成 11.67px(低于 12px 下限);信息重复(资产页 APR/可借、"6 个资产"、"我的仓位"标题);参数显示为 1、1.1 和"开仓/维持";空数据时满屏"—"与 0。
- Claude 修复:①仓位为空时隐藏"我的存款/借款"两张只写"还没有…"的卡片(与引导条重复);②提示条里"领取测试币"按钮外多一层底色(框中框);③主按钮用名词("存款 5 tUSDC"),改为动词"存入/借出/还款/取出";④toast 与抽屉仍叫"交易拆解",统一为"交易详情"。
- **同步状态**:mock 下模拟"后端立即入库"时,"同步中"约 1.5 秒即消失(即第一层已生效);在页面里拦截流水接口、隐藏该笔交易后，资产面板显示"同步中",放开后自动消失。测试时注意 mock 每次返回同一签名，需刷新页面清缓存。

### T15 审查(2026-10-23)— 通过(Claude 修了一个致命问题)

- **致命(已修)**:`scripts/start.ts` 在启动时就设了 `setTimeout(() => process.exit(1), 10_000)`,没有清除——每个服务都在启动 10 秒后以退出码 1 自杀，在云平台会无限重启。251 项单测都没覆盖到，容器实测第 8 秒健康、第 13 秒退出。改为收到 SIGTERM/SIGINT 后才开始 10 秒兜底倒计时。
- 启动失败原来只打印"请检查配置",吞掉原因;改为打印真实错误，并对连接串密码与 RPC `api-key` 打码(实测：带密码的错误连接串，日志显示 `ECONNREFUSED`,不含密码)。
- **容器实测**(Codex 沙箱连不上 Docker,由 Claude 做):同一镜像按 `SERVICE=api/faucet/keeper/ingest` 起四个容器、平台式注入 `PORT=8080`,25 秒后全部运行、`/healthz` 200;keeper 用环境变量注入的 `KEEPER_SECRET_KEY` 成功发出刷新交易，日志不含私钥;`docker stop` 四个服务均 0.2 秒内退出、退出码 0。
- 新建专用 keeper 钱包 `CpJMdAiA55RgtkTNm4jLqQVgP4wGHiTMgcSjGD1ETYY1`(私钥在 `~/.config/solana/lending-market-keeper.json`,不入库),管理员转入 0.1 SOL;本机 keeper 已改用它，不再用管理员钱包。
- 全量 251/251,文档片段 34/34。

### 缺陷：兑换"已确认"但余额不变(2026-10-23,作者报告)

两个独立原因，按调试流程先取证再修:
1. **作者用的是 `?mock` 页面**(Claude 做浏览器审查时留下的标签页，地址带 `?mock&testwallet=bob`):兑换走前端假数据，返回固定的 mock 签名，链上没有任何交易——作者在 Explorer 看到的正是这个 mock 签名。根因：mock 模式在界面上与真实环境无法区分。修复：mock 时页头显示琥珀色"模拟数据"标签(生产构建里不存在)。
2. **真实环境兑换页根本拿不到汇率**(Claude 复现时发现):兑换台跨域只回显 `http://localhost:5173`,而本机 5173 被另一个旧 Vite 占用、开发服务器在 5174,浏览器拦下 `/swap/rates`,页面一直"读取汇率中…";"领取测试币"同理。这个问题 T13 之前就存在，一直没暴露，因为兑换只用 mock 或直接调接口的脚本测过。修复:`allowOrigin` 放行 `localhost`/`127.0.0.1` 任意端口，部署域名仍靠 `ALLOWED_ORIGINS`;新增测试(修复前失败)。
- 验证：脚本走兑换台接口 0.1 SOL → 0.1 pSOL 并存入成功;浏览器(非 mock)用测试钱包兑换 0.01 SOL → 0.01 pSOL,签名 `5UKbxZr9…` 链上 Finalized,SOL 0.05 → 0.0385(含手续费与 ATA 租金)。

### 缺陷：兑换成功后点"交易详情"显示 not found(2026-10-23,作者报告)

- 取证:作者给的签名 `4CmAJua8…` 链上成功(`err: null`),只含 ComputeBudget、System 转账、ATA 创建、SPL Token 转账，**没有 marginfi 指令**;`raw_tx` 无此签名,`/api/tx` 404。索引器只收录 marginfi 交易，这是设计如此。
- 根因：兑换与借贷共用同一个 toast,一律给出"交易详情"入口，而兑换交易永远不在借贷市场的记录里;抽屉还把后端原文 "not found" 直接显示。
- 修复：兑换结果的 toast 只给"在 Explorer 查看";借贷交易保留"交易详情"。抽屉遇到 404 显示"借贷市场里没有这笔交易的记录"。已核对兑换不会触发"同步中"(兑换页不走 `reportResult`)。
- 验证(隔离浏览器上下文，用完即关):测试钱包真实兑换 0.005 SOL,toast 为"交易已确认 | 在 Explorer 查看",无"同步中"。
- 另：结束了 10/14 启动、工作目录已随改名移走的旧 Vite(pid 41327/41368,端口 5173)。

### T16 钱包历史记录 — done(分支 `feat/wallet-history`)

作者要求：可以看到"我的钱包"过去的行为。

**数据来源(不额外消耗 RPC):**
- 借贷行为(存款、借款、还款、取款、清算——包括作为被清算方)来自现有 `instructions`/`events`:筛选 authority 为该钱包的 marginfi 账户相关的指令;清算按 `liquidatee_marginfi_account` 也要能查到(被清算的人要看到自己被清算)。
- 兑换与领取测试币**不经过 marginfi,索引器不收录**。由兑换台在处理成功时记录：新表 `desk_events`(迁移 `src/store/migrations/005_*.sql` 或下一个序号，幂等):`signature` 主键、`wallet`、`kind`(`swap` / `faucet`)、卖出/买入的资产与原生数量、`created_at`、`status`。兑换台 `/swap/send` 确认后写入一行;水龙头发放成功后写入一行。写入失败不影响用户的交易结果(交易已上链),只记日志。
- **不要**用 `getSignaturesForAddress(钱包)`:每次查看都耗 Helius 额度，且会混入与本市场无关的交易。

**接口:** `GET /api/wallet/:address/history?before=<游标>&limit=20`,把两类按时间倒序合并、统一形状:时间、类型(deposit/borrow/repay/withdraw/liquidated/liquidator/swap/faucet)、资产与数量(兑换给出卖出→买入两侧)、结果、签名、是否可打开"交易详情"(仅借贷类)。游标分页，与 `/api/activity` 一致。

**界面:** "我的仓位"页底部"历史记录"列表(钱包已连接且有记录时显示;无记录时一行"还没有记录")。每行：时间(12px,slate-11)、操作名(存入/借出/还款/取出/被清算/清算/兑换/领取)、资产图标 + 数量(兑换显示"0.1 SOL → 0.1 pSOL")、结果、链接(借贷类给"交易详情",兑换/领取只给 Explorer)。"加载更多"分页。遵守 T14 的设计规范(字号 12/14/24、0.5px 边框、Radix 颜色、不加说明文字、无中点)。刚发出的交易出现前沿用"同步中"机制，不另做。`web/src/mock.ts` 同步假数据。

**测试:** 迁移幂等;兑换/领取成功写一行、失败不写、写入失败不影响返回;历史接口合并排序与分页;被清算方能看到自己的清算;其他钱包的记录不会出现(按 authority 隔离)。

**验收(Claude):** 真实 devnet 上用测试钱包做一次兑换、领取、存款，历史里按时间出现三条，链接正确。

### T16 审查(2026-10-23)— 通过(Claude 修了四处)

- **清算数量带小数**:清算事件余额是 f64,差值如 `475000000.00000095`,前端按整数原生单位格式化会出错。取整;新增测试(修复前失败)。
- **混入其他池子**:剧本账户由固定种子派生，每次重跑剧本都在新池子留下记录，历史接口没按 `POOL_GROUP` 过滤(`/api/activity` 有),bob 的历史里出现未登记的银行地址。加上与 activity 相同的 group 条件;新增测试(修复前失败);真实数据核对 bob 历史=剧本四步(存 100 tSOL、借 5000 tUSDC、被清算没收 10 tSOL 代还 475 tUSDC、还款),按每页 2 条翻页拼接与一次取全一致。
- **兑换数量放大 10⁹ 倍**:查询 `desk_events` 的 SQL 漏选 `from_decimals`/`to_decimals`,小数位回落为 0,0.005 SOL 显示成 5,000,000 SOL。补列;测试补小数位断言(修复前失败)。
- **pSOL 图标消失**:代币图标的渐变 id 按"符号 + 尺寸"命名，同页重复 6 次且第一个在隐藏的 tab 里,Chrome 让其余引用失效，只剩角标。改用 `useId()` 保证每个实例唯一;复查页面 50 个渐变 id 无重复。
- **真实 devnet 验收**(隔离浏览器上下文，用完即关):测试钱包依次兑换 0.005 SOL → pSOL、领取测试币、存入 50 tUSDC(首次建账户),历史按时间倒序出现三条，借贷类有"交易详情",兑换/领取为 Explorer。
- 验收途中遇到页面空白：开发服务器的依赖预构建缓存过期(`504 Outdated Optimize Dep`),与代码无关;已在 5173 以 `--force` 重启 Vite。

### T16 追加：兑换记录改为解析交易本身(2026-10-23,作者同意)

- 原实现把报价意图放在兑换台内存(`quoted` Map,上限 200 条),提交时按消息体查找。弱点：兑换台在报价与提交之间重启，或云上多实例(报价落 A、提交落 B)时，交易成功但历史漏记。
- 改为 `swapLegs`:从用户提交的交易字节里解码 System 转账与 SPL Token `Transfer`,SPL 的 mint 用"钱包 + mint"在本地算 ATA 比对;用户→兑换台为卖出，兑换台→用户为买入。**不调用 RPC**,删除内存状态。数量可信：消息体带兑换台签名。
- 测试：报价实例与提交实例分开(模拟重启/多实例),覆盖 SOL→代币、代币→代币、代币→SOL;修复前失败。
- 真实 devnet:报价 → 重启兑换台 → 测试钱包签名提交，交易确认，`desk_events` 记下 0.003 SOL → 0.31274 tUSDC(SOL ≈ $104.25)。

### 缺陷：额度已用完，界面仍显示"最多可借 2.1189",模拟才失败(2026-10-23,作者账户 J6ND…)

- 取证：该账户约 $3,100 Pyth 资产(pSOL/pETH/pBTC)、借 2271 tUSDC。API(与程序同算法)开仓健康度 $0.34;前端按中间价算出约 $2.3,于是"最多可借 2.1189",链上模拟失败。
- 根因：前端风险预览只用中间价，程序用价格区间(开仓 EMA、维持实时价;资产取下沿、债务取上沿;半宽 Pyth conf × 2.12,上限 5%,D-019)。T2 时已记为"Pyth 资产预览略偏乐观",小仓位时可忽略，大仓位时偏差超过剩余额度。
- 修复:`/api/pool` 每个银行加 `risk_price`(调用 API 已有的 `riskPrice`,开仓/维持各一组 low/high);`web/src/risk.ts` 资产按 low、债务按 high、各口径用各自区间，最多可借按开仓 high 折算。新增测试(修复前失败：中间价 800 vs 程序 784)。
- 核对：用真实 API 数据跑前端 `risk.ts`,开仓 $0.1885、维持 $424.6706,与 API 完全一致;最多可借 0.1713 tUSDC;借 2.1 在按钮处即被拦下("超过可借额度")。
- 作者疑问"额度没了为什么健康因子还有数":两者口径不同。健康因子(维持口径)1.18 表示离清算还远(维持健康度 $425);能否再借看开仓口径，已用完。另：再借 2.1 时健康因子 1.1797 → 1.1786,两位小数都是 1.18,看似没算;改为前后两位相同时显示三位小数。

### T17 健康度改为 0–100%;图表悬停显示时间与数值 — done(图表部分由 T18 用 Recharts 重做)

**1. 健康度(作者要求)**
- 公式改为 marginfi 官方前端的写法：**健康度 = (维持加权资产 − 维持加权债务) ÷ 维持加权资产**。只有存款时 100%;≤ 0% 可被清算。加权用 `risk_price` 的维持区间(资产 low、债务 high),与程序一致。替换原来的"健康因子 = 资产 ÷ 债务"(∞ / 小于 1 可清算)。
- 在 `web/src/risk.ts` 增加这个百分比(保留原有加权和字段);没有任何资产也没有债务时为 null(显示"—")。
- 显示：一位小数百分比，例如"15.2%"。颜色:≥ 30% 绿(green-11)、10–30% 琥珀(amber-11)、< 10% 红(red-11);≤ 0% 红色并显示"可清算"。前后两值一位小数相同但实际不同时显示两位小数(沿用 T 之前的思路)。
- 替换位置：资产页操作面板的风险预览("健康度 15.2% → 15.1%")、"我的仓位"指标卡、"链上数据 → 清算监控"列表(原显示 USD 差值，改为百分比，按账户余额 + `risk_price` 在前端计算;状态文字保持)。
- 清算记录表：事件只给 USD 差值，算不出百分比，保留 USD,列名"健康度差值(USD)"。
- 所有界面文字"健康因子"改为"健康度"。

**2. 图表悬停(作者要求)**
- 资产页"历史曲线":鼠标移动时显示竖线并吸附到最近的变化点，高亮该点;提示框显示具体时间(`YYYY/MM/DD HH:mm`)与数值(利用率/APR 为百分比，两位小数;总量为代币数量与美元值)。鼠标离开时隐藏。触屏点按同样生效。
- 横轴均匀标 4–5 个时间刻度(原来只有首尾)。
- 利率曲线：确认悬停显示利用率与对应存款/借款 APR;没有就补上，交互与历史曲线一致。
- 提示框是浮层，可以用阴影(T14 规则:浮层阴影 `0 8px 24px`);字号只用 12/14;颜色用 Radix 变量;无动画。

**测试**:`risk.ts` 健康度百分比(无债务 100%、刚好清算线 0%、负值、无资产无债务 null);用 T 前的真实数据形状核对：维持加权资产 2813.3、债务 2384.8 → 15.2%。图表悬停由 Claude 在浏览器验收。

### T18 图表改用 Recharts — done

作者建议用常见的现成图表组件，不再手写 SVG。手写版的悬停定位、提示框宽度、纵轴截断都得逐个补(T17 审查里修了三处),成熟库默认处理好。取舍：项目已从"教学索引器"转为可用产品(D-023、D-025),依赖换稳定的交互，值得。

**选型(Claude 已定):`recharts@3.10.1`**(2026-07-25 发布，精确版本，加入 `web/package.json`)。理由：一套库同时画两张图——历史曲线(横轴时间、阶梯线 `type="stepAfter"`)与利率曲线(横轴利用率、"最优/当前"参考线 `ReferenceLine`);内置 Tooltip/十字线/自适应宽度;React 组件写法与项目一致。未选 lightweight-charts(横轴只能是时间，画不了利率曲线，会变成两套方案)、ECharts(体积大、命令式)。

**配色(Claude 已用 dataviz 校验脚本验证，不要改):**
- 新增图表色 token:`--chart-borrow` = blue-9(浅/深色都用);`--chart-deposit` = 浅色 orange-10(`#ef5f00`)、深色 orange-8(`#a35829`)。浅色 orange-9 对卡片底色对比度 2.83 < 3(警告),深色 orange-9 亮度超出合格带(失败);以上替换后两种模式校验全部通过。
- 利用率等单系列用 `--chart-borrow`。网格线 slate-6、轴文字 slate-11 12px;参考线"最优"用 slate-8 虚线，"当前"用对应系列色的点。

**要做:**
1. 用 Recharts 重写 `web/src/market/BankHistory.tsx`(利用率 / APR / 总量三种模式不变)与 `web/src/RateCurve.tsx`,删除手写的坐标换算、悬停与提示框代码及其样式。
2. 规格:线宽 2px;悬停高亮点直径 ≥ 8px、带 2px 底色描边;只画水平网格线;**关闭动画**(`isAnimationActive={false}`,T14 规则 7);图内文字只用 12px;`ResponsiveContainer` 自适应，390px 窄屏不溢出。
3. 悬停提示：自定义 Tooltip 内容，沿用 T17 的信息(时间 `YYYY/MM/DD HH:mm`;利用率/APR 两位小数百分比;总量为代币数量 + 美元值),样式用现有 `.tip`(浮层阴影、Radix 颜色)。利率曲线提示：利用率 + 存款/借款 APR。
4. 横轴：历史曲线按真实时间比例(数值型时间轴),4–5 个刻度 `MM/DD HH:mm`;利率曲线 0–100%。纵轴：历史"总量"用紧凑金额($20K),百分比模式按数据取整上限(T 之前的 niceTop 思路)。
5. 两条以上系列显示图例(与现在一致);两张图都保留"查看数据表"的表格视图(可访问性与对比度兜底)。
6. 依赖固定版本，`pnpm install` 更新 `web/pnpm-lock.yaml`;CI 用 `--frozen-lockfile`,锁文件必须提交。
7. 验收：两处 typecheck、全量测试;在自述里给出构建产物 gzip 体积前后对比(Claude 测得改前约 220 kB)。浏览器视觉与悬停由 Claude 验收。

### T18 审查(2026-10-23)— 通过(Claude 补装依赖并修了四处)

- Codex 沙箱连不上 npm,没装上 Recharts、没更新锁文件、没能跑 web typecheck 与构建。Claude 安装并提交 `web/pnpm-lock.yaml`,typecheck 通过。
- **体积**:引入 Recharts 后主包 gzip 219 → 326 kB(+49%),而图表只在资产页出现。改为 `React.lazy` 懒加载两张图：主包 217 kB(比改前还小，手写图表代码也拆出去了),图表块约 111 kB 仅在打开资产页时下载。
- **懒加载失败会整页空白**:没有错误边界时，图表文件下载失败(网络抖动、或用户停留期间站点重新部署)会卸载整个 React 树。新增 `ChunkBoundary`,只把图表位置换成"图表加载失败 · 重新加载"。实测(开发服务器装依赖前的解析失败)确实触发了这个场景。
- **图表全空白(致命)**:Codex 加了 `.recharts-wrapper { max-width: 100% }`。Recharts 3 的 `ResponsiveContainer` 外面套着一层宽度为 0 的测量容器，`max-width` 按 0 计算，整张图宽度为 0、什么都不显示(开发与生产构建都是)。删除该规则并加注释。Claude 一度误判为"开发模式预构建问题",用生产构建对照后排除。
- **弱化坐标轴**:按 dataviz 规范，去掉纵轴轴线与刻度线，只留水平网格。
- **配色**:dataviz 校验脚本实测——浅色 orange-9 对比度 2.83(警告)、深色 orange-9 亮度出带(失败);改用浅色 orange-10、深色 orange-8,两种模式全部通过。
- **浏览器验收**:浅色 1280、深色 390。两张图渲染;历史曲线悬停显示时间与数值、提示框贴近悬停点且在视口内;利率曲线悬停显示利用率与存借 APR,"最优"参考线可见;390 宽无横向溢出。

### T19 界面中英双语(i18n)— done

作者要求界面支持中文和英文，英文术语参考主流借贷产品(Aave、Morpho、marginfi)。本任务覆盖本节与公共规则冲突处:"界面文字用中文"改为"界面文字全部经 i18n 字典"。

**方案(Claude 已定):**
1. **不加依赖**,自写类型安全字典(约 250 条，用 react-i18next 不划算)。`web/src/i18n/zh.ts` 为基准;`en.ts` 类型声明为 `typeof zh` 的同键结构，缺键或多键编译失败。带参数的条目写成函数(`borrowMax: (n: string) => \`最多可借 ${n}\``),不做字符串模板解析。
2. `web/src/i18n/index.tsx`:`LocaleProvider` + `useT()` 返回当前字典与 `locale`。初始语言：本地存储 `lang`(try/catch 包裹)→ 浏览器 `navigator.languages` 以 `zh` 开头则中文 → 否则英文。切换时写回本地存储并设置 `document.documentElement.lang`(`zh-CN` / `en`)。
3. 切换入口：页头右侧一个按钮，显示另一种语言("EN" / "中文"),点一下切换。不做下拉。
4. 格式化:`fmtTime` 按当前语言(`zh-CN` / `en-US`,24 小时制);图表刻度和提示框里的时间维持数字格式(`MM/DD HH:mm`、`YYYY/MM/DD HH:mm`),两种语言通用。金额、数量、百分比格式不变。
5. **API 文案与语言解耦**(改后端):
   - `ApiError` 增加稳定的机器码 `code`(如 `PRICE_UNAVAILABLE`、`DESK_INSUFFICIENT`、`FAUCET_EMPTY`、`TRANSFER_TIMEOUT`、`TRANSFER_FAILED`、`NO_PRICE_SOURCE`…),响应体为 `{ error, code, params? }`(`params` 如 `{ symbol }`);`error` 保留中文作为兜底。前端按 `code` 查字典，查不到显示 `error`。
   - 程序错误已有 `name`(`RiskEngineInitRejected` 等),前端按 `name` 翻译，`message` 作兜底。
   - `wallet-history` 的 `result: '成功'|'失败'` 改为语言无关的值(`'success' | 'failed' | 其他状态原值`),前端翻译;同步 `src/api/types.ts`、`web/src/mock.ts` 与测试。
   - 兑换报价的 `summary` 中文句子：前端改用已有字段自行拼出，不再显示 `summary`(字段可保留)。
6. 范围：仅 `web/src` 界面文字(含 `aria-label`、`title`、占位符、空状态、提示、图例、表头、toast)。页面 `<title>` 随语言切换("借贷市场" / "Lending Market")。教程与 `docs/` 不翻译。代码注释保持中文。
7. 中文文案逐字保持现状(不借机改词)。

**英文术语表(必须遵守):**

| 中文 | English | 中文 | English |
|---|---|---|---|
| 市场 | Markets | 我的仓位 | Dashboard |
| 兑换 | Swap | 链上数据 | Explorer |
| 存款(动作) | Supply | 已存款 / 我的存款 | Supplied / Your supplies |
| 借款(动作) | Borrow | 已借款 / 我的借款 | Borrowed / Your borrows |
| 还款 | Repay | 取款 | Withdraw |
| 债务 | Debt | 抵押 | Collateral |
| 健康度 | Health factor | 可清算 | Liquidatable |
| 总存款 / 总借款 | Total supplied / Total borrowed | 可用流动性 | Available liquidity |
| 存款 APR / 借款 APR | Supply APR / Borrow APR | 利用率 | Utilization |
| 最大 LTV / 抵押率 | Max LTV | 清算线 | Liquidation threshold |
| 借款权重 | Borrow weight | 净值 | Net worth |
| 最多可借 | Available to borrow | 借款额度已用 | Borrow power used |
| 利率模型 | Interest rate model | 最优 | Optimal |
| 历史曲线 | History | 查看数据表 | Show data table |
| 流水 | Activity | 清算记录 | Liquidations |
| 连接钱包 | Connect wallet | 领取测试代币 | Get test tokens |
| 交易详情 | Transaction details | 同步中 | Syncing |
| 预言机 | Oracle | 银行(marginfi bank) | Bank |

表里没有的词按 Aave 英文界面的写法;句子用简洁的产品语气(句首大写，按钮不加句号)。

**测试:**
- 字典键一致性:`en` 与 `zh` 键集合相同，所有值非空(函数条目用样例参数调用后非空)。
- **防遗漏扫描测试**:扫描 `web/src/**/*.{ts,tsx}`(排除 `i18n/`、`*.test.*`、`mock.ts`),去掉注释后不得含中日韩字符字面量。这是长期守卫，后续新增文案也会被它拦下。
- 后端：错误响应含 `code`;`wallet-history` 结果值改动的现有测试同步更新。

**验收**:两处 typecheck、全量测试。浏览器中英切换、390px 英文长词不溢出由 Claude 验收。

### T19 审查(2026-10-24)— 通过(Claude 修了三处)

- **服务端提示被吞**:Codex 把不含中文的 `ApiError` 文案一律替换成"请求暂时无法完成",前端再把 `API_ERROR` 映射成同一句。"deposit first to create account"、输入校验等有用提示因此丢失。改为原样返回 `message`;只有未知内部错误(`INTERNAL_ERROR`)用固定文案。
- **窄屏英文页头溢出**(390px 实测):"Connect wallet" 换成两行、文字溢出按钮;连上钱包后地址按钮压住产品名。窄屏页头改为只显示图标与 Devnet 标记，产品名保留给读屏;按钮与标题不换行。
- **英文数量标签换行**:"Borrow amount" 在操作面板里折行。英文改为 "Amount"(与 Aave 一致，所选标签页已说明动作)。
- **浏览器验收**:英文 390px 下市场、资产页、借款面板、我的仓位、兑换、链上数据均无中文残留、无横向溢出;切到中文后 `lang=zh-CN`、标题"借贷市场",刷新后保持;中文文案与改前一致。防遗漏扫描测试已在全量测试中。

### T20 水龙头按时段限量、可信代理 IP、钱包余额告警 — done

背景：准备公开部署并在 B 站教学。水龙头钱包(`2UpA…zQNr`)每次给新用户领取，要为最多 6 种代币各建一个代币账户，租金约 0.00204 SOL/个，**新用户每次约 0.0123 SOL**;3.47 SOL 只够约 280 人。作者要求按时段限量("比如 5 小时最多多少人"),让测试能持续更久;SOL 由作者从自己的 devnet 钱包补充。

**要做:**
1. **时段限量替换每日上限**(`src/faucet/limit.ts`、`service.ts`、`scripts/faucet.ts`):
   - 新环境变量 `FAUCET_WINDOW_HOURS`(默认 5)与 `FAUCET_WINDOW_MAX`(默认 30):任意连续 `FAUCET_WINDOW_HOURS` 小时内，全站成功预留不超过 `FAUCET_WINDOW_MAX` 次(滑动窗口，记录每次预留时间)。删除 `FAUCET_DAILY_MAX` / `dailyMax`(同步 `.env.example`、`docs/deploy.md`)。
   - 默认值理由(写进注释):30 次 × 0.0123 SOL ≈ 0.37 SOL / 5 小时，最坏约 1.8 SOL/天。
   - 窗口满时返回 429,错误码 `FAUCET_WINDOW_FULL`,`params: { next }`(最早一条记录滑出窗口的 ISO 时间);与单钱包/单 IP 的 `FAUCET_LIMIT` 区分。前端两种语言给出"本时段名额已领完，{本地时间} 后恢复" / "This period's quota is used up. Available again at {time}"。
   - 钱包 10 分钟、IP 每小时 5 次的现有规则保留。
   - 限流状态仍在内存(重启清零),在注释里如实写明。
2. **领取名额可见**:`GET /faucet/config`(若无则在现有水龙头配置响应里)增加 `quota: { max, remaining, window_hours, resets_at }`;前端"领取测试代币"处显示"本时段剩余 N 份"(中英)。同步 `src/api/types.ts` 与 `web/src/mock.ts`。
3. **可信代理 IP**(`src/faucet/server.ts`):新环境变量 `TRUST_PROXY_HOPS`(默认 0)。0 时只用 socket 地址(现状);N>0 时取 `X-Forwarded-For` 从右数第 N 个地址(平台代理追加的那一跳),格式不合法则退回 socket 地址。注释说明为什么不能直接信最左边的地址(客户端可伪造)。`docs/deploy.md` 的 Railway/容器平台步骤写明设为 1。
4. **余额告警**:
   - 水龙头：领取前查付款钱包 SOL 余额;低于 `FAUCET_MIN_SOL`(默认 0.2)时返回 503 `FAUCET_EMPTY`(兑换台还要付手续费，不能把 SOL 用光);低于 1 SOL 时每小时最多打印一次警告日志(含钱包公钥与余额，不含密钥)。
   - keeper:每轮写价后查自身余额，低于 0.02 SOL 时打印警告(同样限频)。余额查询要复用已有 RPC 调用或每轮最多 1 次，不能明显增加 RPC 用量(T11 的预算)。
   - `/healthz` 不因余额低而失败(避免平台反复重启),只记日志。
5. 中英字典同步新增文案;防遗漏扫描测试必须继续通过。

**测试**:滑动窗口(窗口内满额拒绝、最早一条滑出后放行、`next` 时间正确、与钱包/IP 限制叠加取最晚);`TRUST_PROXY_HOPS` 0/1/2、伪造的最左地址被忽略、非法地址退回 socket;余额低于阈值拒绝、告警限频;quota 计算。

**验收**:根目录 `pnpm typecheck && pnpm test`、`(cd web && pnpm typecheck)`。真实领取与界面由 Claude 验收。

### T20 审查(2026-10-24)— 通过(Claude 修了三处)

- **英文时间格式错**:恢复时间按 `<html lang>` 格式化，但切换语言的那次渲染里它还是旧值，英文界面显示中文日期。改为字典按自身语言格式化。
- **名额为 0 时不提示恢复时间**:原来只显示"剩余 0 份",要点了才知道几点恢复。改为直接显示"本时段名额已领完，… 后恢复"。英文单复数修正(1 claim / N claims)。
- **部署文档写反**:"用户付 ATA 创建租金"——领取时实际是水龙头钱包付。已改正并写明每人成本与默认限量下的日耗。
- **实测**(临时 `FAUCET_WINDOW_MAX=1`):第一次真实领取成功、名额 1→0;第二个钱包返回 `FAUCET_WINDOW_FULL` 与恢复时间;界面中英文均显示恢复时间。验收后恢复默认 5 小时 30 份。
- 已知限制(如实保留):限额在内存，重启清零、多副本不共享——水龙头必须单实例部署。

### T21 Vercel + Supabase 全免费部署 — done

作者决定：前端与后端都部署在 **Vercel(Hobby,免费)**,数据库用 **Supabase 免费版**,不用自有 VPS,不付费。Vercel 只能跑按请求执行的函数，Hobby 定时任务最多每天一次，所以两个常驻进程要改造。**现有容器部署(`SERVICE=api|faucet|keeper|ingest`、docker compose)必须保持可用**,本任务是新增一条部署路径。

**Claude 已确认的事实(不用再查):**
- 价格维护(keeper)在 Vercel 上**不部署**:借款/取款交易会在用户自己的交易里刷新 mock 价格(`src/api/builder/index.ts` 的 `ep8-price-refresh`);兑换台读 mock 价格只看数值不看年龄(`src/faucet/prices.ts` `usdMicroOf`);Pyth 价格由 Pyth 推送。
- `/api/send` 确认后已立即索引该笔交易(`src/api/send.ts` 的 `index`)。
- 依赖 `@vercel/functions@3.9.11` 已由 Claude 安装并提交(提供 `waitUntil`)。不要再加其他依赖。

**要做:**
1. **函数入口**:仓库根目录 `api/[...path].ts`(Vercel Node 运行时)一个函数承接全部后端:
   - `/api/desk/*` → 水龙头/兑换台(去掉 `/api/desk` 前缀后交给现有 `faucetRoute` 逻辑);其余 `/api/*` → 现有 API `route`。前后端同源，前端 `VITE_API_BASE` 留空，`FAUCET_URL=/api/desk/faucet`(确认前端 `chain.faucet`/`deskBase`/`apiUrl` 对相对路径工作正常，必要时修)。
   - 复用 `handle`/`handleFaucet` 的请求解析、错误映射与安全约束(64KB 限制、不回显异常);Vercel 的 req/res 兼容 Node `IncomingMessage`/`ServerResponse`。
   - 模块级缓存 `pgDb()` 与 RPC 连接(同一实例的多次调用复用);`PG_POOL_MAX` 在 Vercel 上建议 1。
   - Vercel 上**不执行迁移**(会话级 advisory lock 不适用 Supabase 事务池);只检查迁移齐全，迁移由维护者在本地对 Session 连接串运行 `scripts/migrate.ts`。
   - 确认所有查询不依赖会话状态(命名 prepared statement、`SET`、会话级锁),因为生产连接走 Supabase **Transaction pooler**。
2. **按需同步(替代 `ingest --follow`)**:新增迁移 006,建一张租约/状态表(或扩展 `ingest_cursor`),记录 `last_sync_at`、`last_snapshot_at`、`lease_until`。
   - 每个 API 请求在响应后用 `waitUntil` 触发 `maybeSync`:若距 `last_sync_at` ≥ 30 秒，以一条原子 `UPDATE … WHERE lease_until < now() RETURNING` 抢 60 秒租约，抢到才执行一次 `followOnce`(含 `syncStored` 与 `finalizeSweep`),`lastSnapshotAt` 从表里读写，结束释放租约并更新时间。抢不到直接返回。
   - 失败只记日志(不含 RPC URL),不影响请求。
   - 本地/容器模式不启用(只在 Vercel 入口调用)。
3. **每日定时**:`vercel.json` 增加 `crons`:每天一次调用 `/api/cron/sync`,校验 `Authorization: Bearer ${CRON_SECRET}`,执行一次 `maybeSync`(兼作 Supabase 7 天无活动暂停的保活)。
4. **水龙头限流改存数据库**(Vercel 多实例不共享内存):迁移 006 增加领取预留表(wallet、ip、at)。预留在一个事务里用 `pg_advisory_xact_lock(<常量>)` 串行化后计数并插入，规则与 T20 完全相同(钱包 10 分钟、IP 每小时 5 次、全站 `FAUCET_WINDOW_HOURS` 内 `FAUCET_WINDOW_MAX` 次;失败也占名额)。`quota()` 也从表计算。保留纯函数 `reserve` 作为规则的单一来源(数据库层只负责取数和写入),旧数据定期按窗口清理。容器模式也改用数据库实现(单一实现，不留两套)。
5. **CDN 缓存公共只读接口**:对与用户无关的 GET(`/api/pool`、`/api/accounts`、`/api/activity`、银行历史、利率曲线、`/api/config`、`/api/desk/swap/rates`、`/api/desk/faucet/config` 等)加 `Cache-Control: public, s-maxage=5, stale-while-revalidate=10`;`/api/wallet/*`、钱包历史、所有 POST、错误响应不缓存。目的是轮询不耗尽 Hobby 的函数调用额度。
6. **构建配置**:根 `vercel.json` 安装命令同时装根目录与 `web/` 依赖;函数 `maxDuration` 设 60(发送交易最多等 60 秒确认);`regions` 留注释说明应与 Supabase 区域就近(不写死)。确认 `api/` 目录与 IDL JSON 等相对导入能被 Vercel 打包(写明假设，Claude 会用 `vercel build` 验证)。
7. **文档**:`docs/deploy.md` 新增"Vercel + Supabase(全免费)"一节：环境变量表(`DATABASE_URL` 用 Transaction pooler、`RPC_URL`、`POOL_GROUP`、`FAUCET_SECRET_KEY`、`FAUCET_URL=/api/desk/faucet`、`CRON_SECRET`、`TRUST_PROXY_HOPS`(Vercel 的取值写明依据或标"待验证")、`FAUCET_WINDOW_*`)、迁移与数据导入步骤(本地 `pg_dump` → Supabase Session 连接串 `pg_restore`)、没有 keeper 的影响、按需同步的行为(无人访问时数据不更新，有访问时最多旧约 30 秒)。`docs/decisions.md` 新增 D-028 记录取舍。

**测试**:租约(并发两次只一个执行、过期可重抢、未到 30 秒不执行)、`lastSnapshotAt` 读写;数据库限流与 T20 规则一致(用 PGlite)、并发预留不超额;路由分发(`/api/desk/*` 与 `/api/*`)、缓存头(公共 GET 有、钱包/POST/错误没有);cron 鉴权。

**验收**:与 CI 相同的检查全部通过。真实 Vercel 预览部署与 Supabase 联调由 Claude 完成。

### T21 审查与上线(2026-10-24)— 通过(Claude 修了六处，均为真实部署才暴露的问题)

- **多段路径 404**:非 Next.js 项目里 `api/[...path].ts` 只匹配一段(`^/api/([^/]+)$`),`/api/wallet/<key>`、`/api/desk/*`、`/api/cron/sync` 全部 404。改为 `api/main.ts` + `vercel.json` rewrite(`/api/:path*` → `/api/main?__path=…`),入口还原原始 URL。
- **兑换台 404**:`faucetRoute` 拿含查询串的 URL 精确比较，改写附带的参数让它全部落空。改为只比较路径。
- **CLI 部署会上传 `.env` 和 `pgdata/`**:Vercel 默认忽略列表不含它们(这次因文件数超 15000 被拒才发现)。新增白名单式 `.vercelignore`。
- **`ERR_REQUIRE_ESM`**:`rpc-websockets@9.3.9` 用 `require` 加载纯 ESM 的 `uuid@14`,Vercel 的模块加载器不支持。`pnpm.overrides` 固定 `rpc-websockets@9.3.8`(依赖 `uuid@11`,带 CommonJS)。
- **anchor 默认导入为 undefined**:Vercel 编译成 CommonJS 后 `import anchor from` 取不到；本地 tsx(原生 ESM)又认不出 `BN` 命名导出。`builder/instructions.ts` 改为 `default ?? 模块本身`。本地用 `tsc --module commonjs` 编译后 `require` 模拟验证。
- **函数区域**:Supabase 在孟买(ap-south-1),`regions: ["bom1"]`。
- **数据迁移**:本地 `pg_dump` → Supabase Session 连接串 `pg_restore`(单事务),8 张表行数逐一相等;再执行迁移 006。
- **预览实测**:全部公共接口、钱包余额、兑换台名额/汇率 200;`/api/pool` 第二次命中 CDN(`x-vercel-cache: HIT`);按需同步写入 `vercel_sync_state` 并新增快照。

### T22 存款绿、借款黄：统一配色与页面细节 — done

作者要求存款(lend/supply)APR 用绿色、借款(borrow)用黄色，并适当优化其他页面。参考：Aave 储备页实测 Supply APR 线为绿 `rgb(0,189,104)`、Borrow APR 为橙 `rgb(255,112,41)`、利用率为紫——"存款绿、借款暖色"是主流惯例。

**现状问题(Claude 浏览器实测)**:同一含义在不同页面颜色不一致——市场表存款 APR 为 green-12(几乎看不出绿)、借款 APR 无色;链上数据"借出/还款"标签为蓝;图表借款线为蓝、存款线为橙;我的仓位列表 APR 为灰字。

**配色(Claude 已用 dataviz 校验脚本与 WCAG 对比度验证，不要改数值):**

在 `styles.css` 的 `:root` 定义语义 token,并按现有方式为深色模式(`@media (prefers-color-scheme: dark)` 加 `:root:not([data-theme="light"])` 守卫、以及 `:root[data-theme="dark"]`)重定义:

| token | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `--supply` | `color-mix(in srgb, var(--green-11) 85%, var(--green-12))` | `var(--green-11)` | 存款相关数字/文字(对比度浅色 ≥4.8:1,深色 9.4:1) |
| `--borrow` | `color-mix(in srgb, var(--amber-11) 85%, var(--amber-12))` | `var(--amber-11)` | 借款相关数字/文字(浅色 ≥4.8:1,深色 11.5:1) |
| `--supply-bg` / `--borrow-bg` | `var(--green-3)` / `var(--amber-3)` | 同(Radix 深色 3 阶) | 标签底色 |
| `--supply-line` | `var(--green-9)` | `var(--green-9)` | 图表存款线 |
| `--borrow-line` | `var(--amber-11)` | `color-mix(in srgb, var(--amber-9) 50%, var(--amber-7))` | 图表借款线(浅/深色均通过亮度带、饱和度、色盲区分、≥3:1 对比全部检查) |
| `--chart-util` | `var(--blue-9)` | `var(--blue-9)` | 利用率等单系列线 |

删除 `--chart-borrow` / `--chart-deposit`,所有引用改用上表 token。

**要做:**
1. **APR 着色**:所有"存款 APR"数值用 `--supply`,所有"借款 APR"数值用 `--borrow`,包括：市场表两列(去掉现有 `.apr.good` 的 green-12 写法)、资产页顶部 KPI 的两格数值、操作面板里的 APR 行、我的仓位"可存资产/可借资产"列表的 APR 副标题、利率曲线与历史曲线的图例数值(若有)。0% 也着色(颜色表示身份，不表示好坏)。
2. **图表**:历史曲线 APR 模式与总量模式、利率曲线：存款系列 `--supply-line`、借款系列 `--borrow-line`;利用率用 `--chart-util`。提示框里的色块跟随线色，文字保持正文色(`--ink`),不用系列色。
3. **操作标签**:链上数据与钱包历史里，存入/取出用 `--supply` 文字 + `--supply-bg`;借出/还款用 `--borrow` + `--borrow-bg`;清算保持红色;开户、兑换、领取保持中性。
4. **我的仓位**:"我的存款/我的借款"每行副标题现在写"存款/借款",与卡片标题重复——改为该资产的 APR(如 `0.01% 存款 APR`,带颜色),与可存/可借列表一致。
5. **布局细节**:
   - 市场页与我的仓位顶部 4 张统计卡等宽(现在第一张明显更宽)。
   - 钱包历史记录：结果列与链接列用固定列宽对齐(现在"交易详情"与"Explorer ↗"宽度不同，导致"成功"左右错位)。
   - 链上数据表：代币列(图标 + 符号)与同行其他单元格垂直居中对齐(现在偏上)。
6. **健康度状态色保持不变**(好/警告/危险仍为绿/琥珀/红),但它们必须始终带文字(数值与"可清算"等),不靠颜色单独表达。
7. 中英文、深浅色、390px 都要正常;遵守 T14 设计规范(Radix 色、0.5px 边框、字号 ≤3 种、无左侧色条)。

**验收**:与 CI 相同的检查通过;浏览器视觉由 Claude 验收(浅/深色、中英文、1280 与 390 宽)。

### T22 审查(2026-10-26)— 通过(Claude 修了两处)

- **图例文字被染成系列色**:Recharts 默认把图例文字染成线色，违反"文字用正文色、颜色只放色块"。改用 `formatter` 输出正文色。
- **利率摘要丢空格、标点混用**:摘要是 `inline-flex` 容器的直接子项，flex 吞掉了元素间空格("借款4.8%");逗号写死英文。该项改为普通行内排版，分隔符按语言(`，` / `, `)。
- **浏览器验收**:浅色 1280(市场、资产页 APR 图与利率曲线、我的仓位、链上数据)与深色 390 英文(资产页)。存款数值/标签绿、借款黄，线色与 token 一致;四张统计卡等宽(260px);钱包历史结果列对齐;无横向溢出。

### T23 兑换页参考 Jupiter / Uniswap 精简 — done

作者要求参考 Jupiter、Uniswap 优化兑换页。Claude 实测两家(2026-10-27):主体只有"卖出/买入"两块与主按钮;估值紧贴金额下方;汇率、费用等细节**默认收成一行**(Jupiter:`Rate 1 SOL = 100.19 USDC ⇄ ⌄`),点开才展开;没有额外卡片标题。

**现状问题(本地截图):** 卡片标题"兑换"与页签重复;明细 5 行常驻展开;单价 6 位小数(`SOL $100.156955`);"首次收到某代币另付 0.00204 SOL 账户租金"每次都显示;单笔限额常驻;Pyth 标志孤立在面板右下角，不挨着估值;"买入(预估)"措辞重复(已有 ≈)。

**要做:**
1. **去掉卡片标题**"兑换"(页签已说明)。
2. **估值行**:`$5.01` / `≈ $5.01` 紧贴金额下方，Pyth 标志(`SourceChip`)放在估值右侧(与 T 市场表一致),不再单独占面板右下角;mock 资产不标。
3. **"买入(预估)"改为"买入"**,金额前的 ≈ 已表达预估(英文 `Buy`)。
4. **明细折叠**:报价出来后只显示一行 `1 SOL ≈ 1 pSOL ⇄`(可切换方向，保持现有行为)+ 右侧网络费 `≈ 0.000005 SOL` + 展开箭头;点开后显示：单价(按价格量级取 2–4 位有效小数，用现有 fmtUsd)、滑点(无，报价时锁定)、成交方式("兑换台按预言机价格成交")、兑换台可用数量(见第 6 条)、单笔限额。未输入金额时不显示明细行。展开状态用 `<details>` 或按钮 + `aria-expanded`,无动画或 250ms ease-out。
5. **按需提示**:
   - 账户租金只在用户**还没有**目标代币账户时显示(钱包代币列表里没有该 mint 即视为没有;SOL 不需要),放进折叠行的网络费旁("+ 0.00204 SOL 开户")。
   - 单笔限额只在金额越界时通过主按钮文案提示(现有 `minTrade`/`maxTrade`),展开明细里保留一行。
6. **兑换台库存**:`SwapRatesView.assets[]` 增加 `desk_available`(原生单位字符串;SOL 为扣除保留后的可用量)。在**同一次** `getMultipleAccountsInfo` 批量读取里一并读兑换台 ATA 与 SOL 余额(价格账户已在批量读取并缓存 15 秒),不新增 RPC 调用次数。前端在输入的买入数量超过库存时，主按钮提示"兑换台 X 不足"(复用 `apiDeskInsufficient` 文案),不必等报价接口报错。同步 `src/api/types.ts`、`web/src/mock.ts` 与测试。
7. **币种选择按钮**:把 `▾` 字符换成与钱包按钮一致描边风格的 SVG 下拉箭头(12px)。
8. 中英文、深浅色、390px;遵守 T14 规范(Radix 色、0.5px 边框、字号 ≤3 种)。

**测试**:`desk_available` 读取与批量调用次数不变(用现有假 RPC 计数);库存不足判断;明细折叠渲染(若现有测试结构允许)。

**验收**:与 CI 相同的检查;浏览器视觉与真实报价由 Claude 验收。

### T23 审查(2026-10-27)— 通过(Claude 修了两处)

- **库存未知被当作 0**:没配置兑换台账户时 `desk_available` 为 `'0'`,前端会把所有兑换判为库存不足。改为 `null`(未知),前端不拦截，交给报价接口按链上余额判断;补测试。
- **Pyth 标志仍在面板右下角**:移到估值文字后面(占位符是不换行空格 U+00A0,字符串替换匹配不到，按正则改)。
- **浏览器验收**:浅色 1280 中文(收起/展开明细、单价两位小数、兑换台库存格式化)、新钱包显示"+ 0.00204 SOL 开户"而已有账户的钱包不显示、深色 390 英文无溢出;本地真实兑换 0.05 SOL → pSOL 链上确认。
- 全量测试一次出现 1 个失败、重跑 278 项全过，属 D-013 的 PGlite 偶发崩溃。

### T24 我的仓位参考 Aave / Morpho 优化 — done

作者要求参考 Aave、Morpho 优化"我的仓位"。参考布局：Aave Dashboard 顶部净资产/净 APY/健康因子;左"我的存款 + 可存资产"、右"我的借款 + 可借资产";每张卡片标题行带汇总(余额、APY、已用借款额度);列表是带列标题的表格。Morpho 仓位用一根条同时画当前 LTV 与清算线，直观显示离清算多远。(Aave 仓位页需连钱包，本次未能实测，按其公开布局。)

**现状问题:** 引导卡在已存款后仍占顶部;存款/借款卡片标题无汇总;列表无列标题、APR 挤在副标题;钱包余额为 0 的资产与有余额的混排;健康度只有百分比;债务数量用红色(红色是"危险"状态色，不该用于普通债务)。

**要做:**
1. **引导卡**:只在首次存款前显示(连接钱包、领 SOL、领测试币、存入抵押 4 步);借款是可选，有存款后不再显示引导。未连接钱包时照旧显示。
2. **健康度卡加清算距离条(参考 Morpho)**:条的填充 = `1 − 健康度`(维持口径的债务/资产占比),右端 100% 即清算线(画一条竖线标记);填充色按现有健康状态(好/警告/危险),数值与"可清算"等文字照旧。无债务时条为空、显示 100%。"已用借款额度"卡保留现有条。
3. **卡片标题行汇总(参考 Aave)**,用空格分隔的"标签 值"对，不用"·":
   - 我的存款：余额 `$X`、APR(按美元加权，`--supply` 色)。
   - 我的借款：余额 `$X`、APR(加权，`--borrow` 色)、已用借款额度 `z%`。
   - 无仓位时不显示汇总。
4. **列表改为带列标题的表格**(桌面):
   - 我的存款：资产 | 存款(数量 + 美元) | 存款 APR | 操作
   - 我的借款：资产 | 债务(数量 + 美元) | 借款 APR | 操作
   - 可存资产：资产 | 钱包余额 | 存款 APR | 操作
   - 可借资产：资产 | 最多可借 | 借款 APR | 操作
   APR 独立成列并按 T22 着色;副标题不再放 APR。≤640px 退回现有两行卡片式排版(APR 回到副标题)。
5. **排序与弱化**:可存资产按钱包余额美元值降序;可借资产按最多可借美元值降序;数量为 0 的行整行降为次要色(`--ink-2`),按钮仍可点(进入资产页)。不加"显示 0 余额"开关(避免多一个决策点)。
6. **债务数量去掉红色与 "−" 号**,用正文色;危险只由健康度表达。
7. 中英文、深浅色、390px;T14 规范。

**测试**:加权 APR 与引导显示条件的纯函数测试(放 `portfolio.ts`);排序规则测试。

**验收**:与 CI 相同的检查;浏览器(有存款无借款、有借款、未连接三种状态)由 Claude 验收。

### T24 审查(2026-10-27)— 通过(Claude 修了两处)

- **首次派发卡死**:Codex 启动时请求超时，之后 49 分钟只在"等待网络重连",零改动。停止后台任务后重派正常。
- **操作按钮掉到第二行**:新表格规则 `.portfolio-table li`(4 列)与后面的通用 `.asset-list li`(3 列)优先级相同且写在前面，被覆盖。选择器改为 `.asset-list.portfolio-table li`。
- **表头与数据列错位约 35px**:表头和每行是各自的网格，`auto` 列宽算得不同。改为固定列宽，实测各列右边界逐一相等。
- **浏览器验收**:未连接(4 步引导)、模拟数据未存款(引导停在第 4 步、可借提示先存抵押)、有存款无借款(引导隐藏、标题汇总、按钱包美元值排序)、有借款(bob 在 devnet 借 0.1 pSOL:健康度 79%、清算距离条 21%、借款汇总 APR 8.57% 与已用额度 22%,验收后已全额还款);深色 390 英文退回两行卡片、无溢出。

### T26 修复 mock 价格可被任何人改写(安全)— todo

**漏洞**:tSOL/tUSDC/tHYPE 的 mock 价格账户由 mocks 程序的 `write(offset, data)` 写入，只要求目标账户签名;而价格账户密钥由公开字符串派生(`deriveKeypair('feed/<代币>')`),任何人都能算出并改价，进而用虚高抵押借空池子或把别人压到可清算。

**修复(mocks 程序由 Claude 改并部署;本任务只改 TypeScript)**:
- `write`:账户改为 `[target(可写、签名), authority(签名)]`,`authority` 必须是价格管理员(部署者钱包 `6LzQ…NL9`)。只有管理员能改价。
- 新增 `refresh_timestamp`:无参数，账户 `[feed(可写，不签名)]`。任何人可调用，只把 `last_update_timestamp`(偏移 2216)设为链上当前时间、三个 slot 字段(偏移 2264+6×16+8 起)设为当前 slot;价格不变。仅接受本程序拥有、PullFeed 判别符、`sample_size>0` 的账户。Anchor 判别符 = `sha256("global:refresh_timestamp")[0..8]`。

**要做(TypeScript,全部离线可测):**
1. `src/oracle/mock-write.ts`:
   - `writeIx(program, target, offset, data, authority)`:增加 `authority` 签名账户(第二个)。
   - `refreshTimestampIx(program, feed)`:改为调用 `refresh_timestamp`,feed 可写不签名;不再需要时间参数(链上取 Clock)。
   - 删除 `mockFeedSigner`;判断"是否我们的 mock、可代为刷新"改为：价格账户 owner 等于 mocks 程序且是 PullFeed 判别符。
2. `src/api/builder/index.ts`:借款/取款需要刷新时只加 `refreshTimestampIx`,**不再给交易加任何价格账户签名**(删除部分签名逻辑)。构建器测试同步。
3. `src/keeper/price.ts` 与 `scripts/price-keeper.ts`:keeper 只调 `refresh_timestamp`(一笔交易批量刷新到期的 feed),不再读价格、不再写价格、不需要 feed 签名;keeper 钱包只付手续费。`src/keeper/keeper.test.ts` 同步(保留"只刷新快到期的 feed"、批量一次、五次失败退出等行为断言)。
4. `scenario/lib/mock-feed.ts`、`scripts/fix-hype-oracle.ts`:所有 `writeIx` 传 `ctx.admin.publicKey` 作 `authority`(管理员已是交易签名者)。`scripts/verify-pyth-bank.ts` 改用新的 `refreshTimestampIx`。
5. 文档:`docs/decisions.md` 新增 D-029(漏洞、修法、三步不停机上线);`docs/addresses.md` 的 keeper 一行改为"只刷新时间、无改价权限";EP3/EP8 中描述"密钥公开派生、任何人可刷新"的段落改为新机制(snapshot-docs 片段随代码更新)。

**测试**:`writeIx` 账户顺序与签名标记;`refreshTimestampIx` 判别符、账户、无签名;构建器刷新交易不含价格账户签名;keeper 新行为。

**验收**:与 CI 相同的检查。程序构建、两次升级与线上联调由 Claude 完成。
