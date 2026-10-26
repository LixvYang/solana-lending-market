# 借贷市场 (`solana-lending-market`)

在 Solana devnet 上部署 marginfi,做一个能真实存借的借贷市场;从部署协议、造数据、解析链上数据、存储到前端,全部自己实现。

用 marginfi(mrgn-0.1.0)当样本,演示 **Solana 链上数据如何一步步变成数据库里的行,再变成网页上的数字**。配套 B 站合集视频(7 集 + 可选的第 8 集)。

> 状态:**主线 M0–M5 已完成并在真实 devnet 上验收**(见 [docs/progress.md](docs/progress.md))。视频与分镜([video/](video/))待录制。

**在线体验:<https://solana-lending-market.vercel.app>**(devnet,测试币没有真实价值)。连接 devnet 钱包后可领测试币、存借、兑换。部署方式见 [docs/deploy.md](docs/deploy.md#vercel--supabase-全免费部署),链上地址见 [docs/addresses.md](docs/addresses.md)。

文档同步约定：功能与架构变动同时更新 README、相关 folder.md 和源码 INPUT/OUTPUT/POSITION 注释。

## 你会得到什么

- 一个**真实部署在 devnet 的借贷池**,和一段可重复的借贷剧本(存款、借款、改价、清算、还款)。
- 一条**手写的解析流水线**:指令(Borsh)、事件(日志)、账户状态(`zero_copy` 布局 + I80F48 定点数),全部带测试,并用 Anchor 官方 coder 交叉校验。
- **幂等、可回填、可重放**的 Postgres 存储:清库重跑,解码表的 md5 完全一致。
- 一个**API 和前端**,其中的"交易详情"能并排看到一笔交易的原始字节、解码结果、数据库行。
- 资产详情页按银行状态变化展示利用率、APR 与总量的阶梯历史曲线;API 保留每次采样 slot,相同账户内容不重复写入。
- **钱包交互**(可选的第 8 集):连接 devnet 钱包,对借贷池存款、取款、借款、还款;有水龙头、SOL 与测试币任意互换的兑换台(按预言机价格成交),以及端到端验收脚本。价格由交易自动保鲜,不依赖后台进程。
- **Pyth 实时行情资产**:pSOL、pBTC、pETH 已接入;HYPE 银行使用我们固定为 $80 的价格,由后台定时写入。网页为代币提供图标与说明。

## ⚠️ 先说清楚:价格从哪来

- **tSOL / tUSDC 是"布局一致的 mock"。** 剧本要能把价格打低来演示清算,真实行情做不到;而且 Switchboard 已于 2026-09 整体关停([D-018](docs/decisions.md))。所以价格由我们写入一个**与真实 Switchboard 价格账户字节布局完全一致**的账户,marginfi 走的仍是读取 Switchboard 价格的那条代码路径。详见 [EP3](docs/chapters/ep03-protocol-and-scenario.md) 与 [D-008 / D-009](docs/decisions.md)。
- **Pyth 银行使用真实行情:** 价格来自 Pyth devnet 对应的 USD feed。pBTC/pETH 是测试币;HYPE 是我们定价的测试币。

**除价格来源外,其余全部是真实的链上行为。**

## 章节

| 集 | 主题 | 文档 | 分镜 | 代码检查点 |
|---|---|---|---|---|
| EP1 | 成品演示 | [ep01](docs/chapters/ep01-demo.md) | [script](video/ep01-script.md) | `main`(展示最终成果,最后拍) |
| EP2 | Solana 数据地图 | [ep02](docs/chapters/ep02-data-map.md)、[速查图](docs/cheatsheet.md) | [script](video/ep02-script.md) | —(概念,无代码) |
| EP3 | 看懂借贷协议,造出链上数据 | [ep03](docs/chapters/ep03-protocol-and-scenario.md) | [script](video/ep03-script.md) | `ep3-end` |
| EP4 | 解析指令 | [ep04](docs/chapters/ep04-instructions.md) | [script](video/ep04-script.md) | `ep4-end` |
| EP5 | 解析事件与账户状态 | [ep05](docs/chapters/ep05-events-and-accounts.md) | [script](video/ep05-script.md) | `ep5-end` |
| EP6 | 存储设计 | [ep06](docs/chapters/ep06-storage.md) | [script](video/ep06-script.md) | `ep6-end` |
| EP7 | 前端与总结 | [ep07](docs/chapters/ep07-frontend.md) | [script](video/ep07-script.md) | `ep7-end` |
| EP8(可选) | 钱包交互 | [ep08](docs/chapters/ep08-wallet.md) | [script](video/ep08-script.md) | `ep8-end` |

从 EP3 起每一集一个 git tag,`git checkout ep4-end` 就是第 4 集结束时的代码。历史是线性的:各集的提交按顺序排列,没有重写。

`ep8-end` 之后的改进(兑换台、价格自动保鲜与 confirmed 入库、Pyth 定价的 pSOL 银行、界面改版、代币链上元数据)只在 `main` 上,章节里对应位置标为 **「后续增补」**,并写明对应的决策编号;想看这些就用 `main`。

## 快速开始

所有链上地址(程序、借贷池、各资产的 mint/银行/价格账户、需要补充 SOL 的运维钱包)见 [docs/addresses.md](docs/addresses.md)。

需要 Node 24、pnpm、Docker、Solana CLI 2.1.20。

**只看解码(不需要网络、数据库、钱包):**

```bash
pnpm install
pnpm typecheck && pnpm test      # 全部离线,约 20 秒;数据库用进程内的 PGlite
pnpm exec tsx scripts/decode-tx.ts 4FRUHaLGRdvAcV88XtTgCUGE76oAE1tKFqL5dEodxsmJhUgshUnEnkxKXEdn3q2r2XFRPTMihAfgsUQpuMhQivjt
```

**接入作者在 devnet 上的部署(只需要一个 RPC 地址,不用构建、部署、也不用钱包):**

```bash
cp .env.example .env                       # 只填 RPC_URL(例如 Helius 免费的 devnet 地址)
docker compose up -d                       # Postgres,端口 5433
pnpm exec tsx scripts/migrate.ts
pnpm exec tsx scripts/ingest.ts --backfill # 回填作者部署的全部交易并解码、快照
pnpm exec tsx scripts/load-labels.ts
pnpm exec tsx scripts/verify-db.ts         # 读回对账
pnpm exec tsx scripts/serve-api.ts &       # 默认展示作者的池子(program/devnet.json)
(cd web && pnpm install && pnpm dev)       # http://localhost:5173
```

程序与池子的公开地址记在 [program/devnet.json](program/devnet.json)。钱包交互(存借、兑换)还需要水龙头/兑换台的专用钱包,见 EP8。

**完整跑一遍:自己构建、部署、跑剧本(需要 devnet RPC 与有 SOL 的钱包):**

```bash
cp .env.example .env                       # 填 RPC_URL、ANCHOR_WALLET
docker compose up -d                       # Postgres,端口 5433
./program/build.sh                         # 构建 marginfi 与 mocks
pnpm scenario                              # 只打印计划;加 --execute 才在 devnet 发交易(约 0.3 SOL)
pnpm exec tsx scripts/migrate.ts
pnpm exec tsx scripts/ingest.ts --backfill
pnpm exec tsx scripts/load-labels.ts
pnpm exec tsx scripts/verify-db.ts         # 读回对账 + 解码表 md5
pnpm exec tsx scripts/serve-api.ts &       # 数据库里有多个池子时设 POOL_GROUP
FAUCET_KEYPAIR=… pnpm exec tsx scripts/add-pyth-bank.ts   # 默认 pSOL;也可用 --symbol pBTC/pETH 新增 Pyth 银行
pnpm exec tsx scripts/fix-hype-oracle.ts                  # 将已部署 HYPE 银行切换为 tHYPE 固定 mock 价($80)
(cd web && pnpm install && pnpm dev)       # http://localhost:5173
```

更多命令见 [AGENTS.md](AGENTS.md)。

钱包后端 M7a 已实现，当前仅离线验收：构建/转发/钱包信息、水龙头与价格维护的配置见 [EP8 后端说明](docs/chapters/ep08-wallet-backend.md)。`src/api/types.ts` 为前后端固定契约。API 不读取管理员密钥；`RPC_URL` 未设置时原有只读路由继续工作，钱包路由返回 503。

## 许可证

[MIT](LICENSE)。入库的 marginfi IDL 来自上游(Apache-2.0),见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 局限

- **价格大多是 mock**:tSOL/tUSDC/tHYPE 用我们写入的价格(清算演示需要按需改价);pSOL/pBTC/pETH 使用 Pyth devnet 实时行情。
- **回填只入库 finalized**;实时跟随(`--follow`)按 confirmed 乐观入库,再由终局清扫确认或删除被丢弃分叉上的交易(见 EP8)。
- **账户状态历史受采样记录限制**;资产曲线只展示我们采集到的状态变化与可匹配的历史价格。
- **只解码剧本涉及的指令**,其余原样存为 `unknown`。
- **`tail` 追不动历史**(逐 slot 一次请求),追赶请用 `--backfill`。
- **钱包交互仅限 devnet 测试币**,水龙头限流在内存里,没有真正的防刷(见 EP8)。
- 文档里的数字对应第一次运行(见 [D-014](docs/decisions.md));之后为验收重跑过几次,现在重新回填会得到更多行。
- 没有压测,没有长时间运行测试,没有在别的协议上验证过"换 IDL 即可"。

## 目录

```
docs/        读者文档(chapters/)、目标/进度/决策记录
video/       分镜脚本
program/     marginfi 固定版本的构建与部署脚本(上游源码不入库)
scenario/    确定性剧本
fixtures/    真实运行的原始数据(解码器的金标准)
src/         core(字节工具)、decoder、ingest、store、api
web/         前端(Vite + React),含钱包交互
scripts/     CLI 与文档片段展开(snapshot-docs)
```

## 许可

上游 marginfi-v2 为 Apache-2.0。本项目许可证待定。
