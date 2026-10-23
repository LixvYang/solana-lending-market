# src/faucet

独立进程的专用钱包仅转已有代币；管理员补充逻辑只供 setup 工具使用。限流在内存中，重启清零。

| 文件 | 角色 | 功能 |
|---|---|---|
| limit.ts | 纯函数 | 钱包/IP/UTC 日配额与下一次时间 |
| config.ts | 配置 | 默认数量、环境变量与精确十进制 |
| service.ts | 转账 | 余额检查、幂等 ATA、专用钱包签名 |
| server.ts | HTTP | 独立 /faucet、429/503 与 socket IP |
| setup.ts | 管理员构造 | SOL 转账与 mint-to，仅一次性 CLI 导入 |
| faucet.test.ts | 测试 | 三种限流、准确转账/ATA、余额不足与 setup 指令、可选 Pyth grant |
| swap.ts | 兑换 | 原子兑换报价/转发;单价每次报价时由 PriceReader 读取 |
| prices.ts | 定价 | 价格账户字节 → USD×1e6;Pyth 查校验级别与年龄 |
| swap.test.ts / prices.test.ts | 测试 | 七种资产两两兑换、Pyth feed 取价、随价格变化、过期/零价拒绝 |

SYNC: 修改实现时同步本表、文件头部、README 与 EP8 文档。
