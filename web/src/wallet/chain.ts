import type { BuildRequest, BuildResponse, FaucetResponse, SendResponse, SwapQuoteRequest, SwapQuoteResponse, SwapRatesView, WalletView } from '@contract';
import { apiUrl } from '../api';

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(url), init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const e = (body as { error?: string | { message?: string } }).error;
    throw new Error(typeof e === 'string' ? e : e?.message ?? `${url} → ${response.status}`);
  }
  return body as T;
}
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// 浏览器里没有 Anchor，也没有 RPC 密钥：交易由服务端构建，钱包签名，服务端转发。
export const chain = {
  wallet: (pubkey: string) => call<WalletView>(`/api/wallet/${pubkey}`),
  build: (request: BuildRequest) => call<BuildResponse>('/api/build', post(request)),
  send: (transaction: string) => call<SendResponse>('/api/send', post({ transaction })),
  // FAUCET_URL 带不带 /faucet 后缀都行。
  faucet: (url: string, wallet: string) => call<FaucetResponse>(url.endsWith('/faucet') ? url : `${url}/faucet`, post({ wallet })),
};

// 兑换台和水龙头是同一个独立进程;faucet_url 可能带 /faucet 后缀,取它的根地址。
export const deskBase = (faucetUrl: string) => faucetUrl.replace(/\/faucet$/, '');
export const swap = {
  rates: (base: string) => call<SwapRatesView>(`${base}/swap/rates`),
  quote: (base: string, request: SwapQuoteRequest) => call<SwapQuoteResponse>(`${base}/swap/quote`, post(request)),
  send: (base: string, transaction: string) => call<SendResponse>(`${base}/swap/send`, post({ transaction })),
};

export const explorer = (signature: string) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

export const b64 = {
  decode: (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
  encode: (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)),
};
