/** INPUT: API/组件传入的 token symbol。 OUTPUT: 代币名称、说明、内联 SVG 图标与价格来源角标。
 * POSITION: 前端按符号登记展示信息;测试币不依赖链上 Metaplex 元数据。 SYNC: 新银行符号要补齐此表和图标。
 */
export interface TokenMeta { symbol: string; name: string; description: string; badge?: { text: string; color: string } }

const TOKENS: Record<string, TokenMeta> = {
  SOL: { symbol: 'SOL', name: 'Solana', description: 'Solana 原生代币,用来付手续费和账户租金。兑换台按 Pyth SOL/USD 实时价计价。' },
  pSOL: { symbol: 'pSOL', name: 'Pyth 定价测试 SOL', badge: { text: 'P', color: 'var(--violet-9)' },
    description: '价格跟随 Pyth devnet 的 SOL/USD 实时行情(约 1–2 分钟更新一次),用来演示真实预言机。' },
  pBTC: { symbol: 'pBTC', name: 'Pyth 定价测试 BTC', badge: { text: 'P', color: 'var(--violet-9)' },
    description: '测试用 BTC,价格跟随 Pyth devnet 的 BTC/USD 实时行情;不是可兑换或提取的真实比特币。' },
  pETH: { symbol: 'pETH', name: 'Pyth 定价测试 ETH', badge: { text: 'P', color: 'var(--violet-9)' },
    description: '测试用 ETH,价格跟随 Pyth devnet 的 ETH/USD 实时行情;不是可兑换或提取的真实以太币。' },
  tHYPE: { symbol: 'tHYPE', name: '固定价格测试 HYPE', badge: { text: 't', color: 'var(--orange-9)' },
    description: '测试用 HYPE,价格由我们固定为 $80,后台程序定时写上链;仅用于 devnet 借贷演示。' },
  tSOL: { symbol: 'tSOL', name: '测试 SOL', badge: { text: 't', color: 'var(--orange-9)' },
    description: '用于借贷与清算演示的测试 SOL，价格由项目控制。' },
  tUSDC: { symbol: 'tUSDC', name: '测试 USDC', badge: { text: 't', color: 'var(--orange-9)' },
    description: '用于借款与清算演示的测试稳定币，按 $1 计价。' },
};

export const tokenMeta = (symbol: string): TokenMeta =>
  TOKENS[symbol] ?? { symbol, name: symbol, description: '没有登记的代币。' };

// Solana 标志的三根斜条(32×32 坐标)。
const BARS = 'M11 9.2h13l-3 3.3H8zM8 14.4h13l3 3.3H11zM11 19.6h13l-3 3.3H8z';

function Base({ symbol, id }: { symbol: string; id: string }) {
  if (symbol === 'tUSDC') return (<>
    <circle cx="16" cy="16" r="16" fill="#2775ca" />
    <circle cx="16" cy="16" r="10.5" fill="none" stroke="white" strokeWidth="1.6" strokeDasharray="12 4.5" transform="rotate(-30 16 16)" />
    <text x="16" y="21" textAnchor="middle" fontSize="14" fontWeight="700" fill="white" fontFamily="system-ui, sans-serif">$</text>
  </>);
  if (symbol === 'pBTC') return <>
    <circle cx="16" cy="16" r="16" fill="#f7931a" />
    <text x="16" y="22" textAnchor="middle" fontSize="19" fontWeight="700" fill="white" fontFamily="system-ui, sans-serif">₿</text>
  </>;
  if (symbol === 'pETH') return <>
    <circle cx="16" cy="16" r="16" fill="#627eea" />
    <path d="M16 5 8.8 16.2 16 20.4l7.2-4.2L16 5Zm0 17.2-7.2-4.3L16 28l7.2-10.1L16 22.2Z" fill="white" />
  </>;
  if (symbol === 'tHYPE') return <>
    <circle cx="16" cy="16" r="16" fill="#24252b" />
    <path d="M10 8h3.4v6.2h5.2V8H22v16h-3.4v-6.5h-5.2V24H10V8Z" fill="white" />
  </>;
  const bg = symbol === 'SOL' ? '#111014' : symbol === 'pSOL' ? `url(#${id}-p)` : '#2b2540';
  return (<>
    <defs>
      <linearGradient id={`${id}-g`} x1="8" y1="23" x2="24" y2="9" gradientUnits="userSpaceOnUse"><stop stopColor="#9945ff" /><stop offset="1" stopColor="#14f195" /></linearGradient>
      <linearGradient id={`${id}-p`} x1="0" y1="32" x2="32" y2="0" gradientUnits="userSpaceOnUse"><stop stopColor="#3b1f8f" /><stop offset="1" stopColor="#7c4dff" /></linearGradient>
    </defs>
    <circle cx="16" cy="16" r="16" fill={bg} />
    <path d={BARS} fill={symbol === 'SOL' ? `url(#${id}-g)` : symbol === 'pSOL' ? 'white' : '#c9c2ec'} />
  </>);
}

/** 代币图标。size 为像素;角标标明"测试币"。 */
export function TokenIcon({ symbol, size = 24 }: { symbol: string; size?: number }) {
  const meta = tokenMeta(symbol), id = `tk-${symbol}-${size}`;
  const known = symbol in TOKENS;
  return (
    <svg className="token-icon" width={size} height={size} viewBox="-1 -1 36 36" role="img" aria-label={symbol}>
      {known ? <Base symbol={symbol} id={id} /> : <>
        <circle cx="16" cy="16" r="16" fill="var(--axis)" />
        <text x="16" y="21" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--ink)">{symbol.slice(0, 2)}</text></>}
      {meta.badge && <g>
        <circle cx="27.5" cy="27.5" r="6.5" fill={meta.badge.color} stroke="var(--surface)" strokeWidth="2" />
        <text x="27.5" y="30.6" textAnchor="middle" fontSize="8.5" fontWeight="800" fill="white" fontFamily="system-ui, sans-serif">{meta.badge.text}</text>
      </g>}
    </svg>
  );
}

/** 图标 + 符号 + 名称,用在表格第一列和选择器里。 */
export function TokenName({ symbol, size = 32, sub }: { symbol: string; size?: number; sub?: React.ReactNode }) {
  const meta = tokenMeta(symbol);
  return (
    <span className="token-name">
      <TokenIcon symbol={symbol} size={size} />
      <span><b>{symbol}</b><span className="muted">{sub ?? meta.name}</span></span>
    </span>
  );
}

/** 只显示用户需要辨认的 Pyth 行情来源。 */
export function SourceChip({ source }: { source: string | null | undefined }) {
  return source === 'pyth' ? <span className="src live">Pyth</span> : null;
}
