import { useWallet } from '@solana/wallet-adapter-react';
import type { AccountView, BankView, WalletView } from '@contract';
import { fmtPct, fmtToken, fmtUsd } from '../format';
import { TokenName } from '../tokens';
import { GetTokens } from './GetTokens';
import { goMarket } from '../Tabs';
import { portfolioSummary, positionSummary, shouldShowGettingStarted, sortByUsdDesc } from '../portfolio';
import { previewRisk } from '../risk';
import { WalletButton } from './WalletButton';
import { WalletHistory } from './WalletHistory';
import { useT } from '../i18n';

const minimum = (a: string, b: string) => BigInt(a) < BigInt(b) ? a : b;

export function WalletPanel({ banks, accounts, accountsReady, onTransaction, onGoSwap, wallet, syncStatus, historyReload, onOpenTx }: {
  banks: BankView[]; accounts: AccountView[]; accountsReady: boolean; onTransaction: () => void; onGoSwap: () => void; wallet: WalletView | null; syncStatus?: string | null;
  historyReload: number; onOpenTx: (signature: string) => void;
}) {
  const { t } = useT();
  const { publicKey, connected } = useWallet();
  const address = publicKey?.toBase58() ?? null;
  const mine = accounts.find((account) => account.authority === address) ?? null;
  const summary = accountsReady ? portfolioSummary(mine, banks) : null;
  const deposits = mine?.balances.filter((balance) => balance.deposit !== '0') ?? [];
  const debts = mine?.balances.filter((balance) => balance.borrow !== '0') ?? [];
  const depositSummary = positionSummary(deposits, banks, 'deposit');
  const debtSummary = positionSummary(debts, banks, 'borrow');
  const sol = wallet ? Number(wallet.sol_lamports) / 1e9 : null;
  const hasTokens = Boolean(wallet?.tokens.some((token) => BigInt(token.amount) > 0n));
  const hasDeposit = accountsReady && deposits.length > 0;
  const steps = [connected, sol != null && sol >= 0.01, hasTokens, hasDeposit];
  const currentStep = steps.findIndex((done) => !done);
  const showGuide = shouldShowGettingStarted(connected, hasDeposit);
  const borrowLimit = (bank: BankView) => {
    const liquidity = (BigInt(bank.total_deposits) - BigInt(bank.total_borrows)).toString();
    try { return mine ? minimum(previewRisk(banks, mine.balances, { action: 'borrow', bank: bank.address, amount: '0' }).maxBorrow ?? '0', liquidity) : '0'; }
    catch { return '0'; }
  };
  const supplyOptions = sortByUsdDesc(banks.map((bank) => {
    const token = wallet?.tokens.find((item) => item.mint === bank.mint);
    const usd = token && bank.price != null ? Number(token.amount) / 10 ** token.decimals * bank.price : null;
    return { bank, token, usd };
  }), (row) => row.usd);
  const borrowOptions = sortByUsdDesc(banks.map((bank) => {
    const maximum = borrowLimit(bank);
    return { bank, maximum, usd: bank.price == null ? null : Number(maximum) / 10 ** bank.decimals * bank.price };
  }), (row) => row.usd);

  const positionRows = (balances: typeof deposits, action: 'deposit' | 'borrow') => balances.map((balance) => {
    const bank = banks.find((item) => item.address === balance.bank);
    const debt = action === 'borrow';
    const amount = debt ? balance.borrow : balance.deposit;
    const usd = debt ? balance.borrow_usd : balance.deposit_usd;
    return <li key={balance.bank} className="portfolio-row">
      <span className="portfolio-cell portfolio-asset"><TokenName symbol={balance.label} size={28} sub={<span className={`portfolio-mobile-sub ${debt ? 'apr-borrow' : 'apr-supply'}`}>{fmtPct(debt ? bank?.borrowing_apr ?? null : bank?.lending_apr ?? null, 2)} {debt ? t.borrowApr : t.supplyApr}</span>} /></span>
      <span className="portfolio-cell n"><b>{fmtToken(amount, bank?.decimals ?? 0, 4)}</b><span className="muted">{fmtUsd(usd)}</span></span>
      <span className={`portfolio-cell portfolio-apr ${debt ? 'apr-borrow' : 'apr-supply'}`}>{fmtPct(debt ? bank?.borrowing_apr ?? null : bank?.lending_apr ?? null, 2)}</span>
      <button className="btn sm" onClick={() => goMarket(balance.label, debt ? 'repay' : 'withdraw')}>{debt ? t.repay : t.withdraw}</button>
    </li>;
  });

  const portfolioHeading = (title: string, data: typeof depositSummary, debt = false) => <div className="portfolio-card-heading"><h2>{title}</h2>{data && <div className="portfolio-totals">
    <span>{t.summaryBalance} <b>{fmtUsd(data.usd)}</b></span>
    <span className={debt ? 'apr-borrow' : 'apr-supply'}>{t.summaryApr} <b>{fmtPct(data.apr, 2)}</b></span>
    {debt && <span>{t.summaryCapacity} <b>{fmtPct(summary?.borrowCapacityUsed ?? null)}</b></span>}
  </div>}</div>;

  const tableHead = (value: string, apr: string) => <div className="portfolio-table-head"><span>{t.asset}</span><span>{value}</span><span>{apr}</span><span>{t.operation}</span></div>;

  return <div className="portfolio">
    {syncStatus && <div className="sync-status" role="status">{syncStatus}</div>}
    {showGuide && <section className="card onboarding">
      <div className="section-heading"><div><h2>{t.gettingStarted}</h2></div></div>
      <ol className="onboarding-steps">{steps.map((done, index) => <li key={index} className={done ? 'done' : ''}>
        <span className="step-state" aria-label={done ? t.stepDone : t.stepNotDone}>{done ? '✓' : index + 1}</span>
        <div><b>{[t.connectDevnetWallet, t.claimDevnetSol, t.getTestTokens, t.supplyCollateral][index]}</b>
          {index === currentStep && index === 0 && <WalletButton />}
          {index === currentStep && index === 1 && <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">{t.claimDevnetSol} ↗</a>}
          {index === currentStep && index === 2 && wallet?.faucet_url && address && <GetTokens address={address} faucetUrl={wallet.faucet_url} tokens={wallet.tokens} onDone={onTransaction} />}
          {index === currentStep && index === 3 && banks[0] && <button className="linkish" onClick={() => goMarket(banks[0].label, 'deposit')}>{t.goSupply}</button>}
        </div>
      </li>)}</ol>
    </section>}

    {connected && <>
      {deposits.length + debts.length > 0 && <div className="grid kpis portfolio-kpis">
        <div className="card"><div className="label">{t.netAssets}</div><div className="hero">{fmtUsd(summary?.netAssetsUsd ?? null)}</div></div>
        <div className="card"><div className="label">{t.netApy}</div><div className="stat">{fmtPct(summary?.netApy ?? null, 2)}</div></div>
        <div className="card"><div className="label">{t.healthFactor}</div><div className={`stat ${summary?.healthPercent != null && summary.healthPercent <= 10 ? 'bad-text' : summary?.healthPercent != null && summary.healthPercent < 30 ? 'risk-warn' : summary?.healthPercent != null ? 'good-text' : ''}`}>
          {!accountsReady ? t.reading : summary?.healthPercent == null ? '—' : `${summary.healthPercent.toFixed(1)}%${summary.healthPercent <= 0 ? ` ${t.liquidatable}` : ''}`}</div>
          <div className={`meter liquidation-meter ${summary?.healthPercent == null || summary.healthPercent >= 30 ? 'good' : summary.healthPercent > 10 ? 'warn' : 'crit'}`}><i style={{ width: `${Math.max(0, Math.min(100, 100 - (summary?.healthPercent ?? 100)))}%` }} /></div></div>
        <div className="card"><div className="label">{t.borrowPowerUsed}</div><div className="stat">{fmtPct(summary?.borrowCapacityUsed ?? null)}</div>
          <div className={`meter ${(summary?.borrowCapacityUsed ?? 0) >= 1 ? 'crit' : (summary?.borrowCapacityUsed ?? 0) >= 0.75 ? 'warn' : ''}`}><i style={{ width: `${Math.max(0, Math.min(100, (summary?.borrowCapacityUsed ?? 0) * 100))}%` }} /></div></div>
      </div>}
      <div className={`wallet-hint ${sol != null && sol < 0.01 ? 'low-sol' : ''}`}>
        <span>{t.walletSol} <b>{sol == null ? t.reading : sol.toFixed(3)}</b></span>
        {sol != null && sol < 0.01 && <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">{t.solInsufficient}</a>}
        {wallet?.faucet_url && address && <GetTokens address={address} faucetUrl={wallet.faucet_url} tokens={wallet.tokens} onDone={onTransaction} />}
        <button className="linkish" onClick={onGoSwap}>{t.swapSol}</button>
      </div>
      <div className="grid portfolio-lists">
        {/* 完全没有头寸时，引导条已经说明下一步;两张只写"还没有…"的卡片是重复信息，不显示。 */}
        {(deposits.length > 0 || debts.length > 0) && <>
          <section className="card">{portfolioHeading(t.yourSupplies, depositSummary)}{deposits.length ? <>{tableHead(t.positionDeposit, t.supplyApr)}<ul className="asset-list portfolio-table">{positionRows(deposits, 'deposit')}</ul></> : <p className="muted">{t.noSupplies}</p>}</section>
          <section className="card">{portfolioHeading(t.yourBorrows, debtSummary, true)}{debts.length ? <>{tableHead(t.positionDebt, t.borrowApr)}<ul className="asset-list portfolio-table">{positionRows(debts, 'borrow')}</ul></> : <p className="muted">{t.noBorrows}</p>}</section>
        </>}
        <section className="card"><h2>{t.supplyAssets}</h2>{tableHead(t.walletBalance, t.supplyApr)}<ul className="asset-list portfolio-table">{supplyOptions.map(({ bank, token, usd }) => {
          const amount = token ? BigInt(token.amount) : null;
          return <li key={bank.address} className={`portfolio-row ${amount === 0n ? 'zero' : ''}`}><span className="portfolio-cell portfolio-asset"><TokenName symbol={bank.label} size={28} sub={<span className="portfolio-mobile-sub apr-supply">{fmtPct(bank.lending_apr, 2)} {t.supplyApr}</span>} /></span>
            <span className="portfolio-cell n"><b>{token ? fmtToken(token.amount, token.decimals, 4) : '—'}</b><span className="muted">{fmtUsd(usd)}</span></span>
            <span className="portfolio-cell portfolio-apr apr-supply">{fmtPct(bank.lending_apr, 2)}</span>
            <button className="btn sm" onClick={() => goMarket(bank.label, 'deposit')}>{t.supplyButton}</button>
          </li>;
        })}</ul></section>
        <section className="card"><h2>{t.borrowAssetsTitle}</h2>{!deposits.length ? <p className="muted">{t.supplyCollateralFirst}</p> : <>{tableHead(t.availableBorrowAmount, t.borrowApr)}<ul className="asset-list portfolio-table">{borrowOptions.map(({ bank, maximum, usd }) => {
          return <li key={bank.address} className={`portfolio-row ${BigInt(maximum) === 0n ? 'zero' : ''}`}><span className="portfolio-cell portfolio-asset"><TokenName symbol={bank.label} size={28} sub={<span className="portfolio-mobile-sub apr-borrow">{fmtPct(bank.borrowing_apr, 2)} {t.borrowApr}</span>} /></span>
            <span className="portfolio-cell n"><b>{fmtToken(maximum, bank.decimals, 4)}</b><span className="muted">{fmtUsd(usd)}</span></span>
            <span className="portfolio-cell portfolio-apr apr-borrow">{fmtPct(bank.borrowing_apr, 2)}</span>
            <button className="btn sm" onClick={() => goMarket(bank.label, 'borrow')}>{t.borrowButton}</button>
          </li>;
        })}</ul></>}</section>
      </div>
      {address && <WalletHistory wallet={address} reload={historyReload} onOpenTx={onOpenTx} />}
    </>}
  </div>;
}
