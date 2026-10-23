/** INPUT: 清算事件、raw_tx 时间、地址标签。 OUTPUT: 按 bank 过滤的清算记录。 POSITION: EP7 清算只读视图。 SYNC: 同步 folder.md。 */
import { poolGroup } from './state';
import type { Db } from '../store/db';
import type { LiquidationItem } from './types';
import { iso } from './state';

type LiquidationData = {
  liquidatee_marginfi_account: string;
  asset_bank: string;
  liability_bank: string;
  pre_balances: { liquidatee_asset_balance: number; liquidatee_liability_balance: number };
  post_balances: { liquidatee_asset_balance: number; liquidatee_liability_balance: number };
  liquidatee_pre_health: number;
  liquidatee_post_health: number;
};

export async function getLiquidations(db: Db, { bank }: { bank?: string } = {}): Promise<LiquidationItem[]> {
  const group = poolGroup();
  const params: unknown[] = [];
  const bankFilter = bank ? (params.push(bank), `AND (e.data->>'asset_bank'=$${params.length} OR e.data->>'liability_bank'=$${params.length})`) : '';
  const groupFilter = group ? (params.push(group), `AND e.data->'header'->>'marginfi_group'=$${params.length}`) : '';
  const rows = (await db.query(`SELECT e.signature,e.ix_index,e.log_index,e.data,r.slot,r.block_time
    FROM events e JOIN raw_tx r USING(signature)
    WHERE e.name='LendingAccountLiquidateEvent' ${bankFilter} ${groupFilter}
    ORDER BY r.slot DESC,e.ix_index DESC,e.log_index DESC`, params)).rows;
  const labels = Object.fromEntries((await db.query('SELECT address,label FROM labels')).rows.map(row => [String(row.address), String(row.label)]));
  return rows.map(row => {
    const data = row.data as LiquidationData;
    const pre = data.pre_balances, post = data.post_balances;
    return {
      signature: String(row.signature), slot: String(row.slot), block_time: iso(row.block_time), ix_index: Number(row.ix_index),
      liquidatee_account: String(data.liquidatee_marginfi_account),
      liquidatee_label: labels[String(data.liquidatee_marginfi_account)] ?? null,
      asset_bank: String(data.asset_bank), asset_label: labels[String(data.asset_bank)] ?? null,
      liability_bank: String(data.liability_bank), liability_label: labels[String(data.liability_bank)] ?? null,
      seized_asset: Number(pre.liquidatee_asset_balance) - Number(post.liquidatee_asset_balance),
      repaid_liability: Number(pre.liquidatee_liability_balance) - Number(post.liquidatee_liability_balance),
      pre_health: Number(data.liquidatee_pre_health), post_health: Number(data.liquidatee_post_health),
    };
  });
}
