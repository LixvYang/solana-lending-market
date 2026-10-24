/** INPUT: Db 与一次领取尝试。 OUTPUT: 数据库串行化的 T20 限额与名额。 POSITION: T21 多实例水龙头状态。 */
import type { Db, Row } from './db';
import { emptyLimits, quota, reserve, type QuotaView } from '../faucet/limit';

const ADVISORY_LOCK = 1_976_331_217;
const timeOf = (value: unknown) => value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
interface ReservationRow extends Row { wallet: string; ip: string; reserved_at: unknown }

export function createFaucetReservations(db: Db, now = Date.now) {
  return {
    async reserve(wallet: string, ip: string, windowHours: number, windowMax: number) {
      const at = now(), cutoff = at - Math.max(windowHours, 1) * 3_600_000;
      return db.transaction(async tx => {
        await tx.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK]);
        await tx.query('DELETE FROM faucet_reservations WHERE reserved_at <= $1', [new Date(cutoff)]);
        const rows = (await tx.query<ReservationRow>('SELECT wallet, ip, reserved_at FROM faucet_reservations WHERE reserved_at > $1 ORDER BY reserved_at', [new Date(cutoff)])).rows;
        const state = rows.reduce((current, row) => {
          const time = timeOf(row.reserved_at);
          current.wallets[row.wallet] = Math.max(current.wallets[row.wallet] ?? 0, time);
          (current.ips[row.ip] ??= []).push(time);
          current.reservations.push(time);
          return current;
        }, emptyLimits());
        const result = reserve(state, wallet, ip, at, windowHours, windowMax);
        if (result.ok) await tx.query('INSERT INTO faucet_reservations(wallet, ip, reserved_at) VALUES($1, $2, $3)', [wallet, ip, new Date(at)]);
        return result;
      });
    },
    async quota(windowHours: number, windowMax: number): Promise<QuotaView> {
      const at = now(), cutoff = at - windowHours * 3_600_000;
      const rows = await db.query('SELECT reserved_at FROM faucet_reservations WHERE reserved_at > $1 ORDER BY reserved_at', [new Date(cutoff)]);
      const state = emptyLimits();
      state.reservations = rows.rows.map(row => timeOf(row.reserved_at));
      return quota(state, at, windowHours, windowMax);
    },
  };
}
