import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en } from './en';
import { zh } from './zh';

export type Locale = 'zh' | 'en';
const dictionaries = { zh, en };
export type Translation = { [K in keyof typeof zh]: typeof zh[K] extends (...args: infer A) => string ? (...args: A) => string : string };
const LocaleContext = createContext<{ locale: Locale; t: Translation; setLocale: (locale: Locale) => void } | null>(null);

function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem('lang');
    if (stored === 'zh' || stored === 'en') return stored;
  } catch { /* 隐私模式下可能禁用 localStorage */ }
  return navigator.languages?.some((language) => language.toLowerCase().startsWith('zh')) ? 'zh' : 'en';
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    document.title = locale === 'zh' ? '借贷市场' : 'Lending Market';
    try { localStorage.setItem('lang', locale); } catch { /* 持久化失败不影响切换 */ }
  }, [locale]);
  const value = useMemo(() => ({ locale, t: dictionaries[locale], setLocale }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useT() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useT must be used inside LocaleProvider');
  return value;
}

export function apiErrorText(code: string | undefined, params: Record<string, string> | undefined, t: Translation, fallback: string): string {
  const symbol = params?.symbol ?? '';
  switch (code) {
    case 'PRICE_UNAVAILABLE': return t.apiPriceUnavailable(symbol);
    case 'DESK_INSUFFICIENT': return t.apiDeskInsufficient(symbol);
    case 'FAUCET_EMPTY': return t.apiFaucetEmpty;
    case 'TRANSFER_TIMEOUT': return t.apiTransferTimeout;
    case 'TRANSFER_FAILED': return t.apiTransferFailed;
    case 'NO_PRICE_SOURCE': return t.apiNoPriceSource(symbol);
    case 'FAUCET_LIMIT': return t.apiFaucetLimit;
    // 日期由字典按自身语言格式化：切换语言的那次渲染里 <html lang> 还没更新，不能读它。
    case 'FAUCET_WINDOW_FULL': return params?.next && Number.isFinite(Date.parse(params.next)) ? t.apiFaucetWindowFull(params.next) : t.apiFaucetLimit;
    case 'INTERNAL_ERROR': return t.apiError;
    default: return fallback;
  }
}

export function errorText(error: unknown, t: Translation): string {
  const value = error as { code?: string; params?: Record<string, string>; message?: string } | null;
  return apiErrorText(value?.code, value?.params, t, value?.message ?? String(error));
}

export function programErrorText(error: { name: string; message: string } | null, t: Translation): string {
  if (!error) return t.unknownError;
  const messages: Record<string, string> = {
    RiskEngineInitRejected: t.programRiskRejected, StaleOracle: t.programStaleOracle,
    BankAssetCapacityExceeded: t.programCapacityExceeded, BankLiabilityCapacityExceeded: t.programCapacityExceeded,
    IllegalUtilizationRatio: t.programLowLiquidity, LendingAccountBalanceNotFound: t.programNoPosition,
    NoAssetFound: t.programNoDeposit, NoLiabilityFound: t.programNoBorrow, BankPaused: t.programPaused,
    InsufficientFunds: t.programInsufficientFunds,
  };
  return messages[error.name] ?? (error.message || t.programUnknown);
}
