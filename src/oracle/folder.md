# oracle

价格账户的地址与写入规则,构建器、索引器、管理脚本共用。不做网络请求。

| 文件 | 角色 | 功能 |
|---|---|---|
| mock-write.ts | mock | mocks 程序 write 指令、只刷新时间戳、公开派生的价格账户密钥 |
| mock-write.test.ts | 测试 | 默认签名者识别 tSOL/tUSDC/tHYPE mock feed |
| pyth.ts | Pyth | SOL/BTC/ETH feed、赞助价格账户 PDA、feed id ↔ oracle_keys |
| pyth-banks.ts | 配置 | Pyth 银行精度、更新年龄、水龙头数量与确定性种子规则 |
| hype.ts | 配置 | 已部署 HYPE 银行的旧种子、tHYPE 价格与迁移参数解析 |
| pyth.test.ts | 测试 | 三种 Pyth feed PDA、真实 pSOL 银行换算、Switchboard/空配置 |
| pyth-banks.test.ts | 测试 | 银行参数、pSOL 种子兼容、CLI 参数解析 |

SYNC: 增删文件或改变职责时更新此表与文件头部。
