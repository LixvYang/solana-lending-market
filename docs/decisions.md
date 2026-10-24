# 决策与核实记录

每条记录:结论 + 依据 + 日期。"待验证"的事实核实后移到这里。

## D-001 许可证(已核实,2026-10-11)

上游 `marginfi-v2` 为 Apache-2.0(本机克隆 `../marginfi-v2/LICENSE`)。可以 fork 与再分发,需保留许可与版权声明。本项目自身用 **MIT**(用户决定,2026-10-17,`LICENSE`);入库的 marginfi IDL 按 Apache-2.0 使用,声明见 `THIRD_PARTY_NOTICES.md`,许可全文在 `third_party/marginfi-v2/LICENSE`。

## D-002 mrgn-0.1.0 的构建工具链(已验证,2026-10-11)

**结果**:用 solana 2.1.20 的 `cargo-build-sbf` + 上游要求的 rust 1.75 可以成功构建 marginfi 与 mocks,不需要 solana 1.18.17 / anchor 0.30.1 CLI。`program/build.sh` 已跑通。构建时 spl-token-2022 会报栈帧超限提示(confidential transfer),只影响该路径,不影响本项目用到的指令;未实测。

以下为核实前的分析:

上游 tag `mrgn-0.1.0` 存在。该 tag 要求:

| 项 | 要求 | 本机 |
|---|---|---|
| anchor | 0.30.1 | 默认 1.0.0;avm 可安装 0.30.1 |
| solana | 1.18.17 | 已装 2.1.20、3.1.x,无 1.18.17 |
| rust | 1.75.0(`rust-toolchain.toml`) | 有 1.78、1.79,无 1.75 |

本机 `../marginfi-v2` 的 HEAD(约 0.1.8)要求 anchor 0.31.1 + solana 2.1.20,这两个本机都有。

备选方案(M0 时按顺序尝试):
1. 为 mrgn-0.1.0 单独安装 1.75 / 1.18.17 / 0.30.1 后构建。
2. 若失败,改用更新的 tag(例如 0.1.x 中工具链本机可满足的),并在 EP3 如实说明。
3. 若仍失败,直接使用 HEAD,放弃"0.1.0 更简单"的卖点,但解码器与剧本不变。

## D-003 价格来源(设计决策,待验证可行性)

不使用 Switchboard devnet 手动设价:feed 需要 oracle 持续喂数据,手动设价不稳定。

mrgn-0.1.0 的 `OracleSetup` 只有 `None / PythLegacy / SwitchboardV2 / PythPushOracle / SwitchboardPull / StakedWithPythPush`,**没有固定价格模式**。因此只能让程序读到"自己构造的、格式符合要求的价格账户"。

**已核实源码(2026-10-11)**:
- `PythLegacy` 读取价格时要求账户 owner 等于 `PYTH_ID`(`state/price.rs` `load_pyth_price_feed`)。
- `PYTH_ID` 与价格新鲜度检查由 cargo feature 决定:`devnet` / `mainnet-beta` / `staging` 下是真实 Pyth 程序且**检查价格时间**;**不带这三个 feature 的构建(localnet 模式)**下 `PYTH_ID` 是上游自带的 `programs/mocks` 程序,且**忽略价格时间**(`live!()` 为假)。
- 上游自带 `programs/mocks`,可以写出 Pyth 布局的价格账户。

**方案**:不带 cluster feature 构建 marginfi(`--no-default-features`);同时部署 `mocks`;由于上游 mocks 与 marginfi 的原始 program id 我们没有私钥,构建时把 `declare_id!` 和 `PYTH_ID` 补丁成自己的 keypair。效果:价格永不过期,可随时用 mocks 改价,不依赖 Pyth / Switchboard。

**待验证**:补丁后的构建能否通过;mocks 的指令能否创建并更新价格账户。

## D-004 账户布局(部分核实)

`MarginfiGroup`、`Bank` 在 mrgn-0.1.0 中为 `zero_copy`(已看到源码属性),按固定偏移与对齐存储,余额用 `WrappedI80F48` 定点数。`MarginfiAccount` 预计同样,**待核实**。EP5 的账户解码需要手写偏移表。

## D-005 事件(已核实)

mrgn-0.1.0 的 `events.rs` 定义了 18 个事件,涵盖创建、配置、deposit / borrow / repay / withdraw / liquidate、利息累计、破产处理等。`lib.rs` 中共 36 个指令入口。具体事件的发出方式(日志 `Program data` 或 CPI)待在源码中确认。

## D-006 技术选型

TypeScript 全栈(剧本、indexer、前端),Postgres,依赖版本固定。M1 使用现有已安装并锁定的 `@solana/web3.js` 1.95.8 与 Anchor 0.31.1(2026-10-11)，没有修改依赖版本。

## D-007 devnet 价格改用 Switchboard(用户决策,2026-10-11)

用户要求部署到 devnet 时代币价格走 Switchboard。这与 D-003 的 mock 方案不同,两者并存:

- **本地/确定性重放(fixtures、对账)**:仍用 mocks,价格不过期,结果可复现。
- **devnet 演示**:需带 `devnet` feature 构建(此时检查价格时间,`SWITCHBOARD_PULL_ID` 为 devnet 地址,源码 `constants.rs` 另有 mainnet 地址),并让每笔涉及价格的交易前先更新 feed。

**待验证(风险)**:
1. 能否在 devnet 为自建代币创建 Switchboard On-Demand feed,并用固定值任务得到可控价格。我没有实测,不确定是否稳定。
2. `devnet` feature 同时会把 marginfi 的 program id 与 Pyth id 换成上游固定值,`build.sh` 的补丁需要覆盖这些分支。
3. 价格有最大有效期,录制时每次借贷前都要先更新,剧本要加这一步。

## D-008 M1 源码核实与离线构造(2026-10-11)

- `program/.upstream/programs/marginfi/src/state/marginfi_group.rs::get_oracle_max_age` 只有旧 SwitchboardV2 与 Pyth 分支在 0 时返回默认值；**SwitchboardPull 为 0 时返回 0**。剧本显式设为 240 秒，使用前独立 crank，实际有效期窗口待链上验证。
- `lending_pool_add_bank` 的 `BankConfigCompact` 不含 oracle；按 IDL / `tests/utils/group-instructions.ts` 先 add bank，再 `lending_pool_configure_bank_oracle(4, feed)`。全局 FeeState 是创建 group 的前置条件，来源 `tests/rootHooks.ts` / `instructions/marginfi_group/initialize.rs`，缺失时在步骤 3 初始化。
- 资产权重 tSOL 0.8 / 0.9，负债权重 tUSDC 1.1 / 1.05，使 100 tSOL 按 $100 抵押借 5000 tUSDC 的初始健康度约 +2500 美元，按 $50 的维持健康度约 -750 美元(未计利息)。利率参照 `tests/utils/types.ts`，开仓费设为 0。
- `state/marginfi_account.rs::check_post_liquidation_condition_and_get_account_health` 禁止一次清算清空负债或越过维持线。因此清算 10 tSOL，再由 Bob `repay_all` 收尾。账户 observation 顺序来自 `tests/utils/user-instructions.ts` / `instructions/marginfi_account/liquidate.rs`；真实 IDL 的离线构造与序列化长度已检查，**不代表链上交易已验证**。

## D-009 事件对账的限制(源码核实,2026-10-11)

`events.rs` 的普通借贷事件只报告本次数量；计息事件不含逐账户利息；`LiquidationBalances` 用 f64，且只报告清算人的资产 bank 存款 / 负债 bank 借款，没有其负债 bank 的存款。来源 `instructions/marginfi_account/liquidate.rs` 与 `constants.rs`：清算人支出使用 0.975 折扣，被清算人减债使用 0.95 折扣，差额进保险。因此 M1 expected 记录事件净流量并用 39/38 推算清算人支出，同时保存 Anchor 账户快照中的有理数原生余额。精确链上对账仍待验证，不把事件净流量标记为真实结束余额。

## D-008 Switchboard devnet 队列当前不可用(实测,2026-10-11)

**现象**:剧本第 2 步(创建 feed 后 crank)失败。逐层排查:
1. SDK 默认的 Crossbar 域名 `crossbar.switchboard.xyz` 已解析不到;换 `crossbar.switchboardlabs.xyz` 后 `/store`(v1)可用,feed 账户创建成功。
2. 该 Crossbar 的 `/gateways?network=devnet` 返回 `[]`,SDK 报 "No gateways available"。
3. 改为读链上队列登记的 gateway:9 个 oracle 的 gateway 地址在 TLS 握手阶段全部无响应(同一 IP 换成别的 SNI 则握手正常,所以不是本机网络问题)。
4. 查链上心跳:队列 `EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7` 的 `nodeTimeout` 为 300 秒,而 9 个 oracle 的最后心跳距今:5 个约 39 小时(140018–140363 秒),其余约 25、31、46、55 天。**最新的也已超过 1.6 天**。

**结论**:devnet 上没有存活的 Switchboard oracle,crank 目前做不到,不是代码问题。参考项目 `usdx-solana` 在 2026-09-14 实测时队列心跳还是"刚刚",说明这是之后才出现的变化。

**已知的副产物(已修,保留)**:`CROSSBAR_URL` 可配置;crank 改为读链上 gateway;创世哈希写错的 bug。

**未验证**:oracle 何时恢复;Switchboard 是否还有别的 devnet 队列可用。

### D-008 补充:进一步核实(2026-10-11)

- 链上共 191 个 devnet Switchboard oracle 账户,**全部**心跳不新鲜,最新的距今约 39 小时(5 个几乎同时停止,像是同一次故障)。
- `crossbar.switchboard.xyz`(官方文档仍写它是公共地址)经 Cloudflare DoH 确认**没有任何 DNS 记录**。`crossbar.switchboardlabs.xyz` 可用于 `/store`,但 `/gateways?network=devnet` 为空。
- 官方 agent skill 文档推荐的新路径是 `queue.fetchManagedUpdateIxs(crossbar, [feedId], …)`(oracle quote),同样依赖存活的 oracle,不能绕开。
- SDK 只登记一个 devnet 队列(`EYiAmGSd…`)。
- 官方文档建议生产环境自建 Crossbar;自建只能解决 Crossbar,解决不了 oracle 离线。
- 软件侧无法绕开:feed 账户归 Switchboard 程序所有,只有它能写入价格。

**可行的替代(未实施)**:marginfi 对价格账户只检查 owner 与布局。上游 `mocks` 程序有通用的 `write(offset, data)` 指令,可以让账户归 mocks 所有、内容是 Switchboard `PullFeedAccountData` 的 3208 字节布局,构建时把 `SWITCHBOARD_PULL_ID` 补丁成 mocks 的地址。这样 marginfi 走的仍是 SwitchboardPull 解析路径,只是"crank"换成我们自己写入。需要把 marginfi 以这个补丁重新升级部署(同一程序地址)。

## D-009 价格方案落地:Switchboard 布局的 mock 价格账户(2026-10-11,已在 devnet 验证)

采用 D-008 的替代方案。**实测结果**:marginfi(以 `PRICE_ORACLE=mock` 补丁、`devnet` feature 构建并升级到原地址)接受 mocks 程序拥有、按 `PullFeedAccountData` 布局写入的价格账户,SwitchboardPull 解析路径正常工作;12 步剧本在 devnet 一次跑通(32 笔交易全部 finalized,覆盖 deposit / borrow / repay / withdraw / liquidate / accrue)。

- 偏移表用链上真实账户 `fixtures/switchboard-pullfeed-uncranked.bin` 校验(authority、queue、name、min_responses、max_staleness 全部对上)。
- 价格由 mocks 的 `write(offset, data)` 写入，目标账户须签名；"crank" 即用链上时间重写时间戳与 slot。
- 改价(tSOL 100 → 50)直接重写价格区域，不需要重配 Bank。清算按预期触发。
- 切回真实 Switchboard:`PRICE_ORACLE=switchboard ./program/build.sh` 重新构建升级，剧本设 `PRICE_PROVIDER=switchboard`。**该路径只验证到 feed 创建，crank 从未成功**。
- `SWITCHBOARD_PULL_ID` 与程序地址都是补丁值；视频里必须说明这是"布局一致的 mock"，不能说成真实 Switchboard 价格。

已知小问题:`expected` 里清算相关的数量带有 f64 精度残留(例如 `5512499999.999999`)，M3 对账前需要改成整数/定点运算。

## D-010 M2 指令布局与离线交叉校验（2026-10-12）

- 固定 IDL 的全部 36 个 discriminator 与手算 `sha256("global:<snake_case 名称>")` 前 8 字节一致。依据：`src/decoder/discriminator.test.ts`。
- 指令可达类型实际为 bool、pubkey、u8/u16/u32/u64、option、array、defined struct/enum；`WrappedI80F48` 参数按 IDL 的 `{ value: u8[16] }` 保留字节，不套用账户 zero_copy 对齐或换算小数。依据：固定 IDL 与 `src/decoder/borsh.ts`，fixture 的 BankConfigCompact 与 Anchor coder 解码一致。
- 32 笔原始 RPC fixture 中共 18 条 marginfi 指令、11 类，名称与参数逐条与测试专用 `BorshCoder.instruction.decode` 一致。步骤金标准对照 `m1-run.json` 的独立事件记录；borrow 与 liquidate 的角色地址/remaining 顺序与 addresses 一致。依据：`src/decoder/transaction.test.ts`。
- 输出的指令名、参数/结构体/枚举字段保持原始 IDL 拼写，账户角色名也保持 IDL 原样的 snake_case(审查时统一:此前账户名被转成 camelCase 而参数名不是,风格不一致;snake_case 与 Rust、IDL、以后的数据库列名一致)。数值为 bigint；原始 bytes 与 WrappedI80F48 字节为 number[]。非法 base58 无法恢复字节，错误结果保留 RPC 原文并注明编码；不足 8 字节无法识别名称，按 unknown 错误保留原始字节。
- 非空 v0 loadedAddresses、嵌套账户分组、marginfi inner instruction 仅用合成数据验证。其余指令没有链上样本。审查时补了往返测试 `src/decoder/roundtrip.test.ts`:对全部 23 个带参数的指令各生成 20 组确定性伪随机参数,用 Anchor 编码后由我们解码并逐字段比对。这是合成数据,不是链上验证;并用突变(改坏 option 标签、enum 下标)确认测试能失败。指令参数里没有有符号整数,有符号读取只由 `reader.test.ts` 覆盖。事件/账户解码与对账仍属 M3。

## D-011 M3 事件、zero_copy 账户与精确对账（离线实测，2026-10-12）

**数量更正**：任务文件写事件 24 条，但本地 `m1-run.json.events.length` 实际为 **25**。32 笔原始 RPC fixture 解出 25 条，与运行时 Anchor EventParser 的签名、名称、顺序、所有字段逐条一致。没有删除事件或修改 fixture；按完整实测样本验收。借贷/清算指令内的计息事件与业务事件可以共享顶层 `ixIndex`。

**布局与精度**：四类账户的结构体大小（不含 discriminator）分别为 Bank 1856、MarginfiAccount 2304、MarginfiGroup 1056、FeeState 256；加 8 后与七份 fixture 的 1864 / 2312 / 1064 / 264 字节逐个相等。`MarginfiAccount` 和 `FeeState` 的 zero_copy / repr(C) 已从本地 Rust 源码属性与 fixture 核实，补全 D-004。由 IDL 计算成员对齐、数组 stride 与尾部 padding，`WrappedI80F48` 明确按 `repr.align=8`（大小 16）。无字段枚举按 u8 与样本中的 Operational / SwitchboardPull / Collateral 值及后续字段对齐吻合；其他枚举值尚无真实账户样本。

七份解码结果（包括保留的 padding）与测试专用 `BorshCoder.accounts.decode` 的 PascalCase 名称、snake_case 字段逐项一致。账户长度不完全相等时返回 `decodeError`。金额位数为小端有符号 i128，48 位小数；精确十进制全程 bigint。账户入口只收到字节，**无法核对 owner**，未来 ingest/RPC 调用者必须检查 owner。

**精确不变量**：两个 bank 各自的三用户 `asset_shares` / `liability_shares` 原始位数和，与 bank 总 shares 完全相等（四个差均为 0）。四个 active 账户/bank 组合的存款、借款分子，与 Anchor snapshots 中 `depositNumerator` / `borrowNumerator` 完全相等，未约分分母均为 `2^96 = 79228162514264337593543950336`。对账同时报告全部 3 × 2 个用户/池子组合，关闭的 Bob tUSDC 位置也保留在事件流量中。

**事件 vs 状态**：以下数量均为 mint 原生单位；tUSDC 除以 `10^6`、tSOL 除以 `10^9` 才是代币数。整数事件累计与清算调整分列，差定义为 `状态 −（整数净流量 + 清算调整）`。表中的非整数小数显示截断到 18 位；代码与测试保留精确有理数，不用显示值判相等。

| 账户 / bank / 侧 | u64 事件净流量 | 清算调整（binary64 原值/推算） | 结束状态 | 差值 |
|---|---:|---:|---:|---:|
| Alice / tUSDC / 存 | 9000000000 | 0 | 9000001546.589030383738260787 | +1546.589030383738260787 |
| Bob / tUSDC / 借 | 474997824 | -475000000.000000953674316406 | 0 | +2176.000000953674316406 |
| Carol / tUSDC / 存 | 6000000000 | -487500000.000000978771008943 | 5512500348.538910809777205272 | +348.538911788548214216 |
| Bob / tSOL / 存 | 100000000000 | -10000000000 | 90000000000 | 0 |
| Carol / tSOL / 存 | 0 | +10000000000 | 10000000000 | 0 |
| Alice / tSOL / 存 | 0 | 0 | 0 | 0 |

其余侧（Alice/Carol 的借、Bob tUSDC 的存、三人的 tSOL 借）状态与净流量均为 0。三个非零差的精确分数为：

- Alice：`122533407042021320331036085304105 / 79228162514264337593543950336`。
- Bob：`2281701377 / 1048576`。
- Carol：`262333926684415432443825514641763 / 752667543885511207138667528192`。

解释与分类：

- **利息（方向与量级验证，精确分摊仍是推断）**：tUSDC 的最终 asset share value 为 `1.000000155398776513493430684320628643035888671875`，liability share value 为 `1.00000044510971264344334485940635204315185546875`。在本剧本从零建仓、share value 从 1 单调增加、没有破产/开仓费/Token-2022 转账费的条件下，每笔入账的利息不超过 `入账量 × 最终 share value 增幅`。Alice、Carol 存款上界分别为 1553.987765134934306843、932.392659080960584105；Bob 借款上界为 2225.548563217216724297。三个差均为正且在上界内，符合计息；测试另对差值精确分子与 1546–1547、348–349、2176–2177 的量级断言。反方向大差或超上界正差会返回 `issues`，不能无限用“利息”解释。
- **f64 精度**：清算前后 Bob 借款的 binary64 之差恰为 `475000000 + 2^-20`，不是精确整数 475000000。两次 f64 舍入的半 ULP 误差界相加为 `2^-20` 原生单位。Carol 支出按名义折扣 `0.975/0.95 = 39/38` 推算，f64 传播界为 `39/(38×1048576)`，约 0.000000978771 原生单位。原始 f64 先按 IEEE754 位模式转有理数，再做减法，避免二次浮点舍入。分类表示此误差来源存在，**不声称已经知道每次舍入的实际误差**。
- **其他已知机制与尚未精确分解部分**：本地 `marginfi_account.rs::repay_all` 对结束借款 `ceil`，多付的小于 1 原生单位进入保险费；因此关闭账户不应抹掉累计负净流量。Bob 差包含计息、这次取整及清算 f64 误差，不能把整个 2176 都称为精确利息。清算事件没有 Carol 的负债 bank 存款，39/38 推算仍有上游 I80F48 常数、运算截断与份额转换的不确定性；这部分没有逐位重演。当前 fixture 的三个非零差没有超方向/量级界的异常，但没有中间账户快照，**未证明三类贡献的精确分摊**。`reconcile` 面向本剧本的完整、从零开始、无 fee 的记录，不作为其他剧本通用会计证明。

**不要修 expected**：D-009 的“对账前改 expected 的 f64 残留”描述不成立。残留来自链上 `LiquidationBalances` 发出的 f64，以及事件未报告的清算人存款；本次没有修改 `scenario/expected.ts`。保留净流量/状态的差，才能说明“池子指标以账户状态为准、事件用于活动流”。

**验证边界**：所有验证只读本地 fixture/IDL/源码；调用栈中的 marginfi CPI、夹杂外部 Program data、失败/未知/截断日志仅合成测试，没有新增真实 CPI/失败/截断样本。fixture 未出现的事件、账户版本/枚举值、withdraw_all/破产/非零开仓费/Token-2022 费用尚未验证；没有逐笔复现利息及清算定点运算，也没有重跑剧本或查询最新链上状态。测试专用 Anchor 的 bigint 原生绑定不可用，使用其现有纯 JS 回退。

**突变实测**（每次临时改坏源文件，针对性测试退出 1，然后还原）：Bank `asset_share_value` 读取偏移 +8（4 项失败）；I80F48 先经 Number 再回 bigint（4 项失败）；移除失败交易事件屏蔽（1 项失败）；清算比例 39/38 改为 1（2 项失败）。保留损坏输入测试覆盖 shares 位翻转、缺 bank、坏 bool/enum、无法解码事件以及差值方向/量级异常；这些属于输入回归测试，与上述临时实现突变区分。

### D-011 审查补充(2026-10-12):利息守恒核对

codex 把三个非零差归为"利息"时,依据是方向与上界(推断)。审查时补了一个独立核对,用的是三个互不依赖的量:

| 量 | 来源 | 数值(tUSDC 原生单位) |
|---|---|---|
| 存款人所得(Alice + Carol 的差值) | 账户状态 − 事件净流量 | 1546.589 + 348.539 = 1895.128 |
| 协议费 + 保险费 | 程序发出的 7 条 AccrueInterest 事件里 `fees_collected` / `insurance_collected`(f64)之和 | 200.615 + 79.506 = 280.121 |
| 借款人多付(Bob 的差值) | 账户状态 − 事件净流量 | 2176.000 |

存款人所得 + 费用 = 2175.249,与借款人多付 2176.000 只差 **0.751 个原生单位**(< 1,与 `repay_all` 向上取整小于 1 的解释一致)。固化为 `reconcile.test.ts` 里的守恒测试。这比"方向与上界"强得多,但仍只覆盖 tUSDC 这一个 bank、这一次剧本;`AccrueInterest` 事件的 `delta` 是经过的**秒数**(7 次合计 59 秒),不是利息,别混用。

审查时另做三种突变,测试均失败后还原:事件不看调用栈(任何 `Program data` 都当 marginfi)、`toDecimal` 丢符号、`Reader.i128` 当无符号读。

可读性提醒:`reconcile.ts` 与 `event-balances.ts` 的单行很长、逻辑密,适合做测试与结论,不适合直接上屏讲解;EP5 视频里应讲 `layout.ts` / `fixed.ts` / `event.ts` 的片段,对账只展示结论表。


## D-012 M4 存储与 finalized 采集（2026-10-12）

**实现取舍**：沿用固定依赖 pg 8.23.1 / PGlite 0.5.8，不新增依赖或 ORM。Db 只有 query / transaction，迁移按 SQL 文件事务应用并记录 schema_migrations。raw_tx 是交易事实；原始 JSON 与失败 err 都保存。instructions 的顶层 inner_index 用 -1，避免 NULL 唯一性/主键问题；events 用日志位置唯一，类型/slot/账户表达式索引对应 EP7 查询。

**精度实测**：本机 PGlite 对小 int8 可返回 number、大 int8 返回 bigint（并非任务描述的一律 bigint）。适配按字段 OID=20 统一十进制字符串，null 保留；pg 默认字符串与 bigint 替身都覆盖。JSONB 金额是字符串，fromJson 按固定 IDL 恢复 bigint，pubkey/string/f64/原始 I80F48 字节不猜测、不误转。全部 25 事件/7 账户的数值类型往返逐字段验证，数据库读回的账户和事件交给 M3 reconcile 后 issues=[]；这仍保留 D-011 的机制差，未修改 expected。

**原子性和重建**：tail 每 slot 的原始写入与游标一起提交；decodePending 在一个事务里删除旧派生行、写指令/事件并更新 DECODER_VERSION（当前1）。rebuildDecoded 清空交易派生表、重置版本并完整重放；account_states 同时保留 raw_data base64，重建只更新解码字段而不删除原始快照。保留原始字节的额外字段是保证账户可离线重建的必要选择，不把纯解码 JSON 当唯一账户事实。

**RPC 与游标**：所有六个 RPC 方法都 finalized，getBlock/getTransaction 显式 json 与 maxSupportedTransactionVersion=0。顶层/inner 调用合并检查 v0 loadedAddresses。-32007 skipped 可推进空 slot；-32009 缺历史、null block/null transaction 必须报错，不能吞缺口。网络错误/429/5xx/短期节点不可用有有限指数退避与超时；错误里 URL 的 api-key 原文/编码值脱敏。backfill 只跳过已有下载，不以已知签名作为分页终点；失败交易仍保存。

**账户采样与 CLI**：owner 在解码前检查，不匹配拒绝当前批次。slot 用 getMultipleAccounts.context.slot；最多100个一批，不保证跨批同时采样。CLI 自动解码后只从成功交易提取协议角色地址，防止失败初始化的未创建/外国账户永久污染快照集合。成功后已关闭的历史账户报告缺失并跳过；直接 snapshotAccounts 默认仍拒绝缺失。旧快照保留但不代表当前存在性，没有关闭墓碑或逐笔历史状态。首次 tail 默认采当前 finalized slot；--from 含起点，有已有 blocks 游标则优先恢复；--once 处理本轮固定最新高度后退出。

**离线证据**：32交易重复入库/解码幂等，18指令/25事件按独立 steps/events 对照；清库重跑和派生重建逐行相等；旧版本行重做、新版行不变；slot写入中途/游标更新失败/解码中途抛错均回滚、重跑无缺漏。七账户owner/context.slot/原始字节重建以及CLI共用同步编排经PGlite与假RPC实测。另临时把 DECODER_VERSION 改为2，用旧行版本1运行升级测试成功后还原1，排除只会处理版本0的测试假设。

**突变实测**：去掉 ON CONFLICT、移除 slot 事务、同时去掉 events 全量与逐签名清理、去掉 owner 检查，四次针对性测试均退出1后还原。单独删 rebuild 的 events 全量清理仍通过，因为 pending 按所有签名等效清理；该等效突变不计为捕获，改坏两处后测试捕获。

**最终检查**：pnpm typecheck 退出0；pnpm test 退出0，85项通过、0失败、0跳过（M4新增28项）。现有依赖bigint原生绑定不可用，测试沿用纯JS回退，未重装依赖。

**没有验证**：没有联网、发送链上交易、重跑剧本或git提交。未启动Docker/Postgres，未运行真实pg迁移/CLI采集/reindex，未连接真实Helius或其他RPC；pg类型/连接事务行为仅由最小Pool替身验证，真实服务端OID/参数/时区与驱动集成仍待验证。CPI/v0/skipped/失败初始化/账户关闭/限流和fetch失败仅合成替身，不是新增链上样本；真实历史保留、长时tail、吞吐/限流压力、多worker迁移/重建并发均未验收。只信finalized、最大交易版本0，不处理链重组。当前账户快照可能领先于入库交易，不能据此证明逐笔历史会计对账；M3未精确分摊利息/f64/ceil的限制仍成立。

### D-012 真实环境验收(2026-10-12,docker Postgres 16 + Helius devnet)

codex 的 85 项离线测试全部通过，但只有连上真实 Postgres 和真实链才暴露了下面 **四个 PGlite 与 fixture 测不出的问题**，均已修复并各补了回归测试：

1. **`pg` 对无参数多语句 SQL 返回结果数组**(迁移文件)，适配层按单个结果处理而崩溃。PGlite 的 `exec` 语义不同，所以离线测试通过。
2. **成功交易的 `err` 被存成 JSONB `null`** 而不是 SQL `NULL`，`WHERE err IS NULL` 一笔都查不到。离线测试没人断言过这一列。
3. **devnet 区块里已有 v1 交易**(slot 509953364 的 70 笔里有 5 笔)，`getBlock` 用 `maxSupportedTransactionVersion: 0` 整块报错，indexer 会卡死在该 slot。改为支持到 1(`MAX_TX_VERSION`)；v1 的 JSON 形状与 v0 相同，只是 `addressTableLookups` 换成 `transactionConfig`。同时：形状不认识的交易，与程序无关就跳过，**提到该程序就报错**，不静默漏掉。
4. **`getBlock`(`rewards:false`)的 `meta.rewards` 是 `null`，`getTransaction` 的是 `[]`**。除此之外两条路径得到的交易逐字段相等。解码不读 rewards，所以结果相同，但 `raw_tx` 的 JSON 不是逐字节相同；同一签名先到先得(`ON CONFLICT DO NOTHING`)。

**实测结果**(devnet，剧本之后回填)：
- 签名回填：20 笔 `raw_tx` = 18 笔含 marginfi 指令 + 2 笔程序**部署/升级**交易(它们把程序地址作为账户引用，没有 marginfi 指令)；18 条指令、25 条事件，指令分布与独立基准一致；`err IS NULL` 20 笔。
- 从数据库读回事件与最新账户状态做 `reconcile`：`issues=[]`，两个 bank 的 shares 之和与总量逐位相等。
- **清库重跑一致**：`reindex` 前后 `instructions` md5 `2057a4eb…`、`events` md5 `d8a66517…` 相同；清库后改用「区块扫描 1 笔 + 签名回填其余」得到的 md5 同样相同。
- 区块扫描：只扫清算前后 5 个 slot，找到且只找到清算那一笔，游标推进到 509953366，内容与回填那条的 `slot`、`block_time`、`transaction`、`meta`(除 rewards)、`version` 全部相等；同一区间重跑 `inserted=0`。

**未验证 / 局限**：
- `tail` 逐 slot 调一次 `getBlock`，追赶历史很慢(devnet 约 2.5 slot/s，一天约 20 万次请求)；追赶请用 `--backfill`，`tail` 只适合从当前 finalized 起实时跟随或扫短区间。没有用 `getBlocks` 跳过空 slot。
- 没有长时间运行、并发、吞吐测试；没有测过 RPC 429 的真实退避。
- `account_states` 只保存"取快照那一刻的当前状态"，不是逐笔历史；每次运行都会新增一批行(按 `context.slot`)，没有清理策略。关闭账户没有墓碑。
- 只处理 finalized，不处理重组。

## D-013 M5a 只读 API（2026-10-12，离线验证）

**实现与来源**：不新增依赖，不改 `src/api/types.ts`。node:http 路由只读取 Db；服务启动不迁移、不连接 RPC。
预言机采集属于 ingest 的 syncStored：由最新可解码 Bank 的 `oracle_keys[0]` 选择地址，owner 白名单先于解码与写库，
整批 owner/布局错误拒绝写入；缺失账户报告并跳过。默认白名单从仓库根目录 `program/out/program-ids.json` 读取 mocks，
加 Switchboard devnet 的 `Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2`；文件缺失时只用后者；
ORACLE_OWNERS 显式设置时覆盖默认集合（空值表示空集合）。PullFeed 3208 字节与 discriminator 严格检查，
18 位价格保留 i128 分子/分母/十进制以及显示 number；scenario 反向复用唯一偏移表，原有 mock-feed 测试保持通过。
快照保留 raw_data/context.slot，rebuildDecoded 通过原始 discriminator 重新解码预言机，不把它变成协议 unknown。

**数量与利率**：原生数量使用两个 I80F48 原始 bigint 相乘 / 2^96，向下取整输出字符串。
利用率由未取整的精确数量比值计算后转 number；有无负债按精确分子判断。USD/健康度用未取整数量到显示边界，
不累加浮点事件作当前余额。APR 来源为本地上游 `marginfi_group.rs` 223–239、320–334、375–388：
保险 + group + flag==1 时启用的 group 缓存 program 费，固定/比例分别求和，排除一次性 origination fee。
group 快照缺失时报错，不能默认 program 费为零。有限利用率显示饱和到 0..1，NaN/Infinity 拒绝；
上游在 >1 会沿第二段外推，本 API 此范围不声称模拟上游实际 APR。

**价格与状态**：sample_size=0 的未 crank feed 虽解码出 0，视图当作价格缺失。价格缺失则 price/USD 为 null，
有余额缺价格则 health.init/maint 为 null。无实际债务为 no_debt；有债务且 maint 非负为 healthy，否则 liquidatable。
当有债务但缺价格时，为遵守现有三态契约，保守返回 liquidatable，同时 health=null；此状态不是实际清算资格证明。
缺 bank 的账户视图拒绝组装，避免省略仓位。没有价格过期策略，只显示最近已入库价格和时间，不暗示价格仍有效。

**活动与 X 光**：按 slot/ix_index/signature（C 排序）降序分页，默认20、上限100；顶层 marginfi 指令一条一行。
主事件名称显式匹配，不拿同指令里的计息事件当业务事件；失败交易保留指令但无已发生事件。清算 amount=null。
事件表缺 inner_index，同一顶层调用的同名事件取最后一条；重复同名 CPI 的精确来源不由活动流承诺。
X 光列出原始 top/inner 全部指令，protocol 解码取存储行，外部程序 unknown 只展示原文。
已知 IDL 参数逐字段 spans，unknown/损坏数据保留完整 raw 分段，非法 base58 保留原文与错误。
日志 base64 使用原始 log_index，数据库 rows 原样返回。404/400 有固定错误体；内部错误只返回固定500消息，
不记录异常对象/请求 URL/数据库或 RPC 配置。

**离线证据**：清算 pre/post maint 与程序报告的 −750.001780881723 / −701.2517808817221 相差小于1e-6。
两个 bank 总量、三用户数量逐个对照独立 Anchor snapshots 的有理数，tSOL存款100、tUSDC借款0。
合成负债覆盖 liquidatable/healthy、缺价格保守状态、不到1原生单位仍有债务；非零精确利用率及 group 费用开关另测。
32交易的18条顶层指令名称/签名与独立 steps 核对；分页覆盖同slot/ix的不同签名及同slot多个ix，不重不漏。
borrow/liquidate 的字节重解参数、所有fixture参数的spans、日志base64与原始数据库行一致；变量参数及v0 inner仅合成验证。
PGlite 验证labels幂等、owner拒绝、raw/context.slot和预言机重建；HTTP直接调用route/handle，覆盖200/400/404/500、
CORS、真正bigint序列化、连接异常脱敏；新增CLI只运行帮助/非法参数，不连接数据库。

**最终检查**：pnpm typecheck exit=0；pnpm test exit=0，102项通过、0失败、0跳过（新增13项）；git diff --check通过。

**临时实现突变**（逐个确认 exit=1 再恢复）：维持资产权重改成开仓权重（math 1项失败）；
漏掉固定APR费用（math 1项失败）；maint状态判断反向（queries 1项失败）；spans少遍历最后一个IDL字段（xray 2项失败）。
这四次是源代码破坏验证，不把损坏输入或初始缺模块导致的失败当成突变捕获。

**额外运行时异常**：一次格式整理后的全套重跑，queries.test.ts 的前两项通过，随后 Node v24.10.0 原生V8崩溃 `Check failed: end > addr`（ThreadIsolation / FreeCode / WasmImportWrapperCache 栈）；该轮101通过、1个文件失败，未显示业务断言失败。该文件单独复跑3项通过，其他完整轮也曾102项通过。没有更换Node/依赖或关闭WASM优化；根因未定位，不能声称该原生问题已修复。

**未运行 / 不确定性**：没有联网、调用真实RPC、发送交易、重跑剧本、构建/部署、启动Docker/Postgres或git提交。
没有启动API socket、运行两个新CLI的正常pg路径、真实003迁移/标签导入、浏览器/前端联调、长时服务、并发/吞吐验证。
预言机价格快照为scenario构造的合成账户，不是新增真实crank结果；已安装依赖的bigint原生绑定不可用，沿用纯JS回退。
各地址最新快照可能来自不同slot，as_of_slot仅最大值；多次SELECT在并发写库时可能看到不同提交，没有跨查询快照隔离。
旧快照无关闭墓碑，不证明当前账户存在。M3未分摊的利息/ceil/f64限制仍成立。
健康度仅实现任务规定的点价格/权重公式，没有重演oracle置信区间、init资产价值上限、隔离风险层等通用链上风险规则；
本fixture验证不能证明其他协议配置下的实际清算资格。

**对未修改契约的异议**：
- AccountStatus缺unknown/no_price，导致缺价格时只能借用liquidatable；建议新增独立未知状态。
- BankView利用率限定0..1，无法忠实表示借款超过存款的状态与上游外推APR；建议同时保留未裁剪比值。
- AccountView注释声称与程序健康度“逐位”一致，但number与f64事件只允许误差内匹配；应改成明确容差。
- as_of_slot最大值和单一group无法表达混合采样/多个group；价格契约也缺owner/provider/mock与过期状态。
  当前多group时group=null；暂不改契约，由维护者与前端协调。

### D-013 真实联调补充(2026-10-13,真实 Postgres + 前端 + 真实 devnet 数据)

codex 的 102 项离线测试通过后,接上真实数据库和前端联调,又发现 **四处** 离线测试没覆盖到的问题,均已修复并各补了回归测试:

1. **JSONB 不保留键顺序**:`instructions.accounts` 存成 JSONB 后,键被按长度再按字节序重排,X 光里清算指令的账户顺序变成 `group, signer, liab_bank…`,而链上位置是有语义的。修复:API 输出前按 IDL 声明顺序重排(账户与参数)。**数据库里存的 JSONB 行本身仍是被重排的顺序**,X 光第三栏如实展示它——这本身是一个值得在视频里讲的点:要保序就存数组。
2. **清算行代币为空**:清算事件没有 `bank` 字段,只有 `asset_bank` / `liability_bank`。活动流这一行改取 `asset_bank`(被清算资产所在的 bank)。
3. **标签不一致**:bank 地址的标签曾是 `bank tUSDC`,池子表里是 `tUSDC`。统一用代币符号。
4. **非 marginfi 指令**:交易里还有 ComputeBudget 与 SPL Token 的指令,被标成 `unknown`。X 光里只把有数据库行的 marginfi 指令展开,其余折叠并标注程序名与"未解码"。

**契约修改(采纳 codex 的异议)**:`AccountStatus` 增加 `unknown`——有负债但缺价格时无法判断健康度,既不能说健康也不能说可清算。此前 API 只能保守返回 `liquidatable`,会误导。

**联调数字**(真实 devnet 数据,剧本之后):tSOL 存款 100、tUSDC 存款 14,512.501895(= Alice 9,000.001546 + Carol 5,512.500349),借款 0,价格 $50 / $1,总存款 $19,512.50;三个账户均为 `no_debt`;活动 18 行,分页遍历 18 条无重复;不存在的签名 404、非法参数 400。

**已知不稳定**:codex 报告过一次 Node/V8 的 WebAssembly 原生崩溃(PGlite),我连跑 6 次完整测试出现过 1 次 `tail.test.ts` 失败、单独复跑通过,根因未定位。若在 CI 中复现,先考虑降低测试并发。

**未验证**:没有压测;没有验证 API 在 Postgres 连接断开时的行为;价格新鲜度(`price_updated_at` 已返回,前端尚未对过期价格做提示);`unknown` 状态只有单元测试,真实数据里没出现过。

## D-014 M6:重跑验收、可复现性与剧本健壮性(2026-10-13)

**重跑验收(目标文档里的标准之一)通过**:用新的 `--run-id r4` 重跑完整剧本,得到新的 group,价格账户复用;**31 步全部 finalized,事件分布与第一次逐类相同**(25 条:group 1、bank 创建 2、配置预言机 2、账户创建 3、计息 10、存款 3、借款 1、清算 1、取款 1、还款 1)。与第一次唯一的步骤差异是 `init global fee state`——全局费用状态是单例,第一次创建后重跑自然跳过。

**重跑前暴露的两个剧本健壮性问题**(都是网络抖动,不是逻辑错误),已修复:
1. RPC 偶发 `ConnectTimeoutError` / `fetch failed`,剧本在第 12 步半途失败。给连接加了重试(只重试没发出去/没收到响应的网络错误)。
2. devnet 上交易发出去后被丢弃,一直等到 blockhash 过期(`TransactionExpiredBlockheightExceededError`),剧本在第 8 步失败。`send` 改为:确认期间每 2 秒重播同一笔已签名交易;过期后先查一次签名状态(防止最后一刻刚好落链),没上链再用新 blockhash 重建;被替换的签名记在 `receipt.dropped`。

**可复现性缺陷(检出 tag 时发现)**:在各集 tag 的**干净检出**里 `pnpm test` 有 5 项失败,最终版同样。原因:剧本代码与测试读取的是被 `.gitignore` 的构建产物 `program/out/marginfi.idl.json`,新克隆的仓库里没有它。修复:统一读入库的 `src/decoder/idl/marginfi.idl.json`,并让 `program/build.sh` 在构建后自动重新生成它(重新生成的结果与入库版本逐字节相同)。**教训:只在"我这台机器"上跑过的测试不算数,必须在干净检出里验证。**

**各集 tag 的状态**:`ep3-end`…`ep6-end` 是在这个修复**之前**的提交,它们在干净检出下仍有这 5 项失败(分别是 17/36/57/89 项测试里的 5 项,其余全过)。历史没有重写;这 5 项失败只与缺少构建产物有关,先在本地跑一次 `./program/build.sh` 即可,或直接用最终版的 `src/decoder/idl/marginfi.idl.json` 覆盖。

**文档里的数字对应第一次运行**(2026-10-11,slot 509953132–509953399):20 笔原始交易、18 条指令、25 条事件等。之后为验收重跑过 3 次(r2、r3 中途失败,r4 完整),链上该程序的历史因此包含更多交易;现在重新 `ingest --backfill` 得到的行数会更多,数据库里目前只有第一次运行的数据。

## D-015 M7a 钱包后端（2026-10-13，离线验证）

**设计与密钥边界**：沿用现有固定 Anchor/web3.js/SPL 依赖，不新增依赖、不改 `src/api/types.ts`。钱包 API 不加载 ANCHOR_WALLET，构建只签一次性 marginfi 新账户，用户付费/签名。水龙头独立加载 FAUCET_KEYPAIR，只转已有币；setup/keeper/set-price 是独立管理员工具，不被 API 导入。公开 feedKeypair 可写 mock feed，测试币/价格不具备生产安全性。

**交易构建**：以 getPool(db).group 限定 bank；账户从 account_states 按地址最新行再筛 authority/group，解码 raw_data 保留槽位顺序；多个账户选 slot 最大、地址平局稳定排序。首次仅 deposit 初始化新 Keypair，ATA 幂等创建放最前，400,000 CU、confirmed blockhash、无 ALT v0。借款新余额放第一个 inactive；mrgn-0.1.0 withdraw_all 在健康检查前 close balance，remaining 排除该槽。freshness 用当前 RPC feed 的 owner/严格布局与时间戳，max_age=0 按任务用240，半窗含边界，未来时间戳拒绝。注意上游 SwitchboardPull 的0默认与任务不同(D-008)，构建层 fallback 不保证程序也接受。

**模拟/转发与错误**：模拟 sigVerify=false/replaceRecentBlockhash=true，失败仍200含交易。Custom 码从固定 IDL 查表，常见错误中文，未知不回显不可信原文。日志只保留公开 Solana runtime invoke/success/consumed 行，任意 Program log/data 省略；牺牲调试细节以满足不泄漏配置/密钥的硬边界。转发验证每个 required Ed25519 签名、payer signer、1232字节、marginfi程序存在及规范序列化；拒绝 ALT，防止未解析地址绕过守卫。先查历史签名状态，再每2秒重播相同字节，confirmed/finalized 成功或链上失败，60秒截止；RPC单次10秒超时、关闭驱动429自动重试，不打印底层异常。同笔交易重提可直接返回已有状态；timeout不能证明未落链，不自动重建签名。

**水龙头**：精确 UI 数量配置转原生 bigint，默认1000 tUSDC/10 tSOL；用户 ATA 幂等创建由专用钱包付租金，一笔原子转账，无 mint-to。纯限流：钱包10分钟、socket IP滚动1小时5次、UTC日全局2000次；预留在await前，失败也计一次，重启清零。不信任 X-Forwarded-For。缺代币503；SOL/租金不足则固定转账失败503。setup才生成0600专用文件并由管理员转SOL/铸币；已有文件默认不重复补币，失败后--top-up重试。

**keeper**：复用 mock-feed 的 resultRegion/writeIx/feedKeypair；resultRegion新增精确18位bigint入口，已有number行为保留。当前链上i128价格全精度不变，用链上slot/block time写时间；block time为空本轮失败，不用本机时间冒充。失败继续下轮，成功重置计数，连续5次失败退出1。set-price可指定18位小数，后续keeper保持该值；并发改价与keeper读写存在覆盖竞态，演示时先停keeper再改价/重启。

**离线证据**：PGlite、真实fixture字节和假RPC覆盖borrow借款前状态、首个inactive排列、首次部分签名的Ed25519验证、四动作/all/u64往返、半窗价格、IDL中文错误、转发守卫/幂等/2秒重播/60秒超时、无socket HTTP状态和脱敏、钱包精确SPL余额、三种限流/ATA/转账/余额不足、setup指令及keeper精确价格/恢复。borrow比较全部固定角色(group/account/signer/bank/vault/authority/token program/ATA)及remaining与fixture完全一致；外层payer/ComputeBudget/ATA创建不在marginfi角色列表比较里。最新authority变更不回退旧历史账户。

**突变验证**：逐次改坏源文件并还原：remaining顺序反转、首次deposit漏init、删除PriceStale判断、删除marginfi转发检查；四次针对性测试均exit=1、各1项失败。漏init导致一次性账户不再是message signer，测试实测在签名阶段报Cannot sign with non signer key，不冒称该轮进入了init断言。

**未运行/待验证**：全程没有联网、发送交易、重跑剧本、部署或git提交；没有运行正常setup/水龙头/keeper/set-price路径、生成持久密钥文件、启动socket/Docker/Postgres或前端联调。真实devnet模拟结果、真实水龙头转账、真实keeper写入全部待验证。CLI只实际运行help/非法参数，交易与服务编排用假RPC；没有Token-2022/staked asset/ALT支持、真实钱包兼容验证、长期运行或并发负载验收。用户账户发现有indexer延迟(新建未采集时会再创建)、没有关闭墓碑；bank/feed/用户快照可能混slot，bank配置可能已变化，最终以模拟与链上执行为准。限流多进程/重启不共享，不是生产服务。

**最终检查**：pnpm typecheck exit=0；最后原命令pnpm test exit=0，129项通过、0失败、0跳过(新增21项M7a测试)。git diff --check通过；snapshot-docs检查21片段无过期/失败，EP3受共用编码签名影响的片段已自动同步。

**运行时不确定性**：首轮pnpm test在已有src/store/migrate.test.ts发生Node24.10.0/V8 WebAssembly原生崩溃(Check failed: end > addr)，124通过、1文件失败，没有业务断言失败；这是D-013已记录的同类问题，根因仍未定位。没有更改Node/依赖或屏蔽测试，最终复跑结果另记docs/progress.md；单次通过不代表原生问题已修复。现有bigint依赖使用纯JS回退，未重装/重建。

**固定契约的异议(未修改)**：钱包段注释只列两类服务端密钥，没有区分独立水龙头专用钱包与管理员CLI的进程边界；BuildRequest.amount在all=true仍必填但内容忽略，前端需传字符串；SendRequest缺last_valid_block_height，无法精确区分过期与确认超时，只能按60秒返回timeout；共享契约未定义HTTP错误封装(409的error为ProgramErrorView、其他固定错误为字符串、429另有next_allowed_at)。另沿用D-013尚未解决的number健康度“逐位”措辞/混合slot表达问题。

### D-015 真实 devnet 与浏览器联调补充(2026-10-13)

codex 的 M7a 离线测试通过后,接上真实 devnet(Helius)、真实 Postgres、真实浏览器验证。**钱包全流程通过**:用全新钱包经真实 HTTP 接口走完 领币 → 首次存款(自动建账户)→ 借款(真实负债)→ `repay_all` → 再存款(不重复建账户)→ 两次 `withdraw_all`(`scripts/e2e-wallet.ts`),并在浏览器里用开发测试钱包经界面走了 领币 → 预览 → 签名 → 发送 → 索引器捡到 → 页面显示。

联调中发现并修复(各补回归测试):
1. **账户发现依赖索引器快照**:用户刚存款、索引器未追上时,下一次存款被当成首次而**重复创建账户**;快照里的槽位过期也会让 remaining 顺序排错。改为用户账户内容**始终从链上读**(`readUserFromChain`),地址先查库、查不到按 `group+authority` 用 `getProgramAccounts` 过滤。
2. **多个 group 并存**:重跑剧本新建 group,`--follow` 把它们全部入库,`pool.group` 为 null。新增 `POOL_GROUP` 环境变量,池子/账户/活动流都按它过滤。
3. **CORS 写死 localhost**:页面用 `127.0.0.1` 打开时水龙头(另一端口)被浏览器拦下。改为按 `Origin` 匹配白名单(`CORS_ORIGINS` 可追加)。
4. **`oracle_max_age = 0` 默认 240 是编造的**:上游 `get_oracle_max_age` 对 SwitchboardPull 的 0 就是 0(只有 SwitchboardV2/Pyth 有默认)。去掉默认值。
5. **同一 bank 的存款会被"借款"先扣**(marginfi 语义,非 bug):e2e 剧本曾因此误报;界面加提示,剧本改用另一种抵押品。模拟正确地拦截并翻译了 `NoLiabilityFound`。
6. e2e 脚本成功后进程不退出(`sendAndConfirmTransaction` 的 WebSocket 订阅),补 `process.exit(0)` 与请求超时。

另:新增 `ingest --follow`(每 5 秒一次按签名查询,遇到已知签名即停);`tail` 的旧游标会让它从几天前开始追,且逐 slot 请求会很快耗光 RPC 额度。

**真实测得的数字**:首次存款 27,328 CU、借款 51,503、`repay_all` 35,811、再存款 22,579、`withdraw_all` 36,733 / 22,424;借 200 tUSDC 又还清后钱包里少 0.000003 tUSDC(利息)。

**仍未验证**:真实 Phantom/Solflare(只用开发测试钱包走了签名流程,它是 web3.js 的 Keypair,与扩展钱包的签名确认弹窗、网络切换行为不同);水龙头限流在真实并发下的表现;价格维护进程长时间运行;keeper 与 `set-price` 并发的覆盖竞态;Token-2022。

## D-016 界面静默刷新与 SOL 兑换测试币(2026-10-14)

**静默刷新**:此前每次轮询都把外层容器置灰(`stale` → 透明度 0.55),整页每 5 秒闪一下。改为后台刷新完全静默:刷新期间保留旧数据、数据没变不触发重渲染(序列化比较)、标签页在后台时暂停轮询并在切回时立刻刷新一次、页头只用淡色文字显示"更新于几点"。实测:监视 12 秒(两次完整轮询),变灰采样 0 次。

**SOL 兑换测试币**:测试币是自己发行的,没有真实的 AMM 池子。做成固定汇率的**原子兑换台**(`src/faucet/swap.ts`):一笔交易里"用户转 SOL 给兑换台"+"兑换台转代币给用户",兑换台先签名、用户再签名;手续费和 ATA 租金由用户付,兑换台不垫付 SOL;取整向下;汇率是 mock(默认 1 SOL = 1 tSOL = 50 tUSDC)。转发复用钱包转发接口的签名检查(`guardTransaction`),**程序白名单由调用方传入**,钱包转发接口本身没有放宽。5 项测试 + 4 个突变(取整改向上、去掉程序白名单、不要求兑换台签名、让兑换台付手续费)均被抓住。真实 devnet 上经界面验证:0.02 SOL → 1 tUSDC。

**未验证 / 局限**:兑换台没有按 IP 限流报价请求(报价不上链也不花钱,但可被刷);兑换台收到的 SOL 会累积在专用钱包里,没有清退机制;汇率是固定的,不随池子里的价格变化;真实 Phantom 的确认弹窗对这种"两个签名者"的交易如何显示未验证。

## D-017 价格自动保鲜、confirmed 乐观入库、任意互换(2026-10-14)

用户反馈两个真实问题,以及一个需求:借款/取款时界面出现"价格维护进程没有运行";借款后借贷池的数字很久不更新;兑换要能 SOL/tSOL/tUSDC 任意互换。

**1. 价格保鲜不能依赖后台进程。** 根因:价格维护进程(`price-keeper`)连续 5 次刷新失败后按设计退出,价格 8 小时多没更新。修复:构建借款/取款交易时,价格账户时间戳超过 30 秒就**在这笔交易里加一条只写 8 字节时间戳的 `write` 指令**(价格数值不动),价格账户密钥是公开派生的,服务端代签,手续费包含在用户交易里;时间取链上时间;只有价格账户不存在/从未有过价格/不是我们的 mock 才报 `PriceStale`,文案不再提"维护进程"。`writeIx` 从 `scenario/` 搬到 `src/oracle/mock-write.ts`(API 不应依赖剧本目录)。验证:关闭维护进程、价格过期 140 秒以上,全新钱包走完 借款、还款、取款全部通过;借款 CU 51,503 → 53,216。4 个突变均被抓住。`price-keeper` 保留但不再必需。

**2. 实时跟随改为 confirmed 乐观入库 + 终局清扫。** 之前只认 finalized,交易确认后要再等 30 秒以上。现在 `--follow` 默认 confirmed(`--commitment`),`raw_tx.finalized` 标记是否终局(迁移 004);清扫(`src/ingest/finalize.ts`)每轮确认:finalized → 标记;**查不到且 finalized slot 已超过它 150 个 slot** → 删除(解码行级联);观察期内查不到的不删(负载均衡节点可能落后,误删比晚删糟糕)。回填和扫区间仍只认 finalized,`confirmed` 仅限 `--follow`。实测:确认 4.0 秒,API 在确认后 2.1 秒看到变化。前端在交易确认后加速轮询 45 秒(1.5 秒一次)。账户快照也按同一级别取,状态按 slot 取最新,自修正。

**3. 兑换改为任意两两互换。** 汇率由统一的 USD 单价推导(默认 SOL $50、tSOL $50、tUSDC $1),整数运算向下取整,多个起点验证绕一圈不会变多(无套利环);六个方向的两条腿方向/数量/授权人均有测试;兑换台保留 0.05 SOL;单笔 $0.05~$100。真实 devnet 经界面验证三个方向,含"买入 SOL"(兑换台向用户转 SOL)。

**未验证 / 局限**:confirmed 回滚在 devnet 上极少发生,清扫的"删除分叉上的交易"路径只有离线测试,没有在真实分叉上验证;`account_states` 在 confirmed 下可能短暂记录之后被回滚的状态,靠更高 slot 的快照覆盖;兑换台没有对报价请求限流,收到的 SOL/代币累积在专用钱包里无清退机制;真实 Phantom 对"两个签名者"的兑换交易如何显示未验证。

## D-018 前端分 tab 与 Switchboard 复查(2026-10-17)

**前端分 tab。** 原来单页从上到下依次是 KPI、钱包面板、借贷池表、利率曲线 + 账户、活动流,钱包面板夹在中间,看数据和做操作互相干扰。改为四个 tab:**借贷池**(KPI、池子表、利率曲线 + 选中代币的参数卡)、**账户**、**链上活动**(X 光入口)、**我来操作**(钱包)。
- 当前 tab 写在 URL hash(`#pool` / `#accounts` / `#activity` / `#wallet`),刷新、分享、浏览器后退都保留;录视频可直接打开某个 tab。
- 不在当前 tab 的面板只隐藏不卸载:切走再回来,填了一半的表单、已"加载更多"的活动仍在。
- 三份数据仍在后台轮询:tab 上显示账户数,有可清算账户时变成红色"N 可清算",不切过去也能看到。
- 参数卡(权重、利率曲线参数、价格来源、上次计息)上的"存入/借出"按钮跳到操作 tab 并预选代币与操作;交易确认后可直接"用 X 光看这笔交易"。顺带修正了过时文案"索引器需要几十秒(等到 finalized)"(D-017 之后是 confirmed,几秒)。
- 验证:web typecheck、`vite build` 通过;无头 Chrome 对真实 API 渲染,四个 hash 各自只显示对应面板、无错误;`?mock=liquidation` 下账户 tab 显示"1 可清算"。**未做**:人工肉眼看截图(本次工具链只能拿到 DOM)、真实钱包点一遍预设跳转。

**Switchboard 复查。** 链上读队列 `EYiAmGSd…` 的 9 个 oracle:`nodeTimeout` 300 秒,最新心跳距今 625,732 秒(约 7.2 天),其余 31–60 天;与 D-008(10-11 时约 39 小时)对比,10-11 之后没有任何新心跳。`crossbar.switchboard.xyz` 仍无响应,`crossbar.switchboardlabs.xyz/gateways?network=devnet` 仍返回 `[]`。npm 上 `@switchboard-xyz/on-demand` 最新仍是 3.10.6(2026-07-30),与仓库固定版本相同,没有新的 devnet 队列。**结论:真实 Switchboard 在 devnet 仍不可用,继续使用 D-009 的 mock 布局方案。**

**对照 usdx-solana 的历史做法(2026-10-17 复查)。** usdx 在 2026-09-14~17 自建 Switchboard feed 成功(`docs/ops/switchboard-devnet.md`、提交 `089789f`):任务定义走 Crossbar **v1 `/store`**(body `{jobs, queue}`,queue 用 base58),用 SDK `PullFeed.fetchUpdateIx` crank;固定价 feed `9MxhTu4V…` 报出 $1。本项目 D-008 已经采用同一做法(v1 `/store`、feed 创建成功),所以没有遗漏的配置可以照搬。用 usdx 自己的 feed 和代码路径复测(只取签名、不发交易):
- usdx 的两个 feed 最后一次更新都在约 33 天前(即 usdx 停止工作的 09-14~17),之后没人 crank 过;
- SDK 默认的 `crossbar.switchboard.xyz` DNS 解析失败(`ENOTFOUND`);
- 换 `crossbar.switchboardlabs.xyz` 后 `/fetch/<feedHash>` 返回 404(`Feed not found … public HTTP 429`),usdx 存的任务定义已取不回。这一项可以靠重新 `/store` 补上;
- 队列登记的 oracle gateway(`*.xip.switchboard-oracles.xyz/devnet`)直连 12 秒超时,oracle 心跳停在约 7 天前。**这一项我们修不了**:feed 只能由 oracle 签名写入。

结论不变:usdx 当时能用,是因为那时 devnet oracle 还活着(其文档记录 09-14 队列心跳是"刚刚");现在差别在网络,不在配置。

**Switchboard 已整体关停(2026-10-17 联网核实)。** Switchboard Technology Labs 于 2026-09-19 宣布所有实现弃用,09-25 停止全部支持,建议迁到 Pyth / RedStone;`docs.switchboard.xyz` 已不可达。链上复测同上(最新心跳约 7.3 天前,gateway 超时)。**不会恢复,不再"监控等待"。**

**devnet 上可用的真实价格:Pyth 赞助喂价。** shard 0 的 PriceUpdateV2 账户(owner `rec5EK…`,校验级别 Full)在 devnet 持续更新:SOL/USD `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`、USDC/USD `Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX`;实测更新间隔约 1–2 分钟(另有偏离触发)。mrgn-0.1.0 已有 `PythPushOracle`(OracleSetup 3),`oracle_max_age` 需 ≥ 约 180 秒。限制:价格跟真实行情走,无法按需打低,演示清算仍需 mock。

**最新 marginfi(0dotxyz/marginfi-v2,tag mrgn-0.1.12-rc2)的预言机。** OracleSetup 共 29 种,没有 RedStone、没有 Chainlink 直连。0.1.11 新增 `Fixed` 系列(管理员 `lending_pool_set_oracle_price` 设价)与 `Scope`(Kamino 的聚合器,选 OraclePrices 的 512 个槽之一);0.1.12 加 `ScopeKamino/ScopeJuplend`。代码里 `SwitchboardPull` 未删除,应对方式是新增 Scope 并逐个银行改绑。mainnet 401 个银行的实测分布:PythPushOracle 136、SwitchboardPull 71、PythLegacy 47、Fixed 39、StakedWithPythPush 26、PythLST 23、KaminoPythPush 22、SwitchboardV2 13、其他 24(Scope 仅 1)。71 个 SwitchboardPull 银行是否仍有余额未核实。

**RedStone 只能间接接入:marginfi → Scope → RedStone。** Scope(Kamino-Finance/scope,2026-10-15)的 OracleType 有 `RedStone`(30)、`FixedPrice`(23)、`Chainlink`、Orca/Raydium/Meteora 池价等,Switchboard 类已改为废弃占位。代价:要升级到 marginfi ≥ 0.1.11(布局/IDL/事件全部变化,解码器、fixtures、章节文档要重做),Scope 主网程序 `HFn8GnPA…` 在 devnet 不存在,须自部署;RedStone 在 Solana devnet 的可用性未验证。

## D-019 Pyth 定价的 pSOL 银行与按预言机定价的兑换台(2026-10-17,devnet 已验证)

**做法:只增不改。** 新测试币 pSOL(`bjwmjXvF…z33`,9 位)与银行 `D77PE9gn…r4pN` 挂在线上池子 group `GHVn8kr8…`,`OracleSetup = PythPushOracle(3)`,价格是 Pyth devnet 赞助的 SOL/USD(shard 0 账户 `7UVimffx…jLiE`)。风险参数照搬 tSOL,`oracle_max_age = 300`。tSOL/tUSDC 银行与清算剧本不动(真实价格无法按需打低)。脚本 `scripts/add-pyth-bank.ts` 幂等。

**源码核实(mrgn-0.1.0)与由此带来的改动:**
- Pyth 银行的 `oracle_keys[0]` 存 **feed id**,不是账户;程序只校验 owner = Pyth Receiver、feed id、校验级别 Full 与年龄,不校验地址。→ 构建器 remaining、索引器快照、API 价格都先经 `oracleAccountOf` 换算(`src/oracle/pyth.ts`)。
- `PriceUpdateV2` 的 `verification_level` 是变长枚举(Partial 2 字节/Full 1 字节),偏移随之变化 → 手写解码 `src/decoder/pyth.ts`,用真实账户 fixture 加合成 Partial 测试。
- 健康度用价格**区间**:开仓用 EMA、维持用实时价;资产取下沿、负债取上沿;半宽 Pyth `conf×2.12`、Switchboard `std_dev×1.96`,上限价格 5%。API 原来只用中间价——mock 的 std_dev 为 0 所以过去一致,接入 Pyth 后会偏乐观 → 新增 `src/api/oracle-price.ts`,`health()` 接受区间。用真实验证账户核对(误差 < 1e-5,来自显示余额取整)。
- Pyth 账户我们不能写,构建器对 Pyth 只检查年龄 ≤ `oracle_max_age`,过期报 `PriceStale`(文案"Pyth 价格暂未更新"),不像 mock 那样在交易里刷新。

**兑换台:** 汇率不再写死(原默认 SOL=$50)。每次报价从链上读各资产在借贷池里用的同一个价格账户(`src/faucet/prices.ts`):SOL、pSOL → Pyth;tSOL、tUSDC → mock。Pyth 超过 600 秒未更新、非 Full、价格 ≤ 0 时拒绝报价。资产增加 pSOL(12 个方向)。水龙头在池子有 pSOL 时额外发 10 pSOL。前端价格旁标注来源,兑换资产列表改为从服务端读取、30 秒刷新。

**验证:**
- devnet 直接调程序(`verify-pyth-bank.ts`):存 10 pSOL 借 100 tUSDC(签名 `5BP9mQaL…`)、存 500 tUSDC 借 1 pSOL(`4YuD58yL…`),各约 6.4 万 CU。
- 经新服务的 HTTP 端到端(`e2e-pyth.ts`):SOL→pSOL 兑换、首次存款建账户、借 2 tUSDC(约 8.2 万 CU)、还清、取出全部,均确认;API 对该账户给出"健康"。第一次运行在"还清全部"处因钱包只有借到的本金、不够付利息而失败(SPL Token `Custom(1)`),原错误提示是含糊的"交易未能执行",已改为翻译成余额不足并提示利息;该次的一次性钱包仍欠 2 tUSDC(私钥未保存,devnet 无害)。
- 离线:新增/改写 Pyth 解码、地址、定价、兑换、构建器、API 集成测试,全套见进度表。

**未验证 / 局限:** 真实钱包(Phantom)对 pSOL 流程未点过;Pyth devnet 赞助更新节奏只实测了几分钟(约 1–2 分钟一次),长时间断更时 pSOL 借款/取款会被拒绝,而且我们无法自行推送(需要 Hermes + receiver 程序,未实现);API 健康度对 Pyth 是浮点近似,未与程序逐位对照(没有程序报告健康度的事件可比);兑换台的报价随行情变化,没有滑点保护,报价到签名之间价格可能已变(成交按报价当时价,风险在兑换台一方)。

## D-020 前端:代币图标与说明、市场列表、独立兑换页(2026-10-17)

**代币展示信息放在前端。** 测试币链上没有 Metaplex 元数据,所以名称、说明、图标登记在 `web/src/tokens.tsx`(按符号查):SOL、pSOL、tSOL、tUSDC 各有内联 SVG 图标,测试币右下角带角标(t / P),和真 SOL 一眼区分;价格来源用角标标明"Pyth 实时 / mock 价"。**未做:** 链上元数据(钱包里显示名称和图标需要 Metaplex 账户 + 一个公开可访问的 JSON/图片地址;目前没有托管地址)。

**界面参照主流产品重排:**
- 借贷池:四个 KPI(新增"可借流动性");市场列表参照 Aave / marginfi / Kamino——资产列带图标与名称,存/借 APR 并排,利用率条,最高抵押率,每行"存入 / 借出"直达;窄屏每行变卡片。资产详情加入说明、存借 APR 对比与价格账户。
- 兑换独立成 tab,参照 Jupiter / Uniswap:卖出/买入两个输入框、带图标与余额的代币选择器、翻转按钮、"一半/最大"、汇率可反转、单价/滑点/网络费/限额明细,主按钮文案说明还差什么(连接钱包 / 输入数量 / 余额不足 / 单笔限额)。
- "我来操作"拆成"钱包资产 + 我的头寸"与操作表单(`wallet/ActionForm.tsx`):代币选择器显示各资产的存借 APR,按动作给出"最多"(存款看钱包、取款看存款、还款看负债)。水龙头缩成一行卡片,引导去兑换。
- 后端只加了 `GET /api/config`(兑换台地址),让没连钱包时兑换页也能显示汇率。

**联调中发现并修复:**
- 类名冲突:tab 上"钱包已连接"的绿点用 `.live`(7×7 圆),把所有"Pyth 实时"角标(`.src.live`)压成 14px 的色块——各页面都受影响,窄屏还造成 2px 横向溢出。改名 `.live-dot`。
- 刚连上钱包时余额未读到被当成 0,兑换按钮先显示"SOL 余额不足"几秒。改为"读取余额中…",余额显示"—"。
- `/api/wallet` 每次 2.5–4 秒:本机到 Helius 每次 RPC 约 1 秒,且是串行的多次调用;改为 SOL 余额与所有代币账户并行、代币账户一次 `getMultipleAccountsInfo`,热请求约 1–1.3 秒。前端原来"我来操作"和"兑换"各轮询一份,改为在 App 里轮询一次共用。
- 缺 favicon 导致每次首次加载控制台一条 404。

**验证:** 无头 Chrome(playwright-core)在 1280 浅色与 390 深色下逐个 tab 检查:无横向溢出、无控制台错误、图标渲染、选择器不越出视口;用开发测试钱包在真实 devnet 上通过界面完成一次兑换(0.005 SOL → 0.524808 tUSDC)。**未做:** 人眼看截图(本次工具链拿不到图像);真实 Phantom 点一遍。

## D-021 测试币链上元数据(2026-10-17,devnet 已写入)

钱包按 Metaplex 元数据的 `uri` 取 JSON、再按 JSON 的 `image` 显示图标。托管选了本仓库(公开):`assets/tokens/` 放 PNG/SVG/JSON,URI 用 `raw.githubusercontent.com/LixvYang/solana-lending-indexer/main/...`。没选 Irys devnet,因为 devnet 上传约 60 天后过期,图标会消失。

- 图标从运行中的前端导出(与 `web/src/tokens.tsx` 同一份设计),渲染成 512×512 透明 PNG;角标描边在独立文件里改为白色。
- `scripts/token-metadata.ts` 手写 `CreateMetadataAccountV3`(判别字节 33)/ `UpdateMetadataAccountV2`(15),幂等;写入前先确认 URI 可访问,避免把死链写上链。先在 devnet 模拟三条创建指令均通过,再发送。
- 元数据账户:tSOL `Cb3bcMCk…`、tUSDC `ACp5y2pq…`、pSOL `HmDUF2Cd…`;update authority 为管理员钱包,`is_mutable = true`,以后可改。重跑脚本三项均"已是最新,跳过"。
- 独立核对:Helius DAS `getAsset` 对三个 mint 解析出正确的名称、符号、JSON 与图片地址。

**未验证:** 真实 Phantom/Solflare 里的显示效果(钱包可能对未认证的 devnet 代币做缓存或折叠);raw.githubusercontent.com 有几分钟缓存,改图后钱包可能延迟刷新。名称是中文,个别钱包的字体回退效果未看过。

## D-022 全新 clone 的只读路径(2026-10-17,实测修复)

为评估能否对外,从 GitHub 全新 clone 到临时目录、只给 `RPC_URL`、用空数据库走"接入作者部署"的路径。发现三处只有陌生人才会碰到的问题(作者本机都有本地文件,从没暴露):

1. **回填直接失败**:`oracle owner mismatch`。索引器从 `program/out/program-ids.json` 读 mocks 程序地址,而 `program/out/` 被 .gitignore 排除(里面有程序私钥,必须排除)。→ 新增入库的 `program/devnet.json`(只有公开地址),`oracleOwners` 在没有本地构建产物时退回读它。
2. **不设 POOL_GROUP 时四个池子混在一起**,API 的 group 为 null。→ 没设时默认作者的池子,但只在库里确实有这个池子时才用,自己部署的人不受影响。
3. **pSOL 没有标签**(显示地址缩写、没有图标,水龙头/兑换台也找不到它),因为 `load-labels` 只导入剧本 fixture。→ `program/devnet.json` 增加 `labels`,默认导入时一并写入。

修复后同一个全新 clone:回填与价格快照成功、对账通过、API 默认展示作者的池子(pSOL 走 Pyth、tSOL/tUSDC 走 mock)、12 个账户。README 新增这条"只需 RPC"的快速开始,并改正多处"Switchboard 暂时离线"的过时说法(已关停,D-018)。

## D-023 前端定位：从"索引器演示"到"devnet 可用的借贷产品"(2026-10-22)

**背景。** 用户希望项目在 devnet 上线后能被真实使用，前端好看、一目了然，同时便于教学。对照了 Aave(Markets、USDC 资产详情页)与 Morpho(Markets 列表、USDC/cbBTC 市场页的 Market/Rates/Risk/Activity 区块)的实际页面。Aave 的 Dashboard 与存款弹窗需要连接钱包，本次未实看，按已知设计参考。

**差距(按影响排序)。**
1. 看资产和操作资产在两个 tab:"市场"里点"存入"会跳到"存款借款",离开资产上下文。Aave 原地弹窗，Morpho 在资产页右侧吸顶面板。
2. 交易前没有风险预览：只显示 APR,超额借款只能从模拟拿到 `RiskEngineInitRejected`。Aave 显示"健康因子 1.82 → 1.45",Morpho 实时显示 LTV / 清算 LTV。
3. 没有资产详情页(KPI、存借信息、抵押参数、利率模型、历史、清算记录、流水)。
4. 没有"我的仓位"总览(净资产、净 APY、健康因子、已用额度)与新手上手路径。

**决定。**
- 信息架构改为：市场(列表 → 资产详情 `#market/<符号>`)/ 我的仓位 / 兑换 / 链上数据(活动 + 交易拆解 + 清算监控)。"存款借款"tab 取消，操作表单移入资产页右侧。
- 健康度主显示**比值** = 维持口径加权资产 ÷ 加权负债(<1 可清算，与 Aave 健康因子同义);现有 USD 差值(`health.maint`)放在说明里。理由:USD 差值 +$50 无法让用户判断离清算多远，比值可以。
- 风险预览在前端用 `BankView.weights`、价格与用户 `AccountView.balances` 计算，只作预览;以服务端模拟结果为准，两者冲突时显示模拟结果。注意程序对 Pyth 价格用置信区间的低/高价(`src/api/math.ts` ep7-health),前端只有单一价格，pSOL 的预览会略偏乐观——界面需注明"预估"。
- 历史曲线需后端按时间聚合;`account_states` 只在快照时刻有点，粒度取决于快照频率，动工前先核实。

**执行方式。** 任务拆分写在 `docs/frontend-revamp.md`,由 Codex 逐个实现,Claude 审查(typecheck、测试、浏览器截图)后给结论并更新状态。

## D-024 新增 Pyth 定价资产 pBTC / pETH / pHYPE(2026-10-22,devnet 已验证)

**做法。** 沿用 D-019 的 pSOL 机制(`OracleSetup = PythPushOracle`,Pyth devnet 赞助推送 shard 0),`scripts/add-pyth-bank.ts --symbol <符号>` 参数化，参数集中在 `src/oracle/pyth-banks.ts`。三者 8 位小数(与 Solana 上常见的跨链 BTC/ETH 一致);风险参数照搬 tSOL;命名沿用 `p` 前缀 = Pyth 定价测试币。地址见 `program/devnet.json`。

**`oracle_max_age = 900`(pSOL 仍为 300)。** 实测(约 22 分钟，每 15 秒读一次账户数据)更新间隔:SOL 60–243 秒;BTC 149–340 秒(推算另有约 440 秒);ETH 最长 463 秒;HYPE 262–376 秒。照搬 300 秒会让借款/取款经常因 `PriceStale` 被拒;900 秒约为观测最大间隔的 2 倍，测试网的代价只是价格可能旧几分钟。

**水龙头。** 每次约 $500:0.006 pBTC、0.2 pETH、6 pHYPE(按 2026-10-22 devnet Pyth 价 BTC $84.3k、ETH $2.5k、HYPE $80.9);可用 `FAUCET_P*_AMOUNT` 覆盖。

**验证。** 三个资产各 4 笔管理交易确认;`scripts/e2e-pyth.ts pBTC|pETH|pHYPE` 经真实 HTTP 接口走完兑换 → 存入 → 借 tUSDC → 还清 → 取出，全部确认(借款约 8.1 万 CU)。

**顺带修复。** 管理脚本完成后因 web3.js websocket 不退出(曾留下运行 4 天的进程),改为显式退出;备货数量支持小数。

**未验证。** 新币的 Metaplex 元数据未写(钱包里无名称/图标);Pyth devnet 赞助更新节奏只测了 22 分钟，长时间断更时借款/取款会被拒。

## D-025 对外名称:"借贷市场"(2026-10-22)

作者要求：不再把项目当作索引器展示，产品直接叫"借贷市场"。界面标题、页头、浏览器标签改为"借贷市场";副标题改为"在 Solana devnet 上存款赚息、抵押借款";页脚、链上活动说明、市场表头去掉"索引器 / 状态快照 slot"等内部说法。交易详情抽屉保留(仍是给想看底层的人的入口),只把文案从"索引器写进 Postgres"改为"存进数据库后的样子"。

**后续(同日，作者决定一起改):** GitHub 仓库改名为 `LixvYang/solana-lending-market`(`gh repo rename`,本地 remote 已更新),本地目录改为 `~/code/github/rebetxin/solana-lending-market`;README、AGENTS、目标、教程与分镜的项目称呼改为"借贷市场"(T9)。**刻意保留:** `scenario/lib/actors.ts` 与测试钱包的派生种子 `solana-lending-indexer/…`——所有确定性地址都由它算出，改了就指向链上不存在的账户;数据库用户名/库名 `indexer`(只是本地凭据)。

## D-026 Pyth devnet 的 HYPE 推送会长时间断更;兑换台逐资产降级(2026-10-22)

**观测。** D-024 上架时 22 分钟采样里 HYPE 最长间隔 376 秒;同日晚些时候实测 HYPE 推送账户已 2,179 秒(约 36 分钟)未更新，同时 SOL/BTC/ETH 约 90 秒。Pyth 对 devnet 的赞助推送不保证各 feed 的节奏，短时间采样不足以定出上限。

**影响。**
1. 兑换台的汇率表原来对全部资产 `Promise.all`,一个过期就整表 503,连 SOL ↔ tUSDC 也换不了。→ 已改为逐资产取价(`Promise.allSettled`),过期资产 `usd = null` 并附原因，前端选择器标"价格暂不可用"、主按钮提示;涉及它的报价仍被拒。新增测试(旧实现下失败)。
2. pHYPE 银行 `oracle_max_age = 900`,断更超过 15 分钟时，**任何持有 pHYPE 头寸的账户**做借款/取款都会因健康检查缺价而失败(不只是操作 pHYPE 本身)。未处理，见下。

**未处理(待作者决定):** 前端仍把 pHYPE 标成"Pyth 实时",过期时应改为"价格过期"并在资产页说明影响;是否把 pHYPE 的 `oracle_max_age` 再放宽，或在 HYPE 推送稳定前暂停 pHYPE 存款(`lending_pool_configure_bank` 改 operational state)。

## D-027 HYPE 改为自有固定价格(tHYPE),不再依赖 Pyth(2026-10-22,devnet 已验证)

**原因:** D-026,Pyth devnet 的 HYPE 推送断更 36 分钟，持有该资产的账户借款/取款全部失败。作者决定 HYPE 改为固定价格、后台定时写上链;BTC、ETH 仍用 Pyth。

**做法。** mrgn-0.1.0 的 `OracleSetup` 没有 `Fixed`(核对过上游 `state/price.rs`:只有 None/PythLegacy/SwitchboardV2/PythPushOracle/SwitchboardPull/StakedWithPythPush),所以沿用 tSOL/tUSDC 的 mock 价格账户:mocks 程序拥有的 Switchboard 布局账户 `feed/tHYPE`(`35JES1e18iBY9Wm3T4LCjErHM3vSbvimsHQXxXnHoCot`),价格 $80,银行改为 `SwitchboardPull(4)` 读它(`scripts/fix-hype-oracle.ts`,幂等)。`scripts/price-keeper.ts` 定时刷新时间戳;交易构建器在用户交易里也会顺便刷新，所以 keeper 停了也不会过期。

**符号 pHYPE → tHYPE**(`t` = 我们定价)。只改链下标签;mint/bank 的派生种子仍是 `mint/pHYPE`、`bank/pHYPE`(地址不变)。

**验证。** 三笔管理交易确认(建价格账户、写价、改预言机);回填后 `/api/pool` 显示 tHYPE `mock $80`,兑换台 7 个资产全部报价;`scripts/e2e-pyth.ts tHYPE` 走完兑换 → 存入 → 借 2 tUSDC → 还清 → 取出;隔 75 秒读价格账户，时间戳前进(keeper 在工作)。

**注意:** 第一次端到端在借款步失败(`PriceStale`),因为 API 进程是改代码前启动的，签名者名单里没有 tHYPE;重启 API 后通过。**改了预言机相关代码后要重启 API、兑换台与 keeper。**价格固定意味着 tHYPE 不跟市场走，清算演示仍用 tSOL 改价。

## D-028 全免费托管路径：Vercel Functions + Supabase(2026-10-24)

作者选择不用自有 VPS，前后端放 Vercel Hobby，Postgres 用 Supabase Free。保留现有 `SERVICE=api|faucet|keeper|ingest` 容器路径，新增根目录 Vercel 函数入口：同一个 Node 函数分发 `/api/*` 与 `/api/desk/*`，公共只读 GET 使用 5 秒 CDN 缓存；钱包请求、POST 与错误响应不缓存。前端使用同源 `/api/desk/faucet`，不设置 `VITE_API_BASE`。

Vercel 不运行迁移，也不运行常驻 keeper/ingest。API 请求通过 `waitUntil` 触发 30 秒节流的 `followOnce`，数据库原子租约最长 60 秒；每日 Cron 以 `CRON_SECRET` 鉴权做一次低频同步，并避免 Supabase Free 长时间无活动暂停。mock 价继续由用户借款/取款交易刷新，Pyth 仍由推送账户提供。

Supabase **Transaction pooler** 用于运行时请求；函数连接池默认 1，查询不使用命名 prepared statement 或会话级 `SET`/锁。迁移仍由维护者在本地使用 Supabase **Session pooler** URI 执行。新增 006 迁移保存同步租约与水龙头预留；水龙头容器与 Vercel 共用数据库限流，借助事务级 advisory lock 复用 T20 钱包/IP/全站滑动窗口规则。

`TRUST_PROXY_HOPS` 的 Vercel 取值尚待真实请求头核验，部署文档暂标为待验证；Vercel 打包函数入口及相对导入、Supabase Transaction pooler 行为、Hobby 预览部署和全链路仍待 Claude 联调。具体步骤见 `docs/deploy.md`。

