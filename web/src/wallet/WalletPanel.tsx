import { useWallet } from '@solana/wallet-adapter-react';
import type { AccountView, BankView, WalletView } from '@contract';
import { fmtPct, fmtToken, fmtUsd } from '../format';
import { TokenName } from '../tokens';
import { GetTokens } from './GetTokens';
import { goMarket } from '../Tabs';
import { portfolioSummary } from '../portfolio';
import { previewRisk } from '../risk';
import { WalletButton } from './WalletButton';

const minimum = (a: string, b: string) => BigInt(a) < BigInt(b) ? a : b;

export function WalletPanel({ banks, accounts, accountsReady, onTransaction, onGoSwap, wallet }: {
  banks: BankView[]; accounts: AccountView[]; accountsReady: boolean; onTransaction: () => void; onGoSwap: () => void; wallet: WalletView | null;
}) {
  const { publicKey, connected } = useWallet();
  const address = publicKey?.toBase58() ?? null;
  const mine = accounts.find((account) => account.authority === address) ?? null;
  const summary = accountsReady ? portfolioSummary(mine, banks) : null;
  const deposits = mine?.balances.filter((balance) => balance.deposit !== '0') ?? [];
  const debts = mine?.balances.filter((balance) => balance.borrow !== '0') ?? [];
  const sol = wallet ? Number(wallet.sol_lamports) / 1e9 : null;
  const hasTokens = Boolean(wallet?.tokens.some((token) => BigInt(token.amount) > 0n));
  const hasDeposit = accountsReady && deposits.length > 0;
  const hasBorrow = accountsReady && debts.length > 0;
  const steps = [connected, sol != null && sol >= 0.01, hasTokens, hasDeposit, hasBorrow];
  const showGuide = !connected || !hasBorrow;
  const borrowLimit = (bank: BankView) => {
    const liquidity = (BigInt(bank.total_deposits) - BigInt(bank.total_borrows)).toString();
    try { return mine ? minimum(previewRisk(banks, mine.balances, { action: 'borrow', bank: bank.address, amount: '0' }).maxBorrow ?? '0', liquidity) : '0'; }
    catch { return '0'; }
  };
  const borrowBank = banks.find((bank) => BigInt(borrowLimit(bank)) > 0n) ?? banks[0];

  const positionRows = (balances: typeof deposits, action: 'deposit' | 'borrow') => balances.map((balance) => {
    const bank = banks.find((item) => item.address === balance.bank);
    const debt = action === 'borrow';
    const amount = debt ? balance.borrow : balance.deposit;
    const usd = debt ? balance.borrow_usd : balance.deposit_usd;
    return <li key={balance.bank}><TokenName symbol={balance.label} size={28} sub={debt ? '债务' : '存款'} />
      <span className="n"><b className={debt ? 'bad-text' : ''}>{debt ? '−' : ''}{fmtToken(amount, bank?.decimals ?? 0, 4)}</b><span className="muted">{fmtUsd(usd)}</span></span>
      <button className="btn sm" onClick={() => goMarket(balance.label, debt ? 'repay' : 'withdraw')}>{debt ? '还款' : '取款'}</button>
    </li>;
  });

  return <div className="portfolio">
    {showGuide && <section className="card onboarding">
      <div className="section-heading"><div><h2>开始使用</h2><p className="muted">五步完成首次借贷，所有资产都在 Solana devnet 上。</p></div>
        {!connected && <WalletButton />}</div>
      <ol className="onboarding-steps">{steps.map((done, index) => <li key={index} className={done ? 'done' : ''}>
        <span className="step-state" aria-label={done ? '已完成' : '未完成'}>{done ? '✓' : index + 1}</span>
        <div><b>{['连接 devnet 钱包', '领取 devnet SOL', '领取测试币', '存入抵押资产', '借出资产'][index]}</b>
          <span>{[
            done ? '钱包已连接' : '连接 Phantom 或 Solflare，并切换到 devnet。',
            done ? `当前余额 ${sol?.toFixed(3)} SOL` : sol == null && connected ? '正在读取钱包余额…' : 'SOL 用于支付交易手续费。',
            done ? '钱包里已有测试代币' : '免费领取本项目提供的测试代币。',
            done ? '已有存款头寸' : !accountsReady ? '正在读取头寸…' : '选择有存款 APR 的资产作为抵押。',
            done ? '已有借款头寸' : !accountsReady ? '正在读取头寸…' : '在可借额度内选择需要的资产。',
          ][index]}</span>
          {index === 1 && !done && <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">打开 Solana 水龙头 ↗</a>}
          {index === 2 && !done && wallet?.faucet_url && address && <GetTokens address={address} faucetUrl={wallet.faucet_url} tokens={wallet.tokens} onDone={onTransaction} onGoSwap={onGoSwap} />}
          {index === 3 && !done && banks[0] && <button className="linkish" onClick={() => goMarket(banks[0].label, 'deposit')}>去市场选择资产 →</button>}
          {index === 4 && !done && borrowBank && <button className="linkish" onClick={() => goMarket(borrowBank.label, 'borrow')}>查看可借资产 →</button>}
        </div>
      </li>)}</ol>
    </section>}

    {connected && <>
      <div className="grid kpis portfolio-kpis">
        <div className="card"><div className="label">净资产</div><div className="hero">{fmtUsd(summary?.netAssetsUsd ?? null)}</div><div className="muted">marginfi 存款减去债务</div></div>
        <div className="card"><div className="label">净 APY · 预估</div><div className="stat">{fmtPct(summary?.netApy ?? null, 2)}</div><div className="muted">按当前 APR 估算</div></div>
        <div className="card"><div className="label">健康因子</div><div className={`stat ${summary?.healthFactor != null && summary.healthFactor < 1.1 ? 'bad-text' : summary?.healthFactor != null && summary.healthFactor < 1.5 ? 'risk-warn' : summary?.healthFactor != null || deposits.length ? 'good-text' : ''}`}>
          {!accountsReady ? '读取中…' : summary?.healthFactor == null ? deposits.length && !debts.length ? '∞ · 无债务' : '—' : summary.healthFactor.toFixed(2)}</div><div className="muted">维持权重；小于 1 可清算</div></div>
        <div className="card"><div className="label">已用借款额度</div><div className="stat">{fmtPct(summary?.borrowCapacityUsed ?? null)}</div>
          <div className={`meter ${(summary?.borrowCapacityUsed ?? 0) >= 1 ? 'crit' : (summary?.borrowCapacityUsed ?? 0) >= 0.75 ? 'warn' : ''}`}><i style={{ width: `${Math.max(0, Math.min(100, (summary?.borrowCapacityUsed ?? 0) * 100))}%` }} /></div></div>
      </div>
      <div className={`wallet-hint ${sol != null && sol < 0.01 ? 'low-sol' : ''}`}>
        <span>钱包 SOL <b>{sol == null ? '读取中…' : sol.toFixed(3)}</b></span>
        {sol != null && sol < 0.01 && <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">SOL 不足，去水龙头领取 ↗</a>}
        {wallet?.faucet_url && address && <GetTokens address={address} faucetUrl={wallet.faucet_url} tokens={wallet.tokens} onDone={onTransaction} onGoSwap={onGoSwap} />}
        <button className="linkish" onClick={onGoSwap}>用 SOL 兑换</button>
      </div>
      <div className="grid portfolio-lists">
        <section className="card"><h2>我的存款</h2>{deposits.length ? <ul className="asset-list">{positionRows(deposits, 'deposit')}</ul> : <p className="muted">还没有存款。</p>}</section>
        <section className="card"><h2>我的借款</h2>{debts.length ? <ul className="asset-list">{positionRows(debts, 'borrow')}</ul> : <p className="muted">还没有借款。</p>}</section>
        <section className="card"><h2>可存资产</h2><ul className="asset-list">{banks.map((bank) => {
          const token = wallet?.tokens.find((item) => item.mint === bank.mint);
          return <li key={bank.address}><TokenName symbol={bank.label} size={28} sub={`${fmtPct(bank.lending_apr, 2)} 存款 APR`} />
            <span className="n"><b>{token ? fmtToken(token.amount, token.decimals, 4) : '—'}</b><span className="muted">钱包余额</span></span>
            <button className="btn sm" onClick={() => goMarket(bank.label, 'deposit')}>存入</button>
          </li>;
        })}</ul></section>
        <section className="card"><h2>可借资产</h2><ul className="asset-list">{banks.map((bank) => {
          const maximum = borrowLimit(bank);
          return <li key={bank.address}><TokenName symbol={bank.label} size={28} sub={`${fmtPct(bank.borrowing_apr, 2)} 借款 APR`} />
            <span className="n"><b>{fmtToken(maximum, bank.decimals, 4)}</b><span className="muted">最多可借</span></span>
            <button className="btn sm" disabled={BigInt(maximum) === 0n} onClick={() => goMarket(bank.label, 'borrow')}>借出</button>
          </li>;
        })}</ul></section>
      </div>
    </>}
  </div>;
}
