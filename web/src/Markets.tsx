import type { PoolView } from '@contract';
import { fmtPct, fmtToken, fmtUsd } from './format';
import { SourceChip, TokenName } from './tokens';
import { goMarket } from './Tabs';

/**
 * 市场列表,版式参照常见借贷前端(Aave / marginfi / Kamino):一行一个资产,存款与借款并排,
 * 每行进入资产详情。窄屏时每行变成一张卡片(CSS 用 data-label 显示列名)。
 */
export function Markets({ pool }: { pool: PoolView }) {
  const open = (symbol: string) => () => goMarket(symbol);
  return (
    <div className="card flush">
      <div className="card-head"><h2>全部资产<small>{pool.banks.length} 个</small></h2></div>
      <div className="tablewrap"><table className="markets">
        <thead><tr>
          <th>资产</th><th className="n">价格</th><th className="n">总存款</th><th className="n">存款 APR</th>
          <th className="n">总借款</th><th className="n">借款 APR</th><th>利用率</th><th className="n">抵押率</th><th />
        </tr></thead>
        <tbody>
          {pool.banks.map((b) => {
            const liquidity = (BigInt(b.total_deposits) - BigInt(b.total_borrows)).toString();
            return (
              <tr key={b.address} className="pick" onClick={open(b.label)}
                  tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && open(b.label)()}>
                <td data-label="资产"><TokenName symbol={b.label} /></td>
                <td className="n" data-label="价格"><div>{fmtUsd(b.price)}</div><SourceChip source={b.oracle_source} /></td>
                <td className="n" data-label="总存款"><div>{fmtToken(b.total_deposits, b.decimals, 2)}</div><div className="muted">{fmtUsd(b.total_deposits_usd)}</div></td>
                <td className="n apr good" data-label="存款 APR">{fmtPct(b.lending_apr, 2)}</td>
                <td className="n" data-label="总借款"><div>{fmtToken(b.total_borrows, b.decimals, 2)}</div><div className="muted">{fmtUsd(b.total_borrows_usd)}</div></td>
                <td className="n apr" data-label="借款 APR">{fmtPct(b.borrowing_apr, 2)}</td>
                <td data-label="利用率">
                  <div className="util"><div className={`meter ${b.utilization > 0.95 ? 'crit' : b.utilization > 0.8 ? 'warn' : ''}`}><i style={{ width: `${Math.min(100, b.utilization * 100)}%` }} /></div>
                    <span>{fmtPct(b.utilization)}</span></div>
                  <div className="muted">可借 {fmtToken(liquidity, b.decimals, 2)}</div>
                </td>
                <td className="n" data-label="抵押率">{fmtPct(b.weights.asset_init, 0)}</td>
                <td className="actions" aria-hidden="true">›</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </div>
  );
}
