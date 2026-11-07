/** INPUT: 内存限流状态、钱包/IP/时间。 OUTPUT: 新状态或下次可用时间。 POSITION: EP8 纯限流函数。 SYNC: folder.md。 */
export interface LimitState { wallets: Record<string, number>; ips: Record<string, number[]>; reservations: number[] }
export const emptyLimits = (): LimitState => ({ wallets: {}, ips: {}, reservations: [] });
export interface QuotaView { max: number; remaining: number; window_hours: number; resets_at: string | null }
export function quota(state: LimitState, now: number, windowHours: number, max: number): QuotaView {
  const active = state.reservations.filter(time => time > now - windowHours * 3600_000);
  return { max, remaining: Math.max(0, max - active.length), window_hours: windowHours,
    resets_at: active.length >= max ? new Date(active[0] + windowHours * 3600_000).toISOString() : null };
}
// #region ep8-faucet-limit
export function reserve(state: LimitState, wallet: string, ip: string, now: number, windowHours = 5, windowMax = 30):
  { ok: true; state: LimitState; next: number } | { ok: false; next: number; reason: 'window' | 'limit' } {
  const cutoff = now - windowHours * 3600_000;
  const reservations = state.reservations.filter(time => time > cutoff);
  const ips = Object.fromEntries(Object.entries(state.ips).map(([key, times]) => [key, times.filter(t => t > now - 3600_000)]).filter(([, times]) => times.length));
  const wallets = Object.fromEntries(Object.entries(state.wallets).filter(([, time]) => time + 600_000 > now));
  const hits = ips[ip] ?? [], deadlines: number[] = [];
  if (wallets[wallet] !== undefined) deadlines.push(wallets[wallet] + 600_000);
  if (hits.length >= 5) deadlines.push(hits[hits.length - 5] + 3600_000);
  if (reservations.length >= windowMax) deadlines.push(reservations[0] + windowHours * 3600_000);
  if (deadlines.length) return { ok: false, next: Math.max(...deadlines), reason: reservations.length >= windowMax ? 'window' : 'limit' };
  const updated = [...hits, now];
  return { ok: true, state: { wallets: { ...wallets, [wallet]: now }, ips: { ...ips, [ip]: updated }, reservations: [...reservations, now] },
    next: Math.max(now + 600_000, updated.length >= 5 ? updated[updated.length - 5] + 3600_000 : now) };
}
// #endregion
