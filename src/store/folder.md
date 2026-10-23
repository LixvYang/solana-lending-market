# src/store

EP6：原始事实存储、派生解码与当前状态快照。

| 文件 | 角色 | 功能 |
|---|---|---|
| accounts.test.ts | 测试 | context.slot、owner、变化去重、游标前进、raw快照重建与数据库对账 |
| accounts.ts | 运行时 | 协议/预言机 owner 校验、按 data 去重的 context.slot 快照、最近采样游标 |
| db.test.ts | 测试 | 两侧 bigint 与事务连接/回滚 |
| db.ts | 运行时 | pg/PGlite 薄适配、SQL BIGINT 统一字符串、事务 |
| decode.test.ts | 测试 | fixture幂等、独立计数、清库重跑、升级、错误事务 |
| decode.ts | 运行时 | 版本重放与事务重建指令/事件/账户 |
| involved.ts | 运行时 | 协议账户角色与最新 Bank oracle 地址 |
| json.test.ts | 测试 | u64/i128与事件/账户按IDL精确往返 |
| json.ts | 运行时 | bigint 十进制 JSONB 与按 IDL 无损恢复 |
| migrate.test.ts | 测试 | 重复迁移、表索引、失败DDL回滚 |
| migrate.ts | 运行时 | 按文件事务迁移与应用记录 |
| raw.ts | 运行时 | 先存原始、签名幂等插入 |
| sync.ts | 编排 | CLI 共用解码后协议/预言机快照；缺失账户报告并跳过 |
| sync.test.ts | 测试 | 编排实测、失败初始化排除和已关闭账户 |
| migrations/ | SQL | 原始事实及可重建派生表 |

| labels.ts | 链下元数据 | 从剧本地址幂等导入符号与昵称 |
| oracles.test.ts | 测试 | owner 白名单、预言机快照、重建和标签 upsert |

SYNC: 增删文件或修改职责时同步本表和文件头部。
