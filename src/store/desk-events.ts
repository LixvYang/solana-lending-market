/** Store confirmed swap and faucet activity that never enters marginfi's decoder. */
import type { Db } from './db';

export interface DeskLeg { symbol: string; amount: string; decimals: number }
export interface DeskEvent {
  signature: string; wallet: string; kind: 'swap' | 'faucet';
  from?: DeskLeg; to?: DeskLeg; details?: DeskLeg[]; status: string;
}

export async function insertDeskEvent(db: Db, event: DeskEvent): Promise<void> {
  await db.query(`INSERT INTO desk_events(signature,wallet,kind,from_symbol,from_amount,from_decimals,to_symbol,to_amount,to_decimals,details,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) ON CONFLICT(signature) DO NOTHING`, [
    event.signature, event.wallet, event.kind, event.from?.symbol ?? null, event.from?.amount ?? null, event.from?.decimals ?? null,
    event.to?.symbol ?? null, event.to?.amount ?? null, event.to?.decimals ?? null, JSON.stringify(event.details ?? []), event.status,
  ]);
}
