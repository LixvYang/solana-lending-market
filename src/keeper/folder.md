# src/keeper

读取 mock feed 的当前精确价格，复用剧本编码，仅刷新链上时间与 slot。管理员密钥只由脚本读取。

| 文件 | 角色 | 功能 |
|---|---|---|
| price.ts | 价格构造 | owner/布局检查、链上时间、公开 feed 签名者；后台刷新 tUSDC/tSOL/tHYPE |
| loop.ts | 调度 | 失败继续、成功重置、连续五次失败退出 |
| price.test.ts | 测试 | tHYPE 刷新名单与 18 位价格/时间/slot 构造 |
| keeper.test.ts | 测试 | 18 位价格不变、时间/slot 更新与 RPC 失败恢复 |

SYNC: 修改实现时同步本表、文件头部、README 与 EP8 文档。
