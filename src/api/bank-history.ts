/** INPUT: Db 中 Bank、Group、预言机与交易历史快照。 OUTPUT: 银行变化点及对应的池状态指标。 POSITION: EP7 历史曲线查询。 SYNC: 同步 folder.md。 */
import type { Db, Row } from '../store/db';
import { fromJson } from '../store/json';
import { marginfiIdl } from '../decoder/idl';
import { oracleAccountOf } from '../oracle/pyth';
import { bankView } from './bank';
import { feedFromRow, type FeedData } from './oracle-price';
import { readState, type BankData, type GroupData } from './state';
import type { BankHistoryView } from './types';

// 某账户在 slot 时刻的最新一行：主键 (address, slot) 倒序取 1 行，约 0.05 ms。
// 不要把整段历史读进内存再二分：Group/价格账户各有约 8500 行快照，全部解码要 1 秒以上。
async function rowAt(db: Db, address: string, slot: string, types: string[]): Promise<Row | null> {
  const rows = (await db.query(`SELECT slot,type,owner,data FROM account_states WHERE address=$1 AND slot<=$2 AND type = ANY($3::text[])
    ORDER BY slot DESC LIMIT 1`, [address, slot, types])).rows;
  return rows[0] ?? null;
}

/**
 * 银行历史只在银行状态变化时改变，而一变化，这个银行最新快照的 slot 就前进——用它当缓存键，失效是精确的，
 * 不会让用户看到旧数据。找变化点的查询要读该银行的全部快照(存量重复多时数百毫秒),所以值得缓存。
 */
// 按数据库实例分开(测试里同一进程会建多个内容不同、地址相同的库)。
const caches = new WeakMap<Db, Map<string, { slot: string; view: BankHistoryView }>>();

export async function getBankHistory(db: Db, address: string): Promise<BankHistoryView | null> {
  const current = await readState(db), bank = current.banks[address];
  if (!bank) return null;
  const latest = String(current.rows.find(r => String(r.address) === address)?.slot ?? '');
  const cache = caches.get(db) ?? new Map<string, { slot: string; view: BankHistoryView }>();
  caches.set(db, cache);
  const hit = cache.get(address);
  if (hit && hit.slot === latest) return hit.view;
  const history = (await db.query(`WITH snapshots AS (
    SELECT slot,data,lag(data) OVER (ORDER BY slot) AS previous
    FROM account_states WHERE address=$1 AND type='Bank'
  ) SELECT s.slot,s.data,
      (SELECT block_time FROM raw_tx WHERE slot<=s.slot AND block_time IS NOT NULL ORDER BY slot DESC LIMIT 1) AS block_time
    FROM snapshots s WHERE previous IS DISTINCT FROM data ORDER BY slot`, [address])).rows;
  const decoded = history.map(row => ({ row, data: fromJson(row.data, 'Bank', marginfiIdl) as BankData }));
  const points = [];
  for (const { row, data } of decoded) {
    const slot = String(row.slot), groupRow = await rowAt(db, data.group, slot, ['MarginfiGroup']);
    if (!groupRow) continue;
    const group = fromJson(groupRow.data, 'MarginfiGroup', marginfiIdl) as GroupData;
    const feeds: Record<string, FeedData> = {};
    const feedAddress = oracleAccountOf(data.config);
    if (feedAddress) {
      const feedRow = await rowAt(db, feedAddress, slot, ['switchboardPullFeed', 'pythPriceUpdate']);
      const feed = feedRow && feedFromRow(String(feedRow.type), String(feedRow.owner), fromJson(feedRow.data, String(feedRow.type), marginfiIdl) as Record<string, unknown>);
      if (feed) feeds[feedAddress] = feed;
    }
    const view = bankView(address, data, { rows: [], labels: current.labels, banks: {}, groups: { [data.group]: group }, feeds, users: {} });
    points.push({ slot, block_time: row.block_time == null ? null : new Date(row.block_time as string | Date).toISOString(),
      total_deposits: view.total_deposits, total_borrows: view.total_borrows,
      total_deposits_usd: view.total_deposits_usd, total_borrows_usd: view.total_borrows_usd,
      utilization: view.utilization, lending_apr: view.lending_apr, borrowing_apr: view.borrowing_apr });
  }
  const view = { bank: address, label: current.labels[bank.mint] ?? current.labels[address] ?? address, points } satisfies BankHistoryView;
  cache.set(address, { slot: latest, view });
  return view;
}
