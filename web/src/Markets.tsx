import type { PoolView } from '@contract';
import { fmtPct, fmtToken, fmtUsd } from './format';
import { SourceChip, TokenName } from './tokens';
import { goMarket } from './Tabs';
import { useT } from './i18n';

/**
 * 市场列表,版式参照常见借贷前端(Aave / marginfi / Kamino):一行一个资产,存款与借款并排,
 * 每行进入资产详情。窄屏时每行变成一张卡片(CSS 用 data-label 显示列名)。
 */
export function Markets({ pool }: { pool: PoolView }) {
  const { t } = useT();
  const open = (symbol: string) => () => goMarket(symbol);
  return (
    <div className="card flush">
      <div className="card-head"><h2>{t.allAssets}<small>{t.countAssets(pool.banks.length)}</small></h2></div>
      <div className="tablewrap"><table className="markets">
        <thead><tr>
          <th>{t.asset}</th><th className="n">{t.price}</th><th className="n">{t.totalSupplied}</th><th className="n">{t.supplyApr}</th>
          <th className="n">{t.totalBorrowed}</th><th className="n">{t.borrowApr}</th><th>{t.utilization}</th><th className="n">{t.collateralRatio}</th><th />
        </tr></thead>
        <tbody>
          {pool.banks.map((b) => {
            const liquidity = (BigInt(b.total_deposits) - BigInt(b.total_borrows)).toString();
            return (
              <tr key={b.address} className="pick" onClick={open(b.label)}
                  tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && open(b.label)()}>
                <td data-label={t.asset}><TokenName symbol={b.label} /></td>
                <td className="n" data-label={t.price}><div className="price-cell">{fmtUsd(b.price)}<SourceChip source={b.oracle_source} /></div></td>
                <td className="n" data-label={t.totalSupplied}><div>{fmtToken(b.total_deposits, b.decimals, 2)}</div><div className="muted">{fmtUsd(b.total_deposits_usd)}</div></td>
                <td className="n apr apr-supply" data-label={t.supplyApr}>{fmtPct(b.lending_apr, 2)}</td>
                <td className="n" data-label={t.totalBorrowed}><div>{fmtToken(b.total_borrows, b.decimals, 2)}</div><div className="muted">{fmtUsd(b.total_borrows_usd)}</div></td>
                <td className="n apr apr-borrow" data-label={t.borrowApr}>{fmtPct(b.borrowing_apr, 2)}</td>
                <td data-label={t.utilization}>
                  <div className="util"><div className={`meter ${b.utilization > 0.95 ? 'crit' : b.utilization > 0.8 ? 'warn' : ''}`}><i style={{ width: `${Math.min(100, b.utilization * 100)}%` }} /></div>
                    <span>{fmtPct(b.utilization)}</span></div>
                  <div className="muted">{t.availableToBorrow} {fmtToken(liquidity, b.decimals, 2)}</div>
                </td>
                <td className="n" data-label={t.collateralRatio}>{fmtPct(b.weights.asset_init, 0)}</td>
                <td className="actions" aria-hidden="true">›</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </div>
  );
}
