/** INPUT: 已索引事件与 desk_events。 OUTPUT: 某钱包的合并、游标分页历史。 */
import type { Db } from '../store/db';
import type { DeskLeg } from '../store/desk-events';
import { ApiError } from './errors';
import { iso, poolGroup } from './state';

export type WalletHistoryKind = 'deposit' | 'borrow' | 'repay' | 'withdraw' | 'liquidated' | 'liquidator' | 'swap' | 'faucet';
export interface WalletHistoryItem {
  time: string | null; kind: WalletHistoryKind; assets: DeskLeg[]; result: string;
  signature: string; detail: boolean;
}
export interface WalletHistoryPage { items: WalletHistoryItem[]; next_before: string | null }
type Cursor = { time: string; signature: string; ix: number; source: 'loan' | 'desk' };
const limitOf = (value: number) => {
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new ApiError(400, 'limit must be between 1 and 100');
  return value;
};
const pack = (value: Cursor) => Buffer.from(JSON.stringify(value)).toString('base64url');
function unpack(value?: string): Cursor | null {
  if (!value) return null;
  try {
    const c = JSON.parse(Buffer.from(value, 'base64url').toString()) as Cursor;
    if (!Number.isFinite(Date.parse(c.time)) || typeof c.signature !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{1,88}$/.test(c.signature)
      || !Number.isInteger(c.ix) || !['loan', 'desk'].includes(c.source)) throw Error();
    return c;
  } catch { throw new ApiError(400, 'invalid history cursor'); }
}
const descending = (a: string, b: string) => a === b ? 0 : a < b ? 1 : -1;
const compare = (a: Cursor, b: Cursor) => Date.parse(b.time) - Date.parse(a.time)
  || descending(a.signature, b.signature) || b.ix - a.ix || descending(a.source, b.source);

const instructionKinds: Record<string, WalletHistoryKind> = {
  lending_account_deposit: 'deposit', lending_account_borrow: 'borrow',
  lending_account_repay: 'repay', lending_account_withdraw: 'withdraw',
};

export async function getWalletHistory(db: Db, wallet: string, options: { before?: string; limit?: number } = {}): Promise<WalletHistoryPage> {
  const limit = limitOf(options.limit ?? 20), cursor = unpack(options.before);
  const cursorParams = cursor ? [cursor.time, cursor.signature, cursor.ix, cursor.source] : [];
  const owned = `SELECT address FROM account_states WHERE type='MarginfiAccount' AND data->>'authority'=$1`;
  // 剧本账户由固定种子派生，每次重跑都在新池子留下记录;设置 POOL_GROUP 时只看当前池子(与 /api/activity 一致)。
  const group = poolGroup(), groupParam = cursor ? 7 : 3;
  const loanSql = `SELECT i.signature,COALESCE(r.block_time,e.block_time,'epoch'::timestamptz) AS time,i.ix_index,
      i.name AS instruction,i.args,i.accounts,e.data AS event,r.err,'loan' AS source
    FROM instructions i JOIN raw_tx r USING(signature)
    LEFT JOIN events e ON e.signature=i.signature AND e.ix_index=i.ix_index AND e.name=CASE i.name
      WHEN 'lending_account_deposit' THEN 'LendingAccountDepositEvent' WHEN 'lending_account_borrow' THEN 'LendingAccountBorrowEvent'
      WHEN 'lending_account_repay' THEN 'LendingAccountRepayEvent' WHEN 'lending_account_withdraw' THEN 'LendingAccountWithdrawEvent'
      WHEN 'lending_account_liquidate' THEN 'LendingAccountLiquidateEvent' END
    WHERE i.inner_index=-1 AND i.name IN ('lending_account_deposit','lending_account_borrow','lending_account_repay','lending_account_withdraw','lending_account_liquidate')
      ${group ? `AND (i.accounts->>'marginfi_group'=$${groupParam} OR i.accounts->>'group'=$${groupParam})` : ''}
      AND (COALESCE(i.accounts->>'marginfi_account',i.accounts->>'liquidator_marginfi_account') IN (${owned})
        OR (i.name='lending_account_liquidate' AND e.data->>'liquidatee_marginfi_account' IN (${owned})))
      ${cursor ? `AND (COALESCE(r.block_time,e.block_time,'epoch'::timestamptz),i.signature COLLATE "C",i.ix_index,'loan') < ($2::timestamptz,$3::text COLLATE "C",$4::int,$5::text)` : ''}
    ORDER BY time DESC,i.signature COLLATE "C" DESC,i.ix_index DESC LIMIT $${cursor ? 6 : 2}`;
  const deskSql = `SELECT signature,created_at AS time,-1 AS ix_index,kind,from_symbol,from_amount,from_decimals,to_symbol,to_amount,to_decimals,details,status,'desk' AS source
    FROM desk_events WHERE wallet=$1 ${cursor ? `AND (created_at,signature COLLATE "C",-1,'desk') < ($2::timestamptz,$3::text COLLATE "C",$4::int,$5::text)` : ''}
    ORDER BY created_at DESC,signature COLLATE "C" DESC LIMIT $${cursor ? 6 : 2}`;
  const [loan, desk] = await Promise.all([
    db.query(loanSql, [wallet, ...cursorParams, limit + 1, ...(group ? [group] : [])]),
    db.query(deskSql, [wallet, ...cursorParams, limit + 1]),
  ]);
  const labels = Object.fromEntries((await db.query('SELECT address,label FROM labels')).rows.map(r => [String(r.address), String(r.label)]));
  const decimals = Object.fromEntries((await db.query("SELECT address,data->>'mint_decimals' AS decimals FROM account_states WHERE type='Bank'")).rows
    .map(r => [String(r.address), Number(r.decimals ?? 0)]));
  const rows: { cursor: Cursor; item: WalletHistoryItem }[] = [];
  for (const row of loan.rows) {
    const data = (row.event as Record<string, any> | null) ?? {}, name = String(row.instruction), args = row.args as Record<string, unknown>;
    const time = iso(row.time);
    const victim = String(data.liquidatee_marginfi_account ?? ''), ownVictim = name === 'lending_account_liquidate'
      && (await db.query(`SELECT 1 FROM (${owned}) a WHERE address=$2 LIMIT 1`, [wallet, victim])).rowCount > 0;
    const kind: WalletHistoryKind = name === 'lending_account_liquidate' ? ownVictim ? 'liquidated' : 'liquidator' : instructionKinds[name];
    const bank = String(data.bank ?? data.asset_bank ?? (row.accounts as Record<string, unknown>).bank ?? '');
    const symbol = labels[bank] ?? bank, amount = data.amount ?? args?.amount ?? null;
    // 清算事件的余额是 f64(如 475000000.00000095),差值取整成原生单位整数，前端按整数格式化。
    const assets: DeskLeg[] = kind === 'liquidated' || kind === 'liquidator'
      ? [
        { symbol: labels[String(data.asset_bank)] ?? String(data.asset_bank), amount: String(Math.round(Number(data.pre_balances?.liquidatee_asset_balance ?? 0) - Number(data.post_balances?.liquidatee_asset_balance ?? 0))), decimals: decimals[String(data.asset_bank)] ?? 0 },
        { symbol: labels[String(data.liability_bank)] ?? String(data.liability_bank), amount: String(Math.round(Number(data.pre_balances?.liquidatee_liability_balance ?? 0) - Number(data.post_balances?.liquidatee_liability_balance ?? 0))), decimals: decimals[String(data.liability_bank)] ?? 0 },
      ] : amount == null ? [] : [{ symbol, amount: String(amount), decimals: decimals[bank] ?? 0 }];
    rows.push({ cursor: { time: time ?? new Date(0).toISOString(), signature: String(row.signature), ix: Number(row.ix_index), source: 'loan' },
      item: { time, kind, assets, result: row.err == null ? 'success' : 'failed', signature: String(row.signature), detail: true } });
  }
  for (const row of desk.rows) {
    const time = iso(row.time), kind = String(row.kind) as 'swap' | 'faucet';
    const details = Array.isArray(row.details) ? row.details as DeskLeg[] : [];
    const assets: DeskLeg[] = kind === 'swap'
      ? [{ symbol: String(row.from_symbol), amount: String(row.from_amount), decimals: Number(row.from_decimals ?? 0) },
        { symbol: String(row.to_symbol), amount: String(row.to_amount), decimals: Number(row.to_decimals ?? 0) }]
      : details;
    rows.push({ cursor: { time: time ?? new Date(0).toISOString(), signature: String(row.signature), ix: -1, source: 'desk' },
      item: { time, kind, assets, result: row.status === 'confirmed' ? 'success' : String(row.status), signature: String(row.signature), detail: false } });
  }
  rows.sort((a, b) => compare(a.cursor, b.cursor));
  const page = rows.slice(0, limit), last = page.at(-1);
  return { items: page.map(row => row.item), next_before: rows.length > limit && last ? pack(last.cursor) : null };
}
