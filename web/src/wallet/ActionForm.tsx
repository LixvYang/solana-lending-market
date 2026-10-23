import { useEffect, useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import type { AccountView, BankView, BuildResponse, SendResponse, WalletAction, WalletView } from '@contract';
import { fmtPct, fmtToken, fmtUsd, toNative } from '../format';
import { previewRisk } from '../risk';
import { b64, chain } from './chain';
import { WalletButton } from './WalletButton';
import { errorText, programErrorText, useT } from '../i18n';

const minNative = (a: string, b: string) => (BigInt(a) < BigInt(b) ? a : b);
const programMessage = (error: BuildResponse['simulation']['error'], t: ReturnType<typeof useT>['t']) => programErrorText(error, t);

/** 固定在资产详情页内操作当前资产;本地显示风险预估,签名前由服务端模拟。 */
export function ActionForm({ banks, bank, mine, wallet, initialAction, onTransaction, onResult, syncStatus }: {
  banks: BankView[]; bank: BankView; mine: AccountView | null; wallet: WalletView | null; onTransaction: () => void;
  onResult: (result: SendResponse) => void;
  initialAction: WalletAction | null;
  syncStatus?: string | null;
}) {
  const { t } = useT();
  const { connected, publicKey, signTransaction } = useWallet();
  const address = publicKey?.toBase58() ?? null;
  const [action, setAction] = useState<WalletAction>(initialAction ?? 'deposit');
  const [amount, setAmount] = useState('');
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const position = mine?.balances.find((b) => b.bank === bank.address);
  const held = wallet ? wallet.tokens.find((t) => t.mint === bank.mint)?.amount ?? '0' : null;
  const native = toNative(amount, bank.decimals);
  // 借款上限同时受健康度和池子剩余流动性限制;只看前者时，池子快被借空时"最大"会填出程序必拒的数。
  const liquidity = (BigInt(bank.total_deposits) - BigInt(bank.total_borrows)).toString();
  const riskAmount = all ? action === 'repay' ? position?.borrow ?? '0' : action === 'withdraw' ? position?.deposit ?? '0' : '0' : native ?? '0';
  const risk = useMemo(() => {
    try { return previewRisk(banks, mine?.balances ?? [], { action, bank: bank.address, amount: riskAmount }); }
    catch { return null; }
  }, [banks, mine, action, bank.address, riskAmount]);
  const hasRiskAmount = all ? riskAmount !== '0' : native != null && BigInt(native) > 0n;
  const cap = action === 'deposit' ? held : action === 'withdraw' ? position?.deposit ?? '0' : action === 'repay' ? position?.borrow ?? '0' : risk?.maxBorrow == null ? null : minNative(risk.maxBorrow, liquidity);
  const actions: { id: WalletAction; label: string; verb: string }[] = [
    { id: 'deposit', label: t.actionDeposit, verb: t.supplyVerb }, { id: 'borrow', label: t.actionBorrow, verb: t.borrowVerb },
    { id: 'repay', label: t.actionRepay, verb: t.actionRepay }, { id: 'withdraw', label: t.actionWithdraw, verb: t.withdrawVerb },
  ];
  const def = actions.find((a) => a.id === action)!;
  const canBuild = Boolean(address && (all || (native && native !== '0')));
  // 只有前后差异小于 0.1 个百分点时显示两位，避免看起来没有变化。
  const digits = risk && risk.before.healthPercent != null && risk.after.healthPercent != null && risk.before.healthPercent !== risk.after.healthPercent
    && risk.before.healthPercent.toFixed(1) === risk.after.healthPercent.toFixed(1) ? 2 : 1;
  const health = (value: number | null) => value == null ? '—' : `${value.toFixed(digits)}%${value <= 0 ? ` ${t.liquidatable}` : ''}`;
  const healthClass = (value: number | null) => value == null ? '' : value <= 0 || value < 10 ? 'bad-text' : value < 30 ? 'risk-warn' : 'good-text';
  const capacity = risk?.after.borrowCapacityUsed;
  const capClass = capacity == null ? '' : capacity >= 1 ? 'crit' : capacity >= 0.75 ? 'warn' : '';
  const collateral = mine?.balances.filter((b) => b.deposit !== '0') ?? [];

  useEffect(() => { setAction(initialAction ?? 'deposit'); setAmount(''); setAll(false); }, [initialAction, bank.address]);
  useEffect(() => { setError(null); }, [action, bank.address, amount, all, address]);

  const signAndSend = async () => {
    if (!address) return;
    setBusy(t.buildSimulate); setError(null);
    try {
      const built: BuildResponse = await chain.build({ action, wallet: address, bank: bank.address, amount: native ?? '0', all });
      if (!built.simulation.ok) { setError(t.simulationFailed(programMessage(built.simulation.error, t))); return; }
      if (!signTransaction) { setError(t.walletCannotSign); return; }
      setBusy(t.confirmInWallet);
      const signed = await signTransaction(VersionedTransaction.deserialize(b64.decode(built.transaction)));
      setBusy(t.sending);
      const result = await chain.send(b64.encode(signed.serialize()));
      onResult(result);
      if (result.status === 'confirmed') { onTransaction(); setAmount(''); }
    } catch (e) { setError(errorText(e, t)); }
    finally { setBusy(null); }
  };

  if (!connected) return <div className="card asset-action">{syncStatus && <div className="sync-status" role="status">{syncStatus}</div>}<WalletButton /></div>;

  return <div className="card asset-action">
    {syncStatus && <div className="sync-status" role="status">{syncStatus}</div>}
    <div className="seg wide" role="tablist">{actions.map((a) => <button key={a.id} role="tab" aria-selected={action === a.id} className={action === a.id ? 'on' : ''} onClick={() => { setAction(a.id); setAll(false); }}>{a.label}</button>)}</div>
    <div className="swap-box">
    <div className="swap-row"><span className="label">{t.actionAmount(def.label)}</span>
        <span className="muted">{action === 'deposit' ? t.wallet : action === 'withdraw' ? t.supplied : action === 'repay' ? t.debt : t.borrowMax} {cap == null ? '—' : fmtToken(cap, bank.decimals, 4)}
          {cap && cap !== '0' && <button className="pill" type="button" onClick={() => {
            if (action === 'repay' || action === 'withdraw') { setAll(true); setAmount(''); }
            else { setAll(false); setAmount(fmtToken(cap, bank.decimals, bank.decimals).replace(/,/g, '')); }
          }}>{t.max}</button>}</span></div>
      <div className="swap-row"><input className="amount" inputMode="decimal" placeholder="0" value={all ? t.all : amount} onChange={(e) => { setAll(false); setAmount(e.target.value); }} aria-label={t.amount} />
        <span className="asset-fixed"><b>{bank.label}</b></span></div>
      <div className="swap-row muted"><span>{native && bank.price != null ? fmtUsd(Number(native) / 10 ** bank.decimals * bank.price) : ' '}</span>
        <span>{action === 'borrow' ? t.borrowAprText(fmtPct(bank.borrowing_apr, 2)) : action === 'deposit' ? t.supplyAprText(fmtPct(bank.lending_apr, 2)) : ''}</span></div>
    </div>
    {action === 'borrow' && position && position.deposit !== '0' && <p className="hint">{t.depositOffsetsDebt(bank.label)}</p>}
    {!all && amount && !native && <p className="notice bad">{t.invalidPrecision(bank.decimals)}</p>}
    {risk && hasRiskAmount && <section className="risk-preview" aria-label={t.riskPreview}>
      <div className="risk-health"><div><span className="label">{t.healthFactor}</span><div><span className={healthClass(risk.before.healthPercent)}>{health(risk.before.healthPercent)}</span> <span className="muted">→</span> <b className={healthClass(risk.after.healthPercent)}>{health(risk.after.healthPercent)}</b></div></div>
        {risk.liquidationPrice != null && collateral.length === 1 && <div className="risk-price"><span className="label">{t.referenceLiquidationPrice}</span><b>{fmtUsd(risk.liquidationPrice)} / {collateral[0].label}</b></div>}</div>
      <div className="label">{t.borrowPowerUsed} {risk.after.borrowCapacityUsed == null ? '—' : fmtPct(risk.after.borrowCapacityUsed)}</div>
      <div className={`meter ${capClass}`}><i style={{ width: `${Math.max(0, Math.min(100, (capacity ?? 0) * 100))}%` }} /></div>
    </section>}
    {error && <div className="notice bad">{error}</div>}
    <button className="btn primary block lg" onClick={signAndSend} disabled={!canBuild || Boolean(busy) || Boolean(risk?.blocked)}>
      {busy ?? (risk?.blocked ? t.overLimit : (canBuild ? `${def.verb} ${all ? t.all : fmtToken(native ?? '0', bank.decimals, 4)} ${bank.label}` : t.enterQuantity))}
    </button>
  </div>;
}
