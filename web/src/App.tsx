import { useCallback, useEffect, useState } from 'react';
import type { ClientConfig, SendResponse, WalletView } from '@contract';
import { chain } from './wallet/chain';
import { api } from './api';
import { usePoll } from './hooks';
import { Kpis } from './Kpis';
import { Markets } from './Markets';
import { SwapPage } from './swap/SwapPage';
import { Accounts, ExplorerOverview } from './Accounts';
import { Activity } from './Activity';
import { Xray } from './Xray';
import { TabBar, TabPanel, useMarketSymbol, useTab, type TabDef } from './Tabs';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletPanel } from './wallet/WalletPanel';
import { AssetPage } from './market/AssetPage';
import { WalletButton } from './wallet/WalletButton';
import { explorer } from './wallet/chain';
import { errorText, programErrorText, useT } from './i18n';

// ?mock 时整页是假数据、交易也是假的(曾有人在 mock 页兑换后以为没到账),必须一眼可见。生产构建里为 false。
const MOCK = import.meta.env.DEV && new URLSearchParams(location.search).has('mock');

export function App() {
  const { t, locale, setLocale } = useT();
  const [tab, go] = useTab();
  const marketSymbol = useMarketSymbol();
  const { connected, publicKey } = useWallet();
  const address = publicKey?.toBase58() ?? null;
  const [tx, setTx] = useState<string | null>(null);
  const [result, setResult] = useState<SendResponse | null>(null);
  // 兑换只是 SOL/SPL 转账，不经过 marginfi,不会进借贷市场的记录;它的 toast 不能给"交易详情"(打开只会是查不到)。
  const [resultIsLending, setResultIsLending] = useState(false);
  const reportSwap = useCallback((next: SendResponse) => { setResult(next); setResultIsLending(false); }, []);
  const [pendingSync, setPendingSync] = useState<{ signature: string; startedAt: number } | null>(null);
  const [syncExpired, setSyncExpired] = useState(false);
  // 用户刚发完交易时加速轮询 45 秒(1.5 秒一次),这样页面几秒内就能反映出来;平时 5 秒一次。
  const [fast, setFast] = useState(false);
  const [historyReload, setHistoryReload] = useState(0);
  const boost = useCallback(() => { setHistoryReload((n) => n + 1); setFast(true); window.setTimeout(() => setFast(false), 45_000); }, []);
  const every = fast ? 1500 : 5000;
  // 三份数据都在后台轮询(不管在哪个 tab):tab 上的计数与"可清算"提醒要实时,切 tab 也不必等加载。
  const pool = usePoll(api.pool, [every], every);
  const accounts = usePoll(api.accounts, [every], every);
  const activity = usePoll(() => api.activity(), [every], every);
  useEffect(() => {
    if (pendingSync && activity.data?.items.some((item) => item.signature === pendingSync.signature)) {
      setPendingSync(null);
      setHistoryReload((n) => n + 1);
    }
  }, [pendingSync, activity.data]);
  useEffect(() => {
    if (!pendingSync) return;
    const delay = Math.max(0, pendingSync.startedAt + 60_000 - Date.now());
    const timer = window.setTimeout(() => setSyncExpired(true), delay);
    return () => window.clearTimeout(timer);
  }, [pendingSync]);
  const syncStatus = pendingSync ? syncExpired ? t.syncLater : t.syncing : null;
  const reportResult = useCallback((next: SendResponse) => {
    setResult(next);
    setResultIsLending(true);
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
    { id: 'pool', label: t.market },
    { id: 'wallet', label: t.dashboard, badge: connected ? <span className="live-dot" title={t.connected} /> : undefined },
    { id: 'swap', label: t.swap },
    { id: 'accounts', label: t.explorer, badge: accounts.data && (risky
      ? <span className="count crit" title={t.riskyAccounts(risky)}>{risky} {t.liquidatable}</span>
      : <span className="count">{accounts.data.length}</span>) },
  ];

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <svg className="logo" viewBox="0 0 32 32" aria-hidden><circle cx="16" cy="16" r="16" fill="var(--s1)" /><path d="M11 9.2h13l-3 3.3H8zM8 14.4h13l3 3.3H11zM11 19.6h13l-3 3.3H8z" fill="white" /></svg>
          <div><h1><span className="brand-name">{t.lendingMarket}</span> <span className="net">Devnet</span>{MOCK && <span className="net mock">{t.mockData}</span>}</h1></div>
        </div>
        <div className="top-actions">
          <button className="btn sm" type="button" onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}>{t.language}</button>
          <WalletButton />
        </div>
      </header>
      <TabBar tabs={tabs} active={tab} onChange={go} />
      {Boolean(error) && <div className="err"><b>{t.readErrorTitle}</b>{t.readErrorFormat(errorText(error, t))}<div className="muted">{t.readErrorHint}<span className="mono">pnpm exec tsx scripts/serve-api.ts</span>{t.retryHint}</div></div>}
      {!pool.data && !error && <div className="loading-state">{t.loadingPool}</div>}
      {pool.data && (
        <>
          <TabPanel id="pool" active={tab}>
            {marketSymbol
              ? selected ? <AssetPage bank={selected} banks={pool.data.banks} mine={accounts.data?.find((a) => a.authority === address) ?? null} wallet={wallet ?? null} curve={curve.data} history={history.data} historyError={history.error} onTransaction={boost} onOpenTx={setTx} onResult={reportResult} syncStatus={syncStatus} /> : <div className="card asset-not-found"><h2>{t.assetNotFound}</h2><a href="#pool">{t.backToMarkets}</a></div>
              : <><Kpis pool={pool.data} /><div style={{ marginBottom: 16 }}><Markets pool={pool.data} /></div></>}
          </TabPanel>
          <TabPanel id="accounts" active={tab}>
            {accounts.data && <ExplorerOverview accounts={accounts.data} pool={pool.data} />}
            {activity.data ? <Activity first={activity.data.items} next={activity.data.next_before} pool={pool.data} onOpen={setTx} /> : <div className="card muted">{t.loadingActivity}</div>}
            {accounts.data ? <Accounts accounts={accounts.data} pool={pool.data} /> : <div className="card muted">{t.loadingLiquidations}</div>}
          </TabPanel>
          <TabPanel id="wallet" active={tab}>
            <WalletPanel banks={pool.data.banks} accounts={accounts.data ?? []} accountsReady={accounts.data !== null} onTransaction={boost} onGoSwap={goSwap} wallet={wallet ?? null} syncStatus={syncStatus} historyReload={historyReload} onOpenTx={setTx} />
          </TabPanel>
          <TabPanel id="swap" active={tab}>
            <SwapPage faucetUrl={config?.faucet_url ?? null} onDone={boost} wallet={wallet} onResult={reportSwap} active={tab === 'swap'} />
          </TabPanel>
        </>
      )}
      <footer className="foot muted">
        {t.footerNotice}
      </footer>
      {result && <div className={`transaction-toast ${result.status === 'confirmed' ? 'ok' : 'bad'}`} role="status" aria-live="polite">
        <button className="transaction-toast-close" type="button" aria-label={t.closeNotice} onClick={() => setResult(null)}>×</button>
        <b>{result.status === 'confirmed' ? t.transactionConfirmed : result.status === 'timeout' ? t.transactionTimeout : t.transactionFailedWith(programErrorText(result.error, t))}</b>
        <div className="transaction-toast-links"><a href={explorer(result.signature)} target="_blank" rel="noreferrer">{t.viewExplorer}</a>{resultIsLending && <button className="linkish" onClick={() => setTx(result.signature)}>{t.transactionDetails}</button>}</div>
      </div>}
      {tx && <Xray signature={tx} onClose={close} />}
    </div>
  );
}
