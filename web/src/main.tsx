// wallet-adapter 与 web3.js 在浏览器里需要全局 Buffer。
import { Buffer } from 'buffer';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Providers } from './wallet/Providers';
import './radix-colors.css';
import './styles.css';

(globalThis as { Buffer?: typeof Buffer }).Buffer = Buffer;

async function boot() {
  // 开发时没有 API 也能看界面：?mock 会用 mock.ts 里的假数据接管 fetch。
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('mock')) (await import('./mock')).installMock();
  createRoot(document.getElementById('root')!).render(<StrictMode><Providers><App /></Providers></StrictMode>);
}
void boot();
