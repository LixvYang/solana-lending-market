# Devnet 部署

部署拓扑：Vercel 提供静态前端；一台常驻主机运行 API、测试币水龙头/兑换台、price-keeper 与 ingest；Postgres 使用 Supabase。所有链上交互仍在 devnet。

## Vercel 前端

在 Vercel 导入仓库，项目根目录保持仓库根目录。仓库根目录的 `vercel.json` 构建 `web/` 并发布 `web/dist`；`web/vercel.json` 保留同一组前端构建设置，供从 web 目录运行的 Vercel CLI 使用。设置构建环境变量 `VITE_API_BASE=https://api.example.com`，值为 API 的 HTTPS 公网根地址，不带 `/api`。这是构建时注入：静态前端无法在运行时读取 Vercel 环境变量，故 API 地址由 Vite 编译进请求地址，而不是依赖 Vercel rewrite。

API 主机需提供 HTTPS(可由 Caddy/Nginx 等反向代理终止 TLS)，否则浏览器会阻止 HTTPS 页面请求 HTTP API。反向代理把 `/api/*` 转发至 `127.0.0.1:8787`，把 `/faucet` 与 `/swap/*` 转发至 `127.0.0.1:8788`。API 的 `ALLOWED_ORIGINS` 填入 Vercel 生产域名及需要使用的 Preview 域名，逗号分隔。前端从 `/api/config` 继续读取水龙头/兑换台的公网地址。

## Supabase 与常驻主机

在 Supabase 建立 Postgres 数据库，复制要求 SSL 的连接 URI 到主机 `.env` 的 `DATABASE_URL`。Supabase 数据库不在 Docker Compose 中。主机安装 Docker Compose，clone 仓库后复制 `.env.example` 为 `.env`，填入真实值。部署者钱包只用于部署/管理操作，不要复制到服务主机。

创建两只专用钱包，并将密钥 JSON 数组文件放在主机仅管理员可读的目录。Compose 以只读文件卷分别挂到水龙头和 keeper 容器；环境变量 `FAUCET_KEYPAIR_FILE`、`KEEPER_KEYPAIR_FILE` 填主机上的文件路径。水龙头钱包持有测试币库存，keeper 钱包只付价格更新手续费。keeper 通过公开确定性 feed signer 作为价格账户的授权签名者，不需要管理员权限。API 和 ingest 不加载私钥。

最低余额是启动建议，不是协议常量，实际交易费用和账户租金可能变化：

- 水龙头/兑换台：至少 0.1 SOL 做运营缓冲，并备足准备发放的测试币。用户付 ATA 创建租金与兑换交易手续费；兑换台需保留约 0.05 SOL，不把全部 SOL 换出。
- keeper：至少 0.02 SOL 作为多轮价格更新的手续费余额；不够时补充此专用钱包。
- API、ingest：不需要 SOL 钱包。用户自己的 Solana 钱包需要 SOL 支付交易费与首次创建代币账户的租金。
- 管理员钱包不放在服务器上。若要新建/升级程序或管理银行，单独在可信环境使用 `ANCHOR_WALLET`，本部署服务不需要它。

先建镜像并迁移数据库，再进行一次全量回填：

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml run --rm api node --import tsx scripts/migrate.ts
docker compose -f docker-compose.prod.yml run --rm api node --import tsx scripts/ingest.ts --backfill
docker compose -f docker-compose.prod.yml up -d
```

Compose 启动后，API 在 8787、兑换台/水龙头在 8788 监听；生产环境应由反向代理转发并提供 HTTPS。`.env` 至少设置 `RPC_URL`、`DATABASE_URL`、`FAUCET_URL`(例如 `https://api.example.com/faucet`)、`ALLOWED_ORIGINS`、`FAUCET_KEYPAIR_FILE` 与 `KEEPER_KEYPAIR_FILE`。API/水龙头在容器内监听 `0.0.0.0`；本地启动仍默认只监听 `127.0.0.1`。

日常检查可用 `docker compose -f docker-compose.prod.yml ps`、`docker compose -f docker-compose.prod.yml logs -f api faucet keeper ingest`；API 与兑换台健康检查分别是 `/api/health`、`/health`。首次回填只需执行一次；后续 ingest 服务以 `--follow` 常驻跟随新交易。

## RPC 预算

按 T11/T12 的轮询设置估算：ingest 默认每 15 秒查询新签名约 8.64 万次/月；每 5 分钟兜底快照约 1.7 万次/月，合计约 10.4 万次/月，另加新交易时的解码/快照与终局清扫。price-keeper 每 180 秒一轮，约 14,400 轮/月；按每轮约 4 次读写 RPC 粗估约 5.8 万次/月。两项合计约 16.2 万次/月，另外还有水龙头/兑换、API 钱包查询与用户交易。Helius 计量单位与 RPC 方法成本不同，这只是请求数预算；请在实际部署后以提供商用量面板核对。
