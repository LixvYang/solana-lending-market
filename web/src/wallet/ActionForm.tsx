import { useEffect, useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import type { AccountView, BankView, BuildResponse, SendResponse, WalletAction, WalletView } from '@contract';
import { fmtPct, fmtToken, fmtUsd, toNative } from '../format';
import { previewRisk } from '../risk';
import { b64, chain } from './chain';
import { WalletButton } from './WalletButton';

const minNative = (a: string, b: string) => (BigInt(a) < BigInt(b) ? a : b);

// label 用在分段切换与数量标题(名词);verb 用在主按钮(动作 + 数量，如"存入 5 tUSDC")。
const ACTIONS: { id: WalletAction; label: string; verb: string }[] = [
  { id: 'deposit', label: '存款', verb: '存入' }, { id: 'borrow', label: '借款', verb: '借出' },
  { id: 'repay', label: '还款', verb: '还款' }, { id: 'withdraw', label: '取款', verb: '取出' },
];

/** 固定在资产详情页内操作当前资产;本地显示风险预估,签名前由服务端模拟。 */
export function ActionForm({ banks, bank, mine, wallet, initialAction, onTransaction, onResult, syncStatus }: {
  banks: BankView[]; bank: BankView; mine: AccountView | null; wallet: WalletView | null; onTransaction: () => void;
  onResult: (result: SendResponse) => void;
  initialAction: WalletAction | null;
  syncStatus?: string | null;
}) {
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
  const def = ACTIONS.find((a) => a.id === action)!;
  const canBuild = Boolean(address && (all || (native && native !== '0')));
  // 前后两个值保留两位小数看不出变化(如债务 2271、再借 2.1:1.1797 → 1.1786)时用三位，否则会显示"1.18 → 1.18"像没算。
  const digits = risk && risk.before.healthFactor != null && risk.after.healthFactor != null && risk.before.healthFactor !== risk.after.healthFactor
    && risk.before.healthFactor.toFixed(2) === risk.after.healthFactor.toFixed(2) ? 3 : 2;
  const health = (value: number | null, assets: number | null) => value == null ? !assets ? '—' : '∞ 无债务' : value.toFixed(digits);
  const healthClass = (value: number | null) => value == null ? '' : value < 1.1 ? 'bad-text' : value < 1.5 ? 'risk-warn' : 'good-text';
  const capacity = risk?.after.borrowCapacityUsed;
  const capClass = capacity == null ? '' : capacity >= 1 ? 'crit' : capacity >= 0.75 ? 'warn' : '';
  const collateral = mine?.balances.filter((b) => b.deposit !== '0') ?? [];

  useEffect(() => { setAction(initialAction ?? 'deposit'); setAmount(''); setAll(false); }, [initialAction, bank.address]);
  useEffect(() => { setError(null); }, [action, bank.address, amount, all, address]);

  const signAndSend = async () => {
    if (!address) return;
    setBusy('构建并模拟交易…'); setError(null);
    try {
      const built: BuildResponse = await chain.build({ action, wallet: address, bank: bank.address, amount: native ?? '0', all });
      if (!built.simulation.ok) { setError(`模拟失败：${built.simulation.error?.message ?? '未知错误'}`); return; }
      if (!signTransaction) { setError('当前钱包不支持交易签名'); return; }
      setBusy('请在钱包里确认…');
      const signed = await signTransaction(VersionedTransaction.deserialize(b64.decode(built.transaction)));
      setBusy('发送并等待确认…');
      const result = await chain.send(b64.encode(signed.serialize()));
      onResult(result);
      if (result.status === 'confirmed') { onTransaction(); setAmount(''); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  if (!connected) return <div className="card asset-action">{syncStatus && <div className="sync-status" role="status">{syncStatus}</div>}<WalletButton /></div>;

  return <div className="card asset-action">
    {syncStatus && <div className="sync-status" role="status">{syncStatus}</div>}
    <div className="seg wide" role="tablist">{ACTIONS.map((a) => <button key={a.id} role="tab" aria-selected={action === a.id} className={action === a.id ? 'on' : ''} onClick={() => { setAction(a.id); setAll(false); }}>{a.label}</button>)}</div>
    <div className="swap-box">
    <div className="swap-row"><span className="label">{def.label}数量</span>
        <span className="muted">{action === 'deposit' ? '钱包' : action === 'withdraw' ? '已存' : action === 'repay' ? '欠款' : '最多可借'} {cap == null ? '—' : fmtToken(cap, bank.decimals, 4)}
          {cap && cap !== '0' && <button className="pill" type="button" onClick={() => {
            if (action === 'repay' || action === 'withdraw') { setAll(true); setAmount(''); }
            else { setAll(false); setAmount(fmtToken(cap, bank.decimals, bank.decimals).replace(/,/g, '')); }
          }}>最大</button>}</span></div>
      <div className="swap-row"><input className="amount" inputMode="decimal" placeholder="0" value={all ? '全部' : amount} onChange={(e) => { setAll(false); setAmount(e.target.value); }} aria-label="数量" />
        <span className="asset-fixed"><b>{bank.label}</b></span></div>
      <div className="swap-row muted"><span>{native && bank.price != null ? fmtUsd(Number(native) / 10 ** bank.decimals * bank.price) : ' '}</span>
        <span>{action === 'borrow' ? `借款 APR ${fmtPct(bank.borrowing_apr, 2)}` : action === 'deposit' ? `存款 APR ${fmtPct(bank.lending_apr, 2)}` : ''}</span></div>
    </div>
    {action === 'borrow' && position && position.deposit !== '0' && <p className="hint">你在 {bank.label} 里有存款。借款会先扣除同资产存款;想借出其他资产，请用 {bank.label} 做抵押。</p>}
    {!all && amount && !native && <p className="notice bad">数量格式不对,或小数位超过 {bank.decimals} 位。</p>}
    {risk && hasRiskAmount && <section className="risk-preview" aria-label="交易后风险预估">
      <div className="risk-health"><div><span className="label">健康因子</span><div><span className={healthClass(risk.before.healthFactor)}>{health(risk.before.healthFactor, risk.before.weightedAssetsMaintUsd)}</span> <span className="muted">→</span> <b className={healthClass(risk.after.healthFactor)}>{health(risk.after.healthFactor, risk.after.weightedAssetsMaintUsd)}</b></div></div>
        {risk.liquidationPrice != null && collateral.length === 1 && <div className="risk-price"><span className="label">参考清算价</span><b>{fmtUsd(risk.liquidationPrice)} / {collateral[0].label}</b></div>}</div>
      <div className="label">已用借款额度 {risk.after.borrowCapacityUsed == null ? '—' : fmtPct(risk.after.borrowCapacityUsed)}</div>
      <div className={`meter ${capClass}`}><i style={{ width: `${Math.max(0, Math.min(100, (capacity ?? 0) * 100))}%` }} /></div>
    </section>}
    {error && <div className="notice bad">{error}</div>}
    <button className="btn primary block lg" onClick={signAndSend} disabled={!canBuild || Boolean(busy) || Boolean(risk?.blocked)}>
      {busy ?? (risk?.blocked ?? (canBuild ? `${def.verb} ${all ? '全部' : fmtToken(native ?? '0', bank.decimals, 4)} ${bank.label}` : '输入数量'))}
    </button>
  </div>;
}
