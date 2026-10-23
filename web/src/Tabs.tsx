import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export type TabId = 'pool' | 'wallet' | 'swap' | 'accounts';
export const TAB_IDS: TabId[] = ['pool', 'wallet', 'swap', 'accounts'];

export type MarketAction = 'deposit' | 'borrow' | 'repay' | 'withdraw';
export function parseMarketHash(hash: string): { symbol: string; action: MarketAction | null } | null {
  const match = /^market\/([^/]+)(?:\/(deposit|borrow|repay|withdraw))?$/.exec(hash);
  if (!match) return null;
  try { return { symbol: decodeURIComponent(match[1]), action: (match[2] as MarketAction | undefined) ?? null }; } catch { return null; }
}

export const marketFromHash = (): string | null => {
  return parseMarketHash(location.hash.slice(1))?.symbol ?? null;
};

export const marketActionFromHash = (): MarketAction | null => {
  return parseMarketHash(location.hash.slice(1))?.action ?? null;
};

// 旧链接(D-018 录制清单、分享出去的地址)里的 #activity 现在并入"链上数据"tab。
const ALIASES: Record<string, TabId> = { activity: 'accounts' };

const fromHash = (): TabId => {
  const raw = location.hash.slice(1);
  const id = marketFromHash() ? 'pool' : ALIASES[raw] ?? raw as TabId;
  return TAB_IDS.includes(id) ? id : 'pool';
};

/**
 * 当前 tab 记在 URL hash 里(#pool / #swap …):刷新、复制链接、浏览器后退都能回到同一个 tab,
 * 录视频时也可以直接打开某个 tab。
 */
export function useTab() {
  const [tab, setTab] = useState<TabId>(fromHash);
  useEffect(() => {
    const onHash = () => setTab(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = useCallback((id: TabId) => { if (location.hash.slice(1) !== id) location.hash = id; setTab(id); }, []);
  return [tab, go] as const;
}

export function useMarketSymbol() {
  const [symbol, setSymbol] = useState(marketFromHash);
  useEffect(() => {
    const onHash = () => setSymbol(marketFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return symbol;
}

export function goMarket(symbol: string, action?: MarketAction) {
  const hash = `market/${encodeURIComponent(symbol)}${action ? `/${action}` : ''}`;
  if (location.hash.slice(1) !== hash) location.hash = hash;
}

export interface TabDef { id: TabId; label: string; badge?: ReactNode }

/** WAI-ARIA tabs:左右方向键切换,Home/End 到首尾;只有选中的 tab 在 Tab 键顺序里。 */
export function TabBar({ tabs, active, onChange }: { tabs: TabDef[]; active: TabId; onChange: (id: TabId) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === active);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const id = tabs[(next + tabs.length) % tabs.length].id;
    onChange(id);
    refs.current[id]?.focus();
  };
  return (
    <nav className="tabs" role="tablist" aria-label="页面" onKeyDown={onKey}>
      {tabs.map((t) => (
        <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} role="tab" id={`tab-${t.id}`} aria-controls={`panel-${t.id}`}
                aria-selected={active === t.id} tabIndex={active === t.id ? 0 : -1} className={active === t.id ? 'on' : ''} onClick={() => onChange(t.id)}>
          {t.label}{t.badge}
        </button>))}
    </nav>
  );
}

/** 不在当前 tab 的面板只隐藏、不卸载:切走再切回,填了一半的表单、已加载的更多活动都还在。 */
export function TabPanel({ id, active, children }: { id: TabId; active: TabId; children: ReactNode }) {
  return <section role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={id !== active}>{children}</section>;
}
