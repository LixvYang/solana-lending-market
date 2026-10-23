import { useCallback, useEffect, useState } from 'react';
import type { ClientConfig, SendResponse, WalletView } from '@contract';
import { chain } from './wallet/chain';
import { api } from './api';
import { usePoll } from './hooks';
import { Kpis } from './Kpis';
import { Markets } from './Markets';
import { SwapPage } from './swap/SwapPage';
import { Accounts } from './Accounts';
import { Activity } from './Activity';
import { Xray } from './Xray';
import { TabBar, TabPanel, useMarketSymbol, useTab, type TabDef } from './Tabs';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletPanel } from './wallet/WalletPanel';
import { AssetPage } from './market/AssetPage';
import { WalletButton } from './wallet/WalletButton';
import { explorer } from './wallet/chain';

// ?mock 时整页是假数据、交易也是假的(曾有人在 mock 页兑换后以为没到账),必须一眼可见。生产构建里为 false。
const MOCK = import.meta.env.DEV && new URLSearchParams(location.search).has('mock');

export function App() {
  const [tab, go] = useTab();
  const marketSymbol = useMarketSymbol();
  const { connected, publicKey } = useWallet();
  const address = publicKey?.toBase58() ?? null;
  const [tx, setTx] = useState<string | null>(null);
  const [result, setResult] = useState<SendResponse | null>(null);
  const [pendingSync, setPendingSync] = useState<{ signature: string; startedAt: number } | null>(null);
  const [syncExpired, setSyncExpired] = useState(false);
  // 用户刚发完交易时加速轮询 45 秒(1.5 秒一次),这样页面几秒内就能反映出来;平时 5 秒一次。
  const [fast, setFast] = useState(false);
  const boost = useCallback(() => { setFast(true); window.setTimeout(() => setFast(false), 45_000); }, []);
  const every = fast ? 1500 : 5000;
  // 三份数据都在后台轮询(不管在哪个 tab):tab 上的计数与"可清算"提醒要实时,切 tab 也不必等加载。
  const pool = usePoll(api.pool, [every], every);
  const accounts = usePoll(api.accounts, [every], every);
  const activity = usePoll(() => api.activity(), [every], every);
  useEffect(() => {
    if (pendingSync && activity.data?.items.some((item) => item.signature === pendingSync.signature)) setPendingSync(null);
  }, [pendingSync, activity.data]);
  useEffect(() => {
    if (!pendingSync) return;
    const delay = Math.max(0, pendingSync.startedAt + 60_000 - Date.now());
    const timer = window.setTimeout(() => setSyncExpired(true), delay);
    return () => window.clearTimeout(timer);
  }, [pendingSync]);
  const syncStatus = pendingSync ? syncExpired ? '数据稍后更新' : '同步中' : null;
  const reportResult = useCallback((next: SendResponse) => {
    setResult(next);
    if (next.status === 'confirmed') { setPendingSync({ signature: next.signature, startedAt: Date.now() }); setSyncExpired(false); }
  }, []);
  const selected = pool.data?.banks.find((b) => b.label === marketSymbol) ?? null;
  const curve = usePoll(() => (selected ? api.rateCurve(selected.address) : Promise.resolve(null)), [selected?.address]);
  const history = usePoll(() => (selected ? api.bankHistory(selected.address) : Promise.resolve(null)), [selected?.address], every);
  const close = useCallback(() => setTx(null), []);
  const config = usePoll<ClientConfig>(api.config, [], 60_000).data;
  // 钱包余额只在这里轮询一次,"我的仓位"和"兑换"共用(每次都要走 RPC,不要两个 tab 各拉一份)。
  const wallet = usePoll<WalletView | null>(() => (address ? chain.wallet(address) : Promise.resolve(null)), [address, fast], fast ? 1500 : 15_000).data;
  const goSwap = useCallback(() => go('swap'), [go]);
  useEffect(() => {
    if (!result) return;
    const timer = window.setTimeout(() => setResult(null), 12_000);
    return () => window.clearTimeout(timer);
  }, [result]);
  const error = pool.error ?? accounts.error ?? activity.error;

  const risky = accounts.data?.filter((a) => a.status === 'liquidatable').length ?? 0;
  const tabs: TabDef[] = [
    { id: 'pool', label: '市场' },
    { id: 'wallet', label: '我的仓位', badge: connected ? <span className="live-dot" title="钱包已连接" /> : undefined },
    { id: 'swap', label: '兑换' },
    { id: 'accounts', label: '链上数据', badge: accounts.data && (risky
      ? <span className="count crit" title={`${risky} 个账户可被清算`}>{risky} 可清算</span>
      : <span className="count">{accounts.data.length}</span>) },
  ];

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <svg className="logo" viewBox="0 0 32 32" aria-hidden><circle cx="16" cy="16" r="16" fill="var(--s1)" /><path d="M11 9.2h13l-3 3.3H8zM8 14.4h13l3 3.3H11zM11 19.6h13l-3 3.3H8z" fill="white" /></svg>
          <div><h1>借贷市场 <span className="net">Devnet</span>{MOCK && <span className="net mock">模拟数据</span>}</h1></div>
        </div>
        <div className="top-actions">
          <WalletButton />
        </div>
      </header>
      <TabBar tabs={tabs} active={tab} onChange={go} />
      {error && <div className="err"><b>暂时读不到数据</b>（{error}）。<div className="muted">本地开发时请确认 API 已启动：<span className="mono">pnpm exec tsx scripts/serve-api.ts</span>；页面会自动重试。</div></div>}
      {!pool.data && !error && <div className="loading-state">正在读取借贷池数据…</div>}
      {pool.data && (
        <>
          <TabPanel id="pool" active={tab}>
            {marketSymbol
              ? selected ? <AssetPage bank={selected} banks={pool.data.banks} mine={accounts.data?.find((a) => a.authority === address) ?? null} wallet={wallet ?? null} curve={curve.data} history={history.data} historyError={history.error} onTransaction={boost} onOpenTx={setTx} onResult={reportResult} syncStatus={syncStatus} /> : <div className="card asset-not-found"><h2>找不到这个资产</h2><a href="#pool">← 返回市场</a></div>
              : <><Kpis pool={pool.data} /><div style={{ marginBottom: 16 }}><Markets pool={pool.data} /></div></>}
          </TabPanel>
          <TabPanel id="accounts" active={tab}>
            {activity.data ? <Activity first={activity.data.items} next={activity.data.next_before} pool={pool.data} onOpen={setTx} /> : <div className="card muted">正在读取链上活动…</div>}
            {accounts.data ? <Accounts accounts={accounts.data} pool={pool.data} /> : <div className="card muted">正在读取清算监控…</div>}
          </TabPanel>
          <TabPanel id="wallet" active={tab}>
            <WalletPanel banks={pool.data.banks} accounts={accounts.data ?? []} accountsReady={accounts.data !== null} onTransaction={boost} onGoSwap={goSwap} wallet={wallet ?? null} syncStatus={syncStatus} />
          </TabPanel>
          <TabPanel id="swap" active={tab}>
            <SwapPage faucetUrl={config?.faucet_url ?? null} onDone={boost} wallet={wallet} onResult={setResult} active={tab === 'swap'} />
          </TabPanel>
        </>
      )}
      <footer className="foot muted">
        测试网演示，代币没有真实价值。基于 marginfi mrgn-0.1.0。
      </footer>
      {result && <div className={`transaction-toast ${result.status === 'confirmed' ? 'ok' : 'bad'}`} role="status" aria-live="polite">
        <button className="transaction-toast-close" type="button" aria-label="关闭提示" onClick={() => setResult(null)}>×</button>
        <b>{result.status === 'confirmed' ? '交易已确认' : result.status === 'timeout' ? '确认超时，交易可能仍会上链' : `交易失败${result.error?.message ? `：${result.error.message}` : ''}`}</b>
        <div className="transaction-toast-links"><a href={explorer(result.signature)} target="_blank" rel="noreferrer">在 Explorer 查看</a><button className="linkish" onClick={() => setTx(result.signature)}>交易详情</button></div>
      </div>}
      {tx && <Xray signature={tx} onClose={close} />}
    </div>
  );
}
