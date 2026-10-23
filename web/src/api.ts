/** INPUT: API fetch 与共享 JSON 契约。 OUTPUT: 前端只读/钱包接口调用。 POSITION: Web 数据访问边界。 SYNC: 同步 web/src/market/folder.md。 */
import type { AccountView, ActivityPage, BankHistoryView, ClientConfig, LiquidationItem, PoolView, RateCurveView, WalletHistoryPage, XrayView } from '@contract';

export class ApiResponseError extends Error {
  constructor(message: string, public readonly code?: string, public readonly params?: Record<string, string>) { super(message); }
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path));
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = body as { error?: string | { message?: string }; code?: string; params?: Record<string, string> };
    const message = typeof error.error === 'string' ? error.error : error.error?.message;
    throw new ApiResponseError(message ?? `${path} → ${response.status}`, error.code, error.params);
  }
  return body as T;
}

/** API stays same-origin locally; Vercel embeds its public backend URL at build time. Absolute faucet URLs stay on their own host. */
export const apiUrl = (path: string): string => path.startsWith('/')
  ? `${import.meta.env?.VITE_API_BASE?.replace(/\/$/, '') ?? ''}${path}` : path;

export const api = {
  pool: () => get<PoolView>('/api/pool').then((pool) => ({
    ...pool,
    banks: [...pool.banks].sort((a, b) => {
      if (a.total_deposits_usd == null) return b.total_deposits_usd == null ? 0 : 1;
      if (b.total_deposits_usd == null) return -1;
      return b.total_deposits_usd - a.total_deposits_usd;
    }),
  })),
  config: () => get<ClientConfig>('/api/config'),
  rateCurve: (bank: string) => get<RateCurveView>(`/api/rate-curve?bank=${encodeURIComponent(bank)}`),
  bankHistory: (bank: string) => get<BankHistoryView>(`/api/bank-history?bank=${encodeURIComponent(bank)}`),
  accounts: () => get<AccountView[]>('/api/accounts'),
  activity: (before?: string, bank?: string, limit = 20) => get<ActivityPage>(`/api/activity?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}${bank ? `&bank=${encodeURIComponent(bank)}` : ''}`),
  liquidations: (bank?: string) => get<LiquidationItem[]>(`/api/liquidations${bank ? `?bank=${encodeURIComponent(bank)}` : ''}`),
  walletHistory: (wallet: string, before?: string) => get<WalletHistoryPage>(`/api/wallet/${encodeURIComponent(wallet)}/history${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  xray: (signature: string) => get<XrayView>(`/api/tx/${signature}`),
};
