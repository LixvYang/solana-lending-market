# AGENTS.md

本项目对外名称是**借贷市场**(`solana-lending-market`):在 Solana devnet 上部署 marginfi,做一个能真实存借的借贷市场;从部署协议、造数据、解析链上数据、存储到前端,全部自己实现。项目配合 B 站合集视频教学。

目标与进度见 `docs/00-goals.md`、`docs/progress.md`,决策记录见 `docs/decisions.md`。**开始工作前先读这三个文件,结束工作时更新 `docs/progress.md`。**

## 目录

```
docs/        教程文字(给读者)+ 目标/进度/决策
video/       分镜脚本(给作者自己)
program/     marginfi 固定版本的构建与部署脚本(上游源码不入库)
scenario/    确定性剧本:造代币、mock 价格、存/借/清算
fixtures/    剧本交易的原始 getBlock JSON(解码器的金标准数据)
src/core     rpc 封装、字节读取器、类型
src/decoder  指令/事件/账户解码(EP4、EP5)
src/ingest   取块、回填、实时订阅、游标
src/store    迁移 SQL 与写入层(EP6)
src/api      只读接口
web/         前端(EP7)
scripts/     重放、清库、文档片段展开
```

## 约定

- **一份最终代码,不按章节复制目录。** 模块边界即章节边界;章节检查点用 git tag / 分支表示,按章节顺序整理提交历史。
- **先存原始,再解码。** `ingest` 只写 `raw_tx`;`decoder` 是纯函数,可对 `raw_tx` 重放。
- **未知 discriminator 不抛错**,原样入库为 `unknown`。
- 代码写给人读:一文件一概念,单文件尽量不超过约 150 行;注释讲"这些字节是什么、为什么",不讲"这行做了什么";不做抽象层与依赖注入。
- 教学片段用区域标记,文档通过标记引用,不手贴代码:`// #region ep4-discriminator` … `// #endregion`。
- 依赖版本全部固定(不用 `^`、`latest`)。
- 未核实的事实在文档里标注"待验证",核实后写入 `docs/decisions.md`。
- 不提交私钥与 `.env`。剧本账户由固定字符串确定性派生,不落盘密钥文件。

## 常用命令

```bash
pnpm typecheck && pnpm test                          # 离线，约 20 秒，不需要数据库/网络(数据库用进程内 PGlite)
docker compose up -d                                 # 真实 Postgres，端口 5433
pnpm exec tsx scripts/migrate.ts                     # 迁移(幂等)
pnpm exec tsx scripts/ingest.ts --backfill           # 按签名回填该程序的全部交易，并解码、快照
pnpm exec tsx scripts/ingest.ts --tail --from S --to E   # 扫一段 slot；不带 --to 则持续跟随
pnpm exec tsx scripts/reindex.ts                     # 只由 raw_tx 重建解码表(无网络)
pnpm exec tsx scripts/verify-db.ts                   # 读回对账 + 解码表 md5
pnpm exec tsx scripts/add-pyth-bank.ts               # 幂等:pSOL 银行(Pyth 定价);verify-pyth-bank / e2e-pyth 是链上验收
pnpm scenario                                        # 打印剧本计划；加 --execute 才在 devnet 发交易(--run-id X 用新 group 重放)
pnpm exec tsx scripts/serve-api.ts                   # 只读 API,端口 8787
(cd web && pnpm dev)                                 # 前端,端口 5173,代理 /api;?mock 可在没有 API 时预览
pnpm exec tsx scripts/snapshot-docs.ts [--check]     # 展开/检查章节文档里的 {{ snippet 路径#区域 }}
```
需要 `.env`:`RPC_URL`(Helius devnet)、`ANCHOR_WALLET`；`DATABASE_URL` 默认 `postgres://indexer:indexer@localhost:5433/indexer`。

## Skills

Solana 相关 skills 放在 `.agents/skills/<name>/SKILL.md`;`.claude/skills` 是指向它的软链接,Claude Code 与其他代理共用同一份。用法见 `.agents/README.md`。
