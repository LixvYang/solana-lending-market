# core

读取原始字节、精确计算定点数和有理数。不依赖 Anchor、RPC 客户端或网络。

| 文件 | 角色 | 功能 |
|---|---|---|
| base58.ts | 字节工具 | 手写 base58 编码/解码，保留前导零 |
| reader.ts | 字节工具 | 顺序读取小端整数、bool、pubkey、字节、字符串 |
| base58.test.ts | 测试 | 已知向量、前导零与非法字符 |
| reader.test.ts | 测试 | 位宽、二补码、长度前缀与越界 |

| fixed.ts | 金额 | I80F48 二补码、精确十进制与 2^48 有理数 |
| fixed.test.ts | 测试 | 符号、48 位小数、超过 Number 精度与 i128 边界 |
| rational.ts | 计算 | bigint 分数、f64 位模式/半 ULP、截断显示 |
| rational.test.ts | 测试 | IEEE754 已知向量、次正规数、算术与显示 |
| worker-health.ts | 运行时 | worker 成功轮次健康状态与可选 HTTP 探针 |

SYNC: 增删文件或改变职责时更新此表与文件头部。
