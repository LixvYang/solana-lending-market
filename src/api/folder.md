# src/api

EP7 只读数据库视图与 M7 钱包构建/转发/查询。只读路由只读 Db；钱包路由使用注入 RPC，不持有管理员密钥。确认后的 marginfi 交易会乐观入库并刷新相关账户。
价格来自已入库的价格账户(Switchboard 布局的 mock 或 Pyth PriceUpdateV2)，标签来自链下 labels。

| 文件 | 角色 | 功能 |
|---|---|---|
| types.ts | 契约 | 与前端共享的 JSON 类型，含银行历史变化点 |
| math.ts | 纯函数 | shares 精确乘法/取整、APR、USD 与 init/maint 健康度 |
| state.ts | 读取 | 最新状态、IDL bigint 恢复、标签与时间边界 |
| bank.ts | 池子 | 权重、group 费用缓存、价格(按银行换算价格账户)与 USD 汇总 |
| oracle-price.ts | 价格 | 两种价格账户统一成 FeedData;健康度用的开仓/维持价格区间 |
| queries.ts | 入口 | 池子、利率曲线、账户与历史查询；导出活动/X 光查询 |
| bank-history.ts | 历史 | 按 Bank data 变化筛选快照，以不晚于该 slot 的 Group/价格和最近交易时间计算指标 |
| bank-history.test.ts | 测试 | fixture 银行变化、重复快照过滤、历史价格与交易时间 |
| activity.ts | 活动 | 主事件匹配、slot/ix/signature 稳定分页 |
| liquidations.ts | 清算 | 清算事件字段解析、按抵押或债务 bank 过滤 |
| spans.ts | 教学 | IDL 顶层参数字节范围、bigint 字符串 |
| xray.ts | X 光 | 原始 top/inner 指令、base64 日志和数据库原始行 |
| errors.ts | HTTP | 可公开的固定错误与状态码 |
| server.ts | HTTP | 只读 GET、钱包 GET/POST、CORS、JSON 与固定错误边界 |
| test-utils.ts | 测试辅助 | PGlite 加载本地 fixtures 与合成价格 |
| math.test.ts | 测试 | 清算健康金标准、手算利率与超安全整数数量 |
| queries.test.ts | 测试 | Anchor 快照数量、缺价格、微量债务与 group 费用开关 |
| activity.test.ts | 测试 | 18 行独立分布、主事件、失败交易和游标平局 |
| liquidations.test.ts | 测试 | 剧本清算前后余额、健康度与双 bank 过滤 |
| xray.test.ts | 测试 | 原始字节/解码/数据库对照、变量参数和合成 v0 inner |
| server.test.ts | 测试 | 无 socket 的路由/handle、CORS、参数、脱敏和端口 |
| pyth.test.ts | 测试 | 真实 pSOL 银行/验证账户/Pyth 价格:换算、快照、池子与带区间的健康度 |

| builder/ | 构建 | v0/Anchor、余额槽位、首次部分签名与模拟 |
| wallet-rpc.ts | RPC | 注入接口、时钟、10 秒请求超时 |
| wallet-input.ts | 输入 | 公钥、动作/u64 与 bigint 摘要 |
| program-error.ts | 错误 | IDL 自定义码、中文提示、安全 runtime 日志 |
| http-body.ts | HTTP | 流式 64KB JSON 与 POST CORS |
| send.ts / send.test.ts | 转发 | Ed25519/大小/程序守卫、确认/重播与幂等 |
| confirmed.ts / confirmed.test.ts | 即时同步 | confirmed 原始交易、指令解码、相关协议账户与预言机快照 |
| wallet.ts | 查询 | SOL/SPL 余额、当前池子账户与水龙头 URL |
| wallet-test-utils.ts | 测试辅助 | 无网络 RPC、精确 SPL/价格字节与时钟 |
| wallet-http.test.ts | 测试 | 钱包与无 socket HTTP 状态/JSON/脱敏 |

SYNC: 修改实现时同步本表、文件头部、README 与 EP7。
