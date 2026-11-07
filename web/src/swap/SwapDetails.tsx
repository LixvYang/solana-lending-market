import { fmtToken, fmtUsd } from '../format';
import type { SwapAsset, SwapRatesView, WalletView } from '@contract';
import { useT } from '../i18n';

export function SwapDetails({ rates, from, to, invert, onInvert, open, onOpen, wallet }: {
  rates: SwapRatesView; from: SwapAsset; to: SwapAsset; invert: boolean; onInvert: () => void;
  open: boolean; onOpen: () => void; wallet: WalletView | null;
}) {
  const { t } = useT();
  const source = rates.assets.find(item => item.symbol === (invert ? to : from));
  const target = rates.assets.find(item => item.symbol === (invert ? from : to));
  if (!source?.usd || !target?.usd) return null;
  const rate = Number(source.usd) / Number(target.usd);
  const targetAsset = rates.assets.find(item => item.symbol === to)!;
  const needsAccount = targetAsset.mint !== null && wallet !== null && !wallet.tokens.some(token => token.mint === targetAsset.mint && token.has_account);
  const rent = needsAccount ? t.openAccountRent('0.00204') : null;
  return <>
    <div className="swap-summary">
      <button className="linkish" onClick={onInvert} type="button" aria-label={t.rate}>{`1 ${invert ? to : from} ≈ ${Number(rate.toPrecision(4))} ${invert ? from : to} ⇄`}</button>
      <span className="swap-cost"><span>{t.feeEstimate}</span>{rent && <span>{rent}</span>}</span>
      <button className="swap-expand" onClick={onOpen} type="button" aria-expanded={open} aria-label={open ? t.hideDetails : t.showDetails}>
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d={open ? 'm2 7 4-4 4 4' : 'm2 4 4 4 4-4'} /></svg>
      </button>
    </div>
    {open && <dl className="swap-details">
      <div><dt>{t.unitPrice}</dt><dd>{from} {fmtUsd(Number(rates.assets.find(item => item.symbol === from)?.usd ?? 0))}, {to} {fmtUsd(Number(rates.assets.find(item => item.symbol === to)?.usd ?? 0))}</dd></div>
      <div><dt>{t.slippage}</dt><dd>{t.noSlippage}</dd></div>
      <div><dt>{t.swapDesk}</dt><dd>{t.oracleExecution}</dd></div>
      <div><dt>{t.deskAvailable}</dt><dd>{fmtToken(targetAsset.desk_available, targetAsset.decimals, 4)} {to}</dd></div>
      <div><dt>{t.tradeLimit}</dt><dd>${rates.min_usd} – ${rates.max_usd}</dd></div>
    </dl>}
  </>;
}
