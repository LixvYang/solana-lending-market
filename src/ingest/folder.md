# src/ingest

EP6：只读取 finalized 的链上数据，不签名、不发送交易。

| 文件 | 角色 | 功能 |
|---|---|---|
| block.test.ts | 测试 | fixture 等形、合成 inner/v0、skipped/null |
| block.ts | 运行时 | 顶层/CPI/v0 调用过滤与 getTransaction 规范化 |
| cli.test.ts | 测试 | 模式参数与任意cwd的帮助/错误入口 |
| rpc.test.ts | 测试 | finalized 参数、离线重试、错误脱敏 |
| rpc.ts | 运行时 | 手写 finalized RPC、重试退避、超时和 key 脱敏 |
| signatures.test.ts | 测试 | 分页、跳过已知、失败/null交易 |
| signatures.ts | 运行时 | 签名分页到头、跳过已入库与失败交易保留 |
| tail.test.ts | 测试 | 中途崩溃与游标失败回滚、重跑/skipped |
| tail.ts | 运行时 | 每 slot 的 raw_tx 与 blocks 游标原子提交 |
| vercel-sync.ts | Vercel 跟随 | 30 秒节流、60 秒原子租约与快照时间持久化 |

SYNC: 增删文件或修改职责时同步本表和文件头部。
