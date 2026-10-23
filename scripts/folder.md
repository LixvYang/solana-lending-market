# scripts

开发与视频演示的命令行入口。是否访问网络由各脚本职责决定。

| 文件 | 角色 | 功能 |
|---|---|---|
| decode-tx.ts | 离线演示 | 从固定 fixture 按签名打印解码 JSON，不调用 RPC |
| fetch-fixtures.ts | 数据采集 | 从 RPC 下载原始交易，本次任务未运行 |
| transfer-sol.ts | 链上操作 | SOL 转账工具，本次任务未运行 |

| decode-account.ts | 离线演示 | 从固定账户 fixture 打印字段、原始定点字节与 decimal |
| print-layout.ts | 离线演示 | 计算 IDL C 布局，显示 offset/align/padding |
| fetch-accounts.ts | 数据采集 | 下载账户原始字节，本次任务未运行 |

| migrate.ts | 存储入口 | DATABASE_URL 与本地 SQL 迁移 |
| start.ts / service.ts | 容器入口 | SERVICE 校验、迁移/检查与 api/faucet/keeper/ingest 单一启动入口 |
| ingest.ts | 只读采集 | 回填/tail/once/from，自动解码和 owner 快照 |
| reindex.ts | 重放 | raw_tx/保留原始字节的账户派生结果重建，无 RPC |
| ingest-options.ts | 参数 | 无副作用验证模式、once、from |
| store-command.ts | 生命周期 | pg 连接关闭、迁移路径、错误退出 |

| load-labels.ts | 元数据入口 | 迁移后导入本地剧本标签，无 RPC |
| serve-api.ts | API 服务 | 默认 8787；可选 RPC 支持钱包；无 RPC 时只读可用，钱包路由 503 |

| faucet.ts | 专用钱包服务 | 默认 8788、转账、内存限流、数据库健康检查；只读专用密钥 |
| faucet-setup.ts | 管理员工具 | 创建专用钱包、转 SOL 与铸币，--top-up 补充（本次未运行正常路径） |
| price-keeper.ts | 管理员工具 | 默认 180 秒保持当前价格、更新时间，worker 健康端口、连续 5 次失败退出 |
| set-price.ts | 管理员工具 | 精确 18 位价格改价（本次未运行正常路径） |
| add-pyth-bank.ts | 管理员工具 | 幂等:按符号新增 pSOL/pBTC/pETH 的 Pyth 银行、预置水龙头库存、写标签 |
| fix-hype-oracle.ts | 管理员工具 | 幂等:将已部署 HYPE 银行改为 tHYPE mock 价格并写链下标签 |
| verify-pyth-bank.ts | 链上验收 | 直接调程序:存 pSOL 借 tUSDC、存 tUSDC 借 pSOL |
| e2e-pyth.ts | 链上验收 | 经 HTTP:SOL 换 pSOL/pBTC/pETH、存、借、还清、取出 |
| token-metadata.ts | 管理员工具 | 幂等:tSOL/tUSDC/pSOL 的 Metaplex 元数据,URI 指向 assets/tokens |
| admin-runtime.ts | CLI 共用 | 显式读钥与签名发送；服务支持环境密钥或 keypair 路径 |
| wallet-cli.test.ts | 离线测试 | 新脚本 help/非法参数，不加载密钥或联网 |

SYNC: 增删脚本或改变职责时更新此表与文件头部。
