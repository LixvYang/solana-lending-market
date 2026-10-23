import { useEffect, useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import type { AccountView, BankView, BuildResponse, SendResponse, WalletAction, WalletView } from '@contract';
import { fmtPct, fmtToken, fmtUsd, toNative } from '../format';
import { previewRisk } from '../risk';
import { b64, chain } from './chain';
import { WalletButton } from './WalletButton';

const minNative = (a: string, b: string) => (BigInt(a) < BigInt(b) ? a : b);

const ACTIONS: { id: WalletAction; label: string; allLabel?: string }[] = [
  { id: 'deposit', label: '存款' }, { id: 'borrow', label: '借款' },
  { id: 'repay', label: '还款', allLabel: '还清全部' }, { id: 'withdraw', label: '取款', allLabel: '取出全部' },
];

/** 固定在资产详情页内操作当前资产;签名前先给本地风险估算,最终以服务端模拟为准。 */
export function ActionForm({ banks, bank, mine, wallet, initialAction, onTransaction, onResult }: {
  banks: BankView[]; bank: BankView; mine: AccountView | null; wallet: WalletView | null; onTransaction: () => void;
  onResult: (result: SendResponse) => void;
  initialAction: WalletAction | null;
}) {
  const { connected, publicKey, signTransaction } = useWallet();
  const address = publicKey?.toBase58() ?? null;
  const [action, setAction] = useState<WalletAction>(initialAction ?? 'deposit');
  const [amount, setAmount] = useState('');
  const [all, setAll] = useState(false);
  const [built, setBuilt] = useState<BuildResponse | null>(null);
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
  const cap = action === 'deposit' ? held : action === 'withdraw' ? position?.deposit ?? '0' : action === 'repay' ? position?.borrow ?? '0' : risk?.maxBorrow == null ? null : minNative(risk.maxBorrow, liquidity);
  const def = ACTIONS.find((a) => a.id === action)!;
  const canBuild = Boolean(address && (all || (native && native !== '0')));
  const health = (value: number | null, assets: number | null) => value == null ? !assets ? '—' : '∞ · 无债务' : value.toFixed(2);
  const healthClass = (value: number | null) => value == null ? '' : value < 1.1 ? 'bad-text' : value < 1.5 ? 'risk-warn' : 'good-text';
  const capacity = risk?.after.borrowCapacityUsed;
  const capClass = capacity == null ? '' : capacity >= 1 ? 'crit' : capacity >= 0.75 ? 'warn' : '';
  const collateral = mine?.balances.filter((b) => b.deposit !== '0') ?? [];

  useEffect(() => { setAction(initialAction ?? 'deposit'); setAmount(''); setAll(false); }, [initialAction, bank.address]);
  useEffect(() => { setBuilt(null); setError(null); }, [action, bank.address, amount, all, address]);

  const preview = async () => {
    if (!address) return;
    setBusy('构建并模拟交易…'); setError(null);
    try { setBuilt(await chain.build({ action, wallet: address, bank: bank.address, amount: native ?? '0', all })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setBuilt(null); }
    finally { setBusy(null); }
  };
  const signAndSend = async () => {
    if (!built || !signTransaction) return;
    setBusy('请在钱包里确认…'); setError(null);
    try {
      const signed = await signTransaction(VersionedTransaction.deserialize(b64.decode(built.transaction)));
      setBusy('发送并等待确认…');
      const result = await chain.send(b64.encode(signed.serialize()));
      onResult(result);
      if (result.status === 'confirmed') { onTransaction(); setAmount(''); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  if (!connected) return <div className="card asset-action"><h2>操作 {bank.label}</h2>
    <p className="muted">连接 devnet 钱包后，可在此存入、借出、还款或取出 {bank.label}。</p><WalletButton /></div>;

  return <div className="card asset-action">
    <h2>操作 {bank.label}</h2>
    <div className="seg wide" role="tablist">{ACTIONS.map((a) => <button key={a.id} role="tab" aria-selected={action === a.id} className={action === a.id ? 'on' : ''} onClick={() => { setAction(a.id); setAll(false); }}>{a.label}</button>)}</div>
    <div className="swap-box">
      <div className="swap-row"><span className="label">{def.label}数量 · {bank.label}</span>
        <span className="muted">{action === 'deposit' ? '钱包' : action === 'withdraw' ? '已存' : action === 'repay' ? '欠款' : '最多可借'} {cap == null ? '—' : fmtToken(cap, bank.decimals, 4)}
          {cap && cap !== '0' && <button className="pill" type="button" onClick={() => { setAll(false); setAmount(fmtToken(cap, bank.decimals, bank.decimals).replace(/,/g, '')); }}>最大</button>}</span></div>
      <div className="swap-row"><input className="amount" inputMode="decimal" placeholder={all ? '全部' : '0'} value={all ? '' : amount} disabled={all} onChange={(e) => setAmount(e.target.value)} aria-label="数量" />
        <span className="asset-fixed"><b>{bank.label}</b></span></div>
      <div className="swap-row muted"><span>{native && bank.price != null ? fmtUsd(Number(native) / 10 ** bank.decimals * bank.price) : ' '}</span>
        <span>{action === 'borrow' ? `借款 APR ${fmtPct(bank.borrowing_apr, 2)}` : action === 'deposit' ? `存款 APR ${fmtPct(bank.lending_apr, 2)}` : ''}</span></div>
    </div>
    {def.allLabel && <label className="field-row check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {def.allLabel}(含利息,由程序精确结算)</label>}
    {action === 'borrow' && position && position.deposit !== '0' && <p className="hint">你在 {bank.label} 里有存款。借款会先扣除同资产存款;想借出其他资产，请用 {bank.label} 做抵押。</p>}
    {!all && amount && !native && <p className="notice bad">数量格式不对,或小数位超过 {bank.decimals} 位。</p>}
    {risk && (!built || built.simulation.ok) && <section className="risk-preview" aria-label="交易后风险预估">
      <div className="risk-health"><div><span className="label">健康因子 · 预估，以模拟为准</span><div><span className={healthClass(risk.before.healthFactor)}>{health(risk.before.healthFactor, risk.before.weightedAssetsMaintUsd)}</span> <span className="muted">→</span> <b className={healthClass(risk.after.healthFactor)}>{health(risk.after.healthFactor, risk.after.weightedAssetsMaintUsd)}</b></div></div>
        {risk.liquidationPrice != null && collateral.length === 1 && <div className="risk-price"><span className="label">参考清算价</span><b>{fmtUsd(risk.liquidationPrice)} / {collateral[0].label}</b></div>}</div>
      <div className="label">已用借款额度 {risk.after.borrowCapacityUsed == null ? '—' : fmtPct(risk.after.borrowCapacityUsed)}</div>
      <div className={`meter ${capClass}`}><i style={{ width: `${Math.max(0, Math.min(100, (capacity ?? 0) * 100))}%` }} /></div>
    </section>}
    {!built && <button className="btn primary block lg" onClick={preview} disabled={!canBuild || Boolean(busy) || Boolean(risk?.blocked)}>{busy ?? (risk?.blocked ?? (canBuild ? `预览${def.label}` : '输入数量'))}</button>}
    {built && <div className="preview">
      <div><b>{built.summary}</b>{built.creates_account && <span className="muted">(同时创建你的 marginfi 账户)</span>}</div>
      {built.simulation.ok ? <div className="ok">✓ 模拟通过{built.simulation.units_consumed ? `,约 ${built.simulation.units_consumed.toLocaleString()} 计算单元` : ''}</div>
        : <div className="bad-text">✗ 模拟失败:{built.simulation.error?.message ?? '未知错误'}{built.simulation.error?.code != null && <span className="muted"> ({built.simulation.error.name} #{built.simulation.error.code})</span>}</div>}
      <div className="row-actions"><button className="btn primary" onClick={signAndSend} disabled={!built.simulation.ok || Boolean(busy)}>{busy ?? '签名并发送'}</button><button className="btn" onClick={() => setBuilt(null)} disabled={Boolean(busy)}>修改</button></div>
    </div>}
    {error && <div className="notice bad">{error}</div>}
  </div>;
}
