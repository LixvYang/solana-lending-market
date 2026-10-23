/**
 * API 与前端之间的数据契约(JSON)。后端实现与前端都以这个文件为准，改动要同时改两边。
 *
 * 约定:
 * - `native` 结尾或说明为"原生单位"的数量是十进制字符串(mint 的最小单位，向下取整)，因为 u64 会超出 JS 安全整数。
 * - `*_usd`、`*_apr`、`price`、`utilization`、`health` 是给人看的 number(浮点)，不能用来对账；
 *   需要精确值的地方另给字符串字段。
 * - 时间一律 ISO 8601 字符串；slot 是十进制字符串。
 */

export interface BankWeights {
  asset_init: number;
  asset_maint: number;
  liability_init: number;
  liability_maint: number;
}

/** 分段线性利率曲线的参数(上游 InterestRateConfig)。 */
export interface InterestCurve {
  optimal_utilization: number;
  plateau_rate: number;
  max_rate: number;
  /** 借款人在基础利率之上多付的费用：按比例的部分与固定 APR 的部分。 */
  fee_rate: number;
  fee_fixed_apr: number;
}

export type OracleSource = 'pyth' | 'mock' | 'switchboard';

/** GET /api/config:前端启动时需要的公开配置。 */
export interface ClientConfig {
  /** 水龙头/兑换台地址;未配置时为 null。 */
  faucet_url: string | null;
}

export interface BankView {
  address: string;
  mint: string;
  /** 链下标签(链上没有代币符号)，没有则回退为地址缩写。 */
  label: string;
  decimals: number;
  /** 来自预言机账户；没有快照时为 null。 */
  price: number | null;
  price_updated_at: string | null;
  oracle_feed: string | null;
  /** 价格来源:pyth = Pyth 真实行情;mock = Switchboard 布局、由我们写入的价格(D-009);switchboard = 真实 Switchboard。 */
  oracle_source: OracleSource | null;
  total_deposits: string;
  total_borrows: string;
  total_deposits_usd: number | null;
  total_borrows_usd: number | null;
  /** 借款 / 存款，0..1。 */
  utilization: number;
  lending_apr: number;
  borrowing_apr: number;
  weights: BankWeights;
  /** 程序算健康度时用的价格区间(开仓用 EMA、维持用实时价;资产取 low、债务取 high)。mock 价时 low = high。无价格时为 null。 */
  risk_price: { init: { low: number; high: number }; maint: { low: number; high: number } } | null;
  curve: InterestCurve;
  /** I80F48 精确十进制字符串。 */
  asset_share_value: string;
  liability_share_value: string;
  last_accrual_at: string;
}

export interface PoolView {
  program: string;
  group: string | null;
  /** 最近一次采样的 slot；即使账户内容未变化也会前进。 */
  as_of_slot: string | null;
  banks: BankView[];
  totals: { deposits_usd: number | null; borrows_usd: number | null; utilization: number | null };
}

export interface RatePoint {
  utilization: number;
  lending_apr: number;
  borrowing_apr: number;
}

export interface RateCurveView {
  bank: string;
  label: string;
  points: RatePoint[];
  current: RatePoint;
}

export interface BankHistoryPoint {
  slot: string;
  block_time: string | null;
  total_deposits: string;
  total_borrows: string;
  total_deposits_usd: number | null;
  total_borrows_usd: number | null;
  utilization: number;
  lending_apr: number;
  borrowing_apr: number;
}

export interface BankHistoryView {
  bank: string;
  label: string;
  points: BankHistoryPoint[];
}

export interface BalanceView {
  bank: string;
  label: string;
  /** 原生单位 = shares × share_value，向下取整。 */
  deposit: string;
  borrow: string;
  deposit_usd: number | null;
  borrow_usd: number | null;
}

/** unknown：有负债但缺价格，无法判断健康度——不能当作可清算，也不能当作健康。 */
export type AccountStatus = 'no_debt' | 'healthy' | 'liquidatable' | 'unknown';

export interface AccountView {
  address: string;
  label: string;
  authority: string;
  balances: BalanceView[];
  /**
   * 健康度 = Σ(存款 × 价格 × 资产权重) − Σ(借款 × 价格 × 负债权重)，单位 USD。
   * init 用开仓权重，maint 用维持权重；maint < 0 即可被清算。
   * 与清算事件里程序自己报告的 liquidatee_pre_health 逐位对得上(见 src/api 测试)。
   */
  health: { init: number | null; maint: number | null; assets_usd: number | null; liabilities_usd: number | null };
  status: AccountStatus;
}

export interface ActivityItem {
  signature: string;
  slot: string;
  block_time: string | null;
  /** 顶层指令下标；事件所属指令。 */
  ix_index: number;
  /** 指令名，如 lending_account_borrow。 */
  instruction: string;
  /** 与该指令对应的主事件名(若有)，如 LendingAccountBorrowEvent。 */
  event: string | null;
  account: string | null;
  account_label: string | null;
  /** 清算取被清算资产所在的 bank(asset_bank)。 */
  bank: string | null;
  bank_label: string | null;
  /** 原生单位；清算等用 f64 的事件为 null。 */
  amount: string | null;
  ok: boolean;
}

export interface ActivityPage {
  items: ActivityItem[];
  /** 下一页的游标(传回 before)；没有更多则为 null。 */
  next_before: string | null;
}

export type WalletHistoryKind = 'deposit' | 'borrow' | 'repay' | 'withdraw' | 'liquidated' | 'liquidator' | 'swap' | 'faucet';
export interface WalletHistoryLeg { symbol: string; amount: string; decimals: number }
export interface WalletHistoryItem {
  time: string | null;
  kind: WalletHistoryKind;
  assets: WalletHistoryLeg[];
  result: 'success' | 'failed' | (string & {});
  signature: string;
  detail: boolean;
}
export interface WalletHistoryPage { items: WalletHistoryItem[]; next_before: string | null }

/** GET /api/liquidations:清算事件里的原生单位 f64 差值与健康度。 */
export interface LiquidationItem {
  signature: string;
  slot: string;
  block_time: string | null;
  ix_index: number;
  liquidatee_account: string;
  liquidatee_label: string | null;
  asset_bank: string;
  asset_label: string | null;
  liability_bank: string;
  liability_label: string | null;
  /** 没收的抵押原生单位，来自事件 f64 前后余额差。 */
  seized_asset: number;
  /** 偿还的债务原生单位，来自事件 f64 前后余额差。 */
  repaid_liability: number;
  pre_health: number;
  post_health: number;
}

/** 交易里的一段字节：偏移、长度、含义、十六进制与解出的值。教学用。 */
export interface ByteSpan {
  offset: number;
  length: number;
  label: string;
  hex: string;
  value: unknown;
}

export interface XrayInstruction {
  ix_index: number;
  inner_index: number | null;
  program: string;
  name: string;
  /** 指令数据的 base58 原文(RPC 返回的就是它)与十六进制。 */
  data_base58: string;
  data_hex: string;
  /** discriminator + 各参数的字节切分。 */
  spans: ByteSpan[];
  args: Record<string, unknown>;
  accounts: Record<string, string>;
  remaining: string[];
  decode_error: string | null;
}

export interface XrayEvent {
  log_index: number;
  ix_index: number;
  name: string;
  /** 日志里 `Program data:` 的 base64 原文。 */
  base64: string;
  data: Record<string, unknown>;
}

/**
 * "X 光"：同一笔交易的三种形态——链上原始字节、解码结果、写进数据库的行。
 * 这是整个合集的核心演示。
 */
export interface XrayView {
  signature: string;
  slot: string;
  block_time: string | null;
  err: unknown | null;
  logs: string[];
  instructions: XrayInstruction[];
  events: XrayEvent[];
  /** 数据库里 instructions / events 表的行(JSON 原样)。 */
  rows: { instructions: Record<string, unknown>[]; events: Record<string, unknown>[] };
}

/* ───────────────────────── 钱包交互(M7) ─────────────────────────
 * 交易由服务端构建、钱包签名、服务端转发。浏览器里没有 Anchor，也看不到 RPC 密钥。
 * 服务端只会用两类密钥签名:新建的 marginfi 账户(一次性)、公开的价格账户。从不持有管理员密钥。
 */

export type WalletAction = 'deposit' | 'withdraw' | 'borrow' | 'repay';

export interface BuildRequest {
  action: WalletAction;
  /** 用户钱包地址(手续费付款人,也是 marginfi 账户的 authority)。 */
  wallet: string;
  bank: string;
  /** 原生单位的十进制字符串；`all` 为 true 时忽略。 */
  amount: string;
  /** repay_all / withdraw_all：清空该头寸(由程序按含利息的精确数量结算)。 */
  all?: boolean;
}

/** 链上错误的人话版本。code 是 Anchor 错误码(没有则为 null)。 */
export interface ProgramErrorView {
  code: number | null;
  name: string;
  message: string;
}

export interface SimulationView {
  ok: boolean;
  error: ProgramErrorView | null;
  logs: string[];
  units_consumed: number | null;
}

export interface BuildResponse {
  /** base64 的 v0 交易：未签名，或只带一次性账户(新建的 marginfi 账户)的签名。 */
  transaction: string;
  /** 超过这个区块高度交易就过期。 */
  last_valid_block_height: number;
  /** 这笔交易会同时创建用户的 marginfi 账户(首次存款)。 */
  creates_account: boolean;
  marginfi_account: string;
  simulation: SimulationView;
  /** 给人看的一句话摘要，如 “存入 1,000 tUSDC”。 */
  summary: string;
}

export interface SendRequest {
  /** base64，已由钱包签名。 */
  transaction: string;
}

export interface SendResponse {
  signature: string;
  status: 'confirmed' | 'failed' | 'timeout';
  error: ProgramErrorView | null;
  slot: string | null;
  /** 成功交易已同步到活动表与最新账户快照。 */
  indexed: boolean;
}

export interface WalletTokenView {
  bank: string;
  mint: string;
  label: string;
  decimals: number;
  /** 钱包里的数量，原生单位。 */
  amount: string;
}

export interface WalletView {
  wallet: string;
  sol_lamports: string;
  tokens: WalletTokenView[];
  /** 这个钱包在当前池子里的 marginfi 账户；还没有则为 null。 */
  marginfi_account: string | null;
  /** 水龙头服务地址(没配置则为 null)。 */
  faucet_url: string | null;
}

/** 水龙头(独立进程)的响应。 */
export interface FaucetResponse {
  signatures: string[];
  granted: { label: string; amount: string }[];
  next_allowed_at: string;
}

/* ───────────────────────── 兑换(SOL 与池子资产任意两两互换) ─────────────────────────
 * 测试币是自己发行的,没有真实的 AMM 池子。兑换台是按预言机报价的"原子兑换":一笔交易里同时
 * "用户把 A 转给兑换台"和"兑换台把 B 转给用户",兑换台先签名、用户再签名,要么都发生要么都不发生。
 * 手续费和账户租金由用户付,兑换台只提供资产。统一使用 USD 单价推导汇率,不会有套利环。
 */
export type SwapAsset = 'SOL' | 'tSOL' | 'tUSDC' | 'pSOL' | 'pBTC' | 'pETH' | 'tHYPE';

export interface SwapAssetView {
  symbol: SwapAsset;
  decimals: number;
  /** 单价(USD),十进制字符串;报价当时从价格账户读取。价格暂不可用(如 Pyth 断更)时为 null。 */
  usd: string | null;
  source: OracleSource | null;
  /** usd 为 null 时的原因;其他资产照常报价。 */
  unavailable?: string;
}

export interface SwapRatesView {
  assets: SwapAssetView[];
  /** 单笔兑换的价值下限/上限(USD)。 */
  min_usd: string;
  max_usd: string;
}

export interface SwapQuoteRequest {
  wallet: string;
  from: SwapAsset;
  to: SwapAsset;
  /** 要卖出的数量(from 的 UI 单位,如 "0.1")。 */
  amount: string;
}

export interface SwapQuoteResponse {
  /** base64 的 v0 交易:已由兑换台签名,还差用户的签名。 */
  transaction: string;
  last_valid_block_height: number;
  from: SwapAsset;
  to: SwapAsset;
  /** 原生单位。 */
  in_amount: string;
  in_decimals: number;
  out_amount: string;
  out_decimals: number;
  summary: string;
}
