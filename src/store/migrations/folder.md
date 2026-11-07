# store/migrations

按文件名排序应用；每个 SQL 文件及其迁移记录一起提交。

| 文件 | 角色 | 功能 |
|---|---|---|
| 001_raw_tx.sql | 事实 schema | 原始交易及 blocks 游标 |
| 002_decoded.sql | 派生 schema | 解码版本、指令/事件/账户快照、查询索引 |

| 003_labels.sql | 元数据 schema | 链下地址标签，不猜测链上代币名称 |
| 005_desk_events.sql | 兑换台历史 | 已确认兑换与水龙头发放，不经 marginfi 解码 |
| 006_vercel_runtime.sql | Vercel 运行状态 | 按需同步租约与跨实例水龙头预留 |

SYNC: 更改 schema 时同步此表、EP6/EP7 与 D-012/D-013。
