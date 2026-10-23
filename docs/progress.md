# 进度

更新规则:每完成或阻塞一项就改这里,并写明日期。状态:`todo` / `doing` / `done` / `blocked`。

## 里程碑

| 里程碑 | 内容 | 对应章节 | 状态 | 备注 |
|---|---|---|---|---|
| M0 | 构建并部署 marginfi mrgn-0.1.0 到 devnet,完成一次 deposit + borrow | EP3 | done | 已部署并升级到 mock 价格版本(D-009);真实 Switchboard 因 devnet oracle 离线未启用(D-008) |
| M1 | 确定性剧本 + fixtures + expected.json | EP3 | doing | 2026-10-11：scenario 代码与离线检查已实现；devnet Switchboard 方案见 D-007。未运行 --execute、真实 Crossbar/feed/crank/改价、链上借贷清算、对账或重跑；未生成真实 fixtures |
| M2 | 指令解码器 | EP4 | done | 2026-10-12：手写 base58 / Reader / IDL Borsh、账户角色、顶层与 inner 指令及离线 CLI；32 笔 fixture 中的 18 条指令与 Anchor 一致；另有对全部 23 个带参数指令的 Anchor 编码往返测试(合成数据)；typecheck 通过，36 项测试通过。非空 v0 地址表与 marginfi CPI 仅合成测试，未联网或发送交易；fixture 之外的指令没有链上样本 |
| M3 | 事件 / inner instruction / 账户状态解码 | EP5 | done | 2026-10-12：离线日志栈、IDL C 布局、I80F48 与账户解码、精确对账及两个 CLI；32 笔/25 事件、7 账户与 Anchor 对照通过；四种实现突变捕获并还原。差值实测及归因限制见 D-011；未联网、发送交易或提交 git |
| M4 | 数据库与幂等入库、回填、游标 | EP6 | done | 离线 89 项测试 + 真实 Postgres/Helius devnet 验收(D-012):清库重跑 md5 一致、读回对账 issues=[]；真实环境另发现并修复 4 个问题 |
| M5 | API + 前端(含 X 光面板) | EP7 | done | 后端 + 前端已用真实 Postgres/devnet 数据联调并截图检查(浅/深色);联调另发现并修复 4 个问题,见 D-013 |
| M5a | 只读 API、预言机快照、labels、健康/利率/活动/X 光 | EP7 后端 | done | 2026-10-12:离线 PGlite / fixture / 无 socket HTTP 验证;四处源代码突变捕获并还原;2026-10-13 真实联调修复 4 处(D-013),契约新增 AccountStatus.unknown;104 项测试 |
| M7 | 钱包交互(构建/转发/钱包信息、水龙头、价格维护、前端钱包面板、e2e 脚本) | EP8(可选) | done | 真实 devnet + 浏览器联调通过;联调另发现并修复 6 处(D-015);132 项测试 |
| M6 | 按章节整理提交历史、打 tag、写 docs 与 video 分镜 | 全部 | done | 7 章读者文档(含片段展开脚本与检查)、7 份分镜、tag ep3-end…ep7-end;重跑验收通过;发现并修复干净检出下测试失败(D-014) |
| M7a | 钱包交易构建/转发、钱包信息、水龙头与价格维护 | EP8 后端 | done | 2026-10-13：离线 PGlite/fixture/假 RPC 验收；typecheck exit=0，129 项测试全过；四处源代码突变捕获并还原。真实 devnet/水龙头/keeper 待验证(D-015) |

## 已完成

- 2026-10-11:创建仓库骨架(AGENTS.md、docs、目录占位、docker-compose、001_raw_tx.sql)。

- 2026-10-11:`program/build.sh` 构建 marginfi 与 mocks 成功(带自有 program id 补丁)。

- 2026-10-11：实现 M1 固定步骤、默认离线计划、确定性账户、Switchboard v1 路径、Anchor 事件记录、expected 净流量与结束快照代码；离线检查覆盖公钥、计划入口、事件累加、真实 IDL 指令、EventParser 和 SDK 指令边界。未安装依赖、未提交 git、未发送交易。余额精度与计息限制见 D-009；链上验收尚未运行。

- 2026-10-11：最终 `pnpm typecheck` 退出码 0；`pnpm test` 14 项通过、0 失败、0 跳过。RPC / Crossbar 调用在相关测试中均由离线替身处理。bigint 原生绑定不可用，测试使用依赖自带的纯 JavaScript 回退，没有重装或重建依赖。

- 2026-10-11:M0、M1 完成。marginfi 与 mocks 已部署到 devnet;12 步剧本一次跑通,32 笔交易 finalized,五类借贷指令全覆盖。

- 2026-10-12:M4 完成并在真实 Postgres + Helius devnet 上验收(D-012)：离线测试之外另发现并修复 4 个只有真实环境才暴露的问题。

- 2026-10-13:M5 完成。真实 Postgres + devnet 数据 + 前端联调通过(页面截图检查,浅/深色);测试 104 项。

- 2026-10-13:M6 完成。重写 7 章读者文档,新增 `snapshot-docs` 脚本,写 7 份分镜,打章节 tag;`--run-id r4` 重跑验收通过(D-014)。

- 2026-10-13:M7 完成。钱包全流程在真实 devnet 上通过(脚本与浏览器两条路径);新增 `--follow`、`POOL_GROUP`、`check-ready`、录制清单、EP8 文档与分镜。

- 2026-10-14:价格自动保鲜(不依赖后台进程)、confirmed 乐观入库 + 终局清扫、SOL/tSOL/tUSDC 任意互换、界面静默刷新(D-016、D-017)。

- 2026-10-17:各章节与分镜跟上最终成果:EP1 按最终界面重写(五个 tab、三档上手路径、八集路线),EP2/3/6/7/8 补「后续增补」说明,EP1/3/7/8 分镜与录制清单更新。

- 2026-10-17:对外准备:项目改用 MIT 许可证(marginfi IDL 的 Apache-2.0 声明见 THIRD_PARTY_NOTICES.md);`ep8-end` 之后加的内容在章节中标为「后续增补」。测试偶发的 PGlite 原生崩溃(D-013/D-015)经用户决定暂不处理。

- 2026-10-17:全新 clone 实测"只需 RPC"的只读路径,修复回填失败、多池混杂、pSOL 无标签三处问题(D-022)。

- 2026-10-17:tSOL/tUSDC/pSOL 写入 Metaplex 链上元数据,图标托管在本仓库 assets/tokens(D-021)。

- 2026-10-17:前端加代币图标与说明,借贷池改为市场列表,兑换独立成页(参照 Aave/Jupiter);修复角标类名冲突、余额加载闪烁与钱包接口慢(D-020)。

- 2026-10-17:新增 Pyth 定价的 pSOL 银行(devnet 两个方向借款 + HTTP 端到端通过),兑换台改为按预言机定价并加入 pSOL,健康度按程序的价格区间计算(D-019)。

- 2026-10-17:前端改为四个 tab(借贷池 / 账户 / 链上活动 / 我来操作),新增代币参数卡与"存入/借出"直达;复查 Switchboard devnet oracle 仍离线(D-018)。

- 2026-10-22:前端改版为"devnet 可用的借贷产品"(D-023,任务板与每项审查记录见 `docs/frontend-revamp.md`;Codex 实现、Claude 审查)。资产详情页(右侧操作面板 + 签名前风险预览、历史曲线、本资产流水与清算明细)、我的仓位(总览 + 新手五步)、链上数据(活动 + 清算监控)、toast、中文钱包按钮;界面用"债务"不用"负债"。`/api/pool` 从约 1 秒降到毫秒级(跳跃扫描，不加缓存);快照写入去重。新增 pBTC/pETH/pHYPE(Pyth 实时价，`oracle_max_age = 900`)并在 devnet 端到端验证(D-024)。审查中修复了十余处 Codex 自测未发现的问题(逐项见任务板)。测试 229 项。
- 2026-10-22:项目改名"借贷市场"(D-025):GitHub 仓库与本地目录改为 `solana-lending-market`,文档/教程/分镜同步;派生种子保留旧字符串。兑换台改为逐资产降级(HYPE 推送断更 36 分钟时不再整表不可用,D-026)。HYPE 改为自有固定价 $80 的 tHYPE,后台 price-keeper 定时写链(D-027)。Helius 免费额度(devnet 也计费)下降低 RPC 用量:keeper 单笔批量、180 秒;汇率服务端缓存 15 秒、仅兑换页轮询;钱包一次批量读取(T11)。
- 2026-10-23:清理存量重复快照(27.8 万 → 2,227 行，整库 11 MB);索引进程跟随改为 15 秒、有新交易才快照(T12);部署准备:HOST/ALLOWED_ORIGINS/VITE_API_BASE、keeper 专用钱包、Dockerfile 与 compose、`docs/deploy.md`(T13)。

## 下一步

1. **录制视频**:先拍 EP2–EP7,最后拍 EP1;EP8 可选。分镜在 `video/`,清单在 `docs/recording-checklist.md`,开拍前跑 `scripts/check-ready.ts`。
2. 用真实 Phantom/Solflare 试一遍钱包交互(目前只用开发测试钱包验证过签名流程)。
3. ~~监控 Switchboard~~:Switchboard 已于 2026-09 整体关停,不会恢复(D-018)。真实价格已通过 pSOL 银行(Pyth)提供(D-019);待办:真实 Phantom 走一遍 pSOL 流程、长时间观察 Pyth devnet 更新节奏。
4. 已知待办:账户状态逐笔历史;压测与长时间运行;在真实分叉上验证终局清扫的删除路径。
5. 前端改版遗留(见 `docs/frontend-revamp.md`):把 `assets/tokens` 推到新仓库后更新链上元数据 URI;清理 `account_states` 存量重复快照(约 27.8 万行 → 2,200 行，会删数据，待作者确认);pBTC/pETH/pHYPE 的 Metaplex 元数据;真实 Phantom 走一遍新界面。

## M2 离线验收（2026-10-12）

- 新增任务指定的 8 个实现文件与对应离线测试；不新增依赖。README、模块清单及 EP4 代码片段引用已同步。
- `pnpm typecheck` 退出码 0；`pnpm test` 36 项通过、0 失败、0 跳过。测试专用 Anchor 及现有剧本测试的依赖提示 bigint 原生绑定不可用，使用纯 JavaScript 回退；未重建依赖。
- CLI 通过 `node --import tsx` 验证成功/缺参数/未知签名与任意当前目录；`pnpm exec node --import tsx scripts/decode-tx.ts <签名>` 实际运行成功。直接 `pnpm exec tsx ...` 因沙箱禁止本地 IPC 管道而在脚本执行前报 `listen EPERM`，该启动方式未验证成功。32 笔 fixture 的 18 条 marginfi 指令（11 类）与 Anchor 参数对照通过；全部步骤金标准、借款与清算账户角色/remaining 顺序通过。
- 没有联网、运行 `fetch-fixtures.ts` / `--execute`、部署、发送链上交易、启动数据库或提交 git。没有实现/验收 M3 的事件/账户解码或余额对账。
- 尚待真实样本验证：非空 v0 地址表、marginfi CPI，以及 fixture 未出现的 25 类指令参数。string / bytes / vec / 元组 / 有符号整数等通过合成测试，不把这些结果视为新增链上验证。


## M3 离线验收（2026-10-12）

- 实现事件调用栈（顶层下标/CPI 归属）、未知/失败/截断处理，Borsh f32/f64、IDL repr(C) 布局、四类账户严格长度解码、精确定点数及有理数对账。新增两个离线 CLI；README、模块清单、EP5 与 D-011 已同步；不新增依赖、不改 `scenario/expected.ts`。
- 任务描述 24 事件与实际 fixture 25 不一致；以完整 fixture 验证全部 25 条，不删除事件。七份账户所有字段与 Anchor 对照；两个 bank shares 四个逐位不变量及四个 active 组合的数量分子与 Anchor snapshot 完全一致。全部六个用户/池子组合保留流量差，非零差的精确分子、方向与量级有固定断言。
- 最终 `pnpm typecheck` 退出码 0；`pnpm test` 57 项通过、0 失败、0 跳过（退出码 0）。测试依赖的 bigint 原生绑定不可用，使用已有纯 JavaScript 回退，未安装或重建依赖。
- 临时实现突变：Bank asset_share_value 偏移 +8（4 项失败）、I80F48 经 Number（4 项失败）、移除失败交易屏蔽（1 项失败）、清算 39/38 比例改为 1（2 项失败）；针对性测试均退出 1，随后逐项还原。
- 实际运行两个 `pnpm exec node --import tsx` CLI 成功；子进程测试覆盖任意当前目录、缺参数、多参数、未知地址/类型。只读本地 fixtures，未使用直接 tsx 启动方式。
- 未联网、查询 RPC、运行 fetch-* / --execute、重跑剧本、构建/部署程序、发送交易、启动数据库或提交 git。失败/CPI/截断仅合成日志；其他事件/账户版本/枚举值、withdraw_all/破产/非零开仓费/Token-2022 费用未用真实样本验证。
- 不确定性：利息归因符合正向与上界，但没有中间账户快照，未精确拆出每笔利息/ceil/f64/定点截断的贡献；Carol 清算支出仍按名义 39/38 推算，没有逐位重演上游定点运算。精确验收对象是结束状态与 shares，不把事件净流量当真实余额。


## M4 离线验收（2026-10-12）

- 最终 `pnpm typecheck` 退出0；`pnpm test` 退出0，85项通过、0失败、0跳过；新增M4 28项。现有测试依赖提示bigint原生绑定不可用，沿用纯JavaScript回退，未安装或重建依赖。

- 已完整阅读指定文档、EP6和现有core/decoder/store。实现薄Db适配、事务SQL runner/002表、bigint JSON往返、签名幂等raw、版本解码/重建、owner/current-slot快照与原始字节保留、手写finalized RPC/重试脱敏、getBlock规范化、签名分页回填、slot事务游标、三个CLI及pnpm入口。README、各模块清单、EP6、D-012已同步；不新增依赖、不改版本。
- PGlite实测：32raw重复写入仍32；18instructions/25events与独立steps/events对照；重复解码、清库重跑、全量重建逐行相等；旧版本删除obsolete行且当前行不变；7账户数据库读回后的reconcile.issues=[]。slot中途/游标/解码事务错误均回滚并恢复。CLI共用syncStored实测自动解码与快照，排除失败初始化、报告关闭账户。
- pg仅用Pool最小替身测试bigint/字符串/OID和固定client的BEGIN/COMMIT/ROLLBACK/release。本机PGlite小BIGINT返回number、大值返回bigint，Db按OID统一字符串，含null断言。JSON按IDL恢复整数，25事件/7账户精确类型往返。
- 四种临时破坏突变均捕获：去掉ON CONFLICT、移除slot事务、同时漏清events全量和逐签名两处、去掉owner检查；各针对性测试退出1（1项失败）后还原。单独删全量events清理测试仍通过，因逐签名清理等效，此突变不计捕获。另临时DECODER_VERSION=2/旧行=1升级测试退出0，还原版本1。
- 未联网、调用真实RPC/Helius、运行剧本/部署/发送交易、启动Docker/Postgres或提交git。真实pg迁移、真实CLI正常采集/reindex、RPC重试/跳slot行为、历史保留、长时tail、并发/吞吐均未验收。CLI子进程只运行帮助和非法参数；正常编排由PGlite/假RPC执行。
- 不确定性：真实服务端/驱动集成仍待验证；当前账户快照不能冒充逐笔历史，关闭账户无墓碑，旧快照不证明当前存在。M3的利息/f64/ceil分摊未被M4消除。


## M5a 离线验收（2026-10-12）

- 最终 `pnpm typecheck` exit=0；`pnpm test` exit=0：102项通过、0失败、0跳过；M5a新增13项。依赖提示bigint原生绑定不可用，沿用已有纯JavaScript回退，未重装/重建依赖。

- 实现 PullFeed 精确解码、唯一偏移表、owner 白名单预言机快照与重建、labels 迁移/导入；API 提供池子/曲线/账户/活动/X 光/health 六个 GET 路由，不连 RPC；不改依赖和 src/api/types.ts。README、模块清单、EP7 与 D-013 已同步。
- 精确 bigint 原生数量对照两个 bank 与三位用户的 Anchor snapshots；tSOL 总存款 100、tUSDC 借款 0。Bob 清算前后 maint 与事件程序报告差 <1e-6。group 费用开关、非零精确利用率、合成未还债/healthy/缺价格/微量债务已测。
- 32 fixture 的18条顶层指令与独立 steps/event 对照；分页包含同slot同ix的签名平局及同slot多ix，无重漏。borrow/liquidate X 光原始字节、参数、base64日志与数据库行互相对照；全部fixture参数spans及变量参数/合成v0 inner已测。
- 四次临时实现突变均捕获并还原：maint资产权重换init（1项失败）、漏固定APR费（1项失败）、status判断反向（1项失败）、spans少最后IDL字段（2项失败）；针对测试均exit=1。
- 一次全套重跑在 `src/api/queries.test.ts` 第三项前原生崩溃：Node v24.10.0 / V8 `Check failed: end > addr`，栈位于 WebAssembly JIT 页释放；该轮101通过、1个文件失败。单独复跑queries三项通过。未改依赖/测试启动参数；崩溃原因未确定，不把复跑成功视为已修复原生问题。
- 新CLI只实际运行帮助/非法参数；route/handle使用无socket替身，PGlite验证SQL。没有联网、调用真实RPC、发送交易、重跑剧本、构建部署、启动Docker/Postgres、API监听或浏览器/前端联调，没有git提交。
- 不确定性与契约异议：缺价格状态借用liquidatable（health=null，不证明可清算）；利用率显示裁剪；number健康只验证容差；快照混合slot、无新鲜度/关闭墓碑/并发一致性保证；通用上游风险规则未重演。详见D-013。


## M7a 离线验收（2026-10-13）

- 实现 POST /api/build、POST /api/send、GET /api/wallet/:pubkey，包含 v0/400k CU/confirmed blockhash、首次 marginfi Keypair 部分签名、精确金额摘要、操作后槽位 remaining、实时 feed 半窗新鲜度与模拟错误中文翻译。API 不加载管理员密钥；无 RPC 配置时钱包路由 503，原只读路由保持可用。
- 转发检查 Ed25519 required signatures、payer、marginfi 指令与1232字节；只接受无 ALT 的 v0；同字节重播、confirmed/finalized 状态、60秒含挂起 RPC 的截止与重复提交幂等。HTTP 流式 JSON 限64KB、POST CORS、不回显底层异常/任意程序日志。
- 独立水龙头使用专用钱包转已有 tUSDC/tSOL，不铸币；内存纯限流、原子 ATA 创建/转账、503余额不足。独立 setup 构造管理员 SOL/铸币指令，keeper 共用 mock-feed 精确18位价格编码与公开feed signer；当前链上时间刷新，失败继续、连续5次退出。新增配置说明、EP8、模块清单与 D-015；API 契约和依赖均未修改。
- 最终 pnpm typecheck exit=0；pnpm test exit=0：129项通过、0失败、0跳过。新增21项 M7a测试；原有测试均通过。git diff --check通过；snapshot-docs展开了1个受resultRegion签名影响的EP3片段，最后21片段检查均无过期/失败。
- 首轮全套测试发生已有 Node24.10.0/V8/PGlite WebAssembly 原生崩溃(Check failed: end > addr，src/store/migrate.test.ts)：124通过、1文件失败；最后原命令完整复跑通过。没有更换Node、依赖或改测试启动参数，根因仍未知，不声称已修复。bigint原生绑定不可用，沿用纯JS回退。
- 四次临时源代码突变均各1项失败、exit=1后还原：remaining逆序(角色/remaining金标准不同)；首次deposit漏init(一次性账户变成非signer，签名阶段失败)；删除PriceStale判断(缺少预期409拒绝)；删除marginfi守卫(任意非marginfi交易未拒绝)。它们与坏输入测试区分记录。
- 没有联网、发送链上交易、重跑剧本、部署、提交git、生成持久密钥文件、启动Docker/Postgres/socket或前端联调。正常setup/水龙头/keeper/set-price路径没有实际运行；真实devnet模拟、真实转账、真实keeper写入、钱包兼容、长期/负载/多进程限流均待验证。CLI只实际运行help与非法参数，编排只用假RPC。
- 不确定性：indexer新账户发现延迟、关闭账户无墓碑、混slot/旧bank配置、keeper与改价并发覆盖；上游SwitchboardPull的oracle_max_age=0与任务240秒fallback有差异。timeout可能稍后落链。契约异议(未改)：HTTP错误体无共享类型；SendRequest缺过期高度；all时amount仍必填但忽略；密钥注释未区分水龙头/管理员独立进程。细节见D-015。

## 本机工具链核查（2026-10-17）

- 只读核查 `rclaude`：本机 SSH 启动 VPS Claude，VPS 经 Tailscale SSH 回连 Mac 的 `claude mcp serve`，文件和命令工具在 Mac 执行；回连实测返回 Darwin 与当前项目路径。未修改中转配置或项目代码。发现多个 PPID=1 的 MCP 服务进程，是否为残留待验证；工具可访问范围未按项目目录做系统级隔离。

## 前端改版 T1（2026-10-22）

- 完成市场资产详情 hash 路由与页面，市场行和存入/借出按钮进入详情；添加详情 KPI、存借信息、抵押参数、利率曲线、说明和 T3 占位面板。状态为 review。
- `pnpm typecheck && pnpm test` 通过（174 项），`cd web && pnpm typecheck` 通过。浏览器验收因 Vite 监听本地端口返回 `listen EPERM` 未完成，窄屏实际溢出待确认。
