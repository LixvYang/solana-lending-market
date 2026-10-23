/** INPUT: Db 最新账户行与 labels。 OUTPUT: 视图组装用的强类型状态。 POSITION: EP7 数据读取边界。 SYNC: 同步 folder.md。 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Db, Row } from '../store/db';
import { fromJson } from '../store/json';
import { marginfiIdl } from '../decoder/idl';
import type { Fixed } from '../decoder/account';
import { feedFromRow, type FeedData } from './oracle-price';
export type { FeedData } from './oracle-price';
export interface BankData {
  mint: string;
  mint_decimals: bigint;
  group: string;
  last_update: bigint;
  asset_share_value: Fixed;
  liability_share_value: Fixed;
  total_asset_shares: Fixed;
  total_liability_shares: Fixed;
  config: {
    asset_weight_init: Fixed;
    asset_weight_maint: Fixed;
    liability_weight_init: Fixed;
    liability_weight_maint: Fixed;
    oracle_setup: Record<string, unknown>;
    oracle_keys: string[];
    interest_rate_config: Record<string, Fixed>;
  };
}
export interface GroupData {
  group_flags: bigint;
  fee_state_cache: {
    program_fee_rate: Fixed;
    program_fee_fixed: Fixed;
  };
}
export interface Position {
  active: boolean;
  bank_pk: string;
  asset_shares: Fixed;
  liability_shares: Fixed;
}
export interface UserData {
  authority: string;
  group: string;
  lending_account: {
    balances: Position[];
  };
}
export interface State {
  rows: Row[];
  sampledSlot?: string | null;
  labels: Record<string, string>;
  banks: Record<string, BankData>;
  groups: Record<string, GroupData>;
  feeds: Record<string, FeedData>;
  users: Record<string, UserData>;
}
/**
 * 数据库里可能有多个 group(多个池子)：每次重跑剧本都会新建一个，--follow 也会把它们全部入库。
 * 设置 POOL_GROUP 后，池子、账户都只看这个 group；不设置时保持原行为(多个 group 并存时 pool.group 为 null，不猜)。
 */
export const poolGroup = () => process.env.POOL_GROUP || null;
/** 没设 POOL_GROUP 时的默认池子:作者在 devnet 上的部署(program/devnet.json)。只在库里真有这个池子时才用,自己部署的人不受影响。 */
function deployedGroup(): string | null {
  try { return (JSON.parse(readFileSync(resolve('program/devnet.json'), 'utf8')) as { group?: string }).group ?? null; } catch { return null; }
}

export async function readState(db: Db): Promise<State> {
  // DISTINCT ON 会扫描并排序全部历史快照；主键 (address, slot) 可逐个跳到地址，再索引倒序取最新一行。
  const rows = (await db.query(`WITH RECURSIVE a(address) AS (
    (SELECT address FROM account_states ORDER BY address LIMIT 1)
    UNION ALL
    SELECT (SELECT address FROM account_states WHERE address > a.address ORDER BY address LIMIT 1)
    FROM a WHERE a.address IS NOT NULL
  )
  SELECT s.* FROM a CROSS JOIN LATERAL (
    SELECT * FROM account_states x WHERE x.address = a.address ORDER BY slot DESC LIMIT 1
  ) s ORDER BY s.address`)).rows;
  const labels = Object.fromEntries((await db.query('SELECT address,label FROM labels')).rows.map(r => [String(r.address), String(r.label)]));
  const cursor = await db.query("SELECT slot FROM ingest_cursor WHERE name='account_snapshot'");
  const state: State = { rows, sampledSlot: cursor.rows[0] ? String(cursor.rows[0].slot) : null, labels, banks: {}, groups: {}, feeds: {}, users: {} };
  for (const row of rows) {
    const address = String(row.address), type = String(row.type), data = row.data as Record<string, unknown>;
    if ('decodeError' in data || 'rawData' in data)
      continue;
    if (type === 'Bank')
      state.banks[address] = fromJson(data, type, marginfiIdl) as BankData;
    if (type === 'MarginfiGroup')
      state.groups[address] = fromJson(data, type, marginfiIdl) as GroupData;
    if (type === 'MarginfiAccount')
      state.users[address] = fromJson(data, type, marginfiIdl) as UserData;
    const feed = feedFromRow(type, String(row.owner), data);
    if (feed)
      state.feeds[address] = feed;
  }
  const fallback = deployedGroup();
  const only = poolGroup() ?? (fallback && Object.values(state.banks).some(b => b.group === fallback) ? fallback : null);
  if (only) {
    state.banks = Object.fromEntries(Object.entries(state.banks).filter(([, b]) => b.group === only));
    state.groups = Object.fromEntries(Object.entries(state.groups).filter(([a]) => a === only));
    state.users = Object.fromEntries(Object.entries(state.users).filter(([, u]) => u.group === only));
  }
  return state;
}
export const shortAddress = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;
export const label = (labels: Record<string, string>, address: string) => labels[address] ?? shortAddress(address);
export const iso = (timestamp: unknown): string | null => timestamp == null ? null : new Date(timestamp as string | number | Date).toISOString();
export const unixIso = (seconds: bigint | string): string => new Date(Number(seconds) * 1000).toISOString();
