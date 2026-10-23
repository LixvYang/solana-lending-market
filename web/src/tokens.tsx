import { useId } from 'react';
import { useT } from './i18n';
/** INPUT: API/组件传入的 token symbol。 OUTPUT: 代币名称、说明、内联 SVG 图标与价格来源角标。
 * POSITION: 前端按符号登记展示信息;测试币不依赖链上 Metaplex 元数据。 SYNC: 新银行符号要补齐此表和图标。
 */
export interface TokenMeta { symbol: string; name: string; description: string; badge?: { text: string; color: string } }

export function tokenMeta(symbol: string, t: ReturnType<typeof useT>['t']): TokenMeta {
  const pyth = { color: 'var(--violet-9)' }, test = { color: 'var(--orange-9)' };
  const tokens: Record<string, TokenMeta> = {
    SOL: { symbol, name: t.tokenSolName, description: t.tokenSolDescription },
    pSOL: { symbol, name: t.tokenPsolName, badge: { text: 'P', ...pyth }, description: t.tokenPsolDescription },
    pBTC: { symbol, name: t.tokenPbtcName, badge: { text: 'P', ...pyth }, description: t.tokenPbtcDescription },
    pETH: { symbol, name: t.tokenPethName, badge: { text: 'P', ...pyth }, description: t.tokenPethDescription },
    tHYPE: { symbol, name: t.tokenThypeName, badge: { text: 't', ...test }, description: t.tokenThypeDescription },
    tSOL: { symbol, name: t.tokenTsolName, badge: { text: 't', ...test }, description: t.tokenTsolDescription },
    tUSDC: { symbol, name: t.tokenTusdcName, badge: { text: 't', ...test }, description: t.tokenTusdcDescription },
  };
  return tokens[symbol] ?? { symbol, name: symbol, description: t.tokenNoDescription };
}

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
  // 渐变 id 必须每个实例唯一：曾按"符号 + 尺寸"命名，同页重复时若第一个在隐藏的 tab 里(display:none),
  // Chrome 会让其他图标引用到的渐变失效——pSOL 的圆底整个消失，只剩角标。
  const { t } = useT();
  const meta = tokenMeta(symbol, t), id = `tk-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const known = ['SOL', 'pSOL', 'pBTC', 'pETH', 'tHYPE', 'tSOL', 'tUSDC'].includes(symbol);
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
  const { t } = useT();
  const meta = tokenMeta(symbol, t);
  return (
    <span className="token-name">
      <TokenIcon symbol={symbol} size={size} />
      <span><b>{symbol}</b><span className="muted">{sub ?? meta.name}</span></span>
    </span>
  );
}

/** 只显示用户需要辨认的 Pyth 行情来源。 */
export function SourceChip({ source }: { source: string | null | undefined }) {
  const { t } = useT();
  return source === 'pyth' ? <span className="src live">{t.sourcePyth}</span> : null;
}
