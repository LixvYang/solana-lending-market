/** INPUT: 环境变量、池子 BankView、Pyth 银行默认 grant。 OUTPUT: 精确水龙头数量/配置。 POSITION: EP8 测试币配置。 SYNC: folder.md。 */
import { PublicKey } from '@solana/web3.js';
import type { BankView } from '../api/types';
import { PYTH_BANKS } from '../oracle/pyth-banks';
export interface Grant { label: string; mint: PublicKey; amount: bigint; decimals?: number }
// 30 次 × 新用户约 0.0123 SOL 的账户租金 ≈ 0.37 SOL / 5 小时，按持续满额算最坏约 1.8 SOL / 天。
export function nativeAmount(value: string, decimals: number): bigint {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw Error('invalid amount');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw Error('too many decimals');
  const amount = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (amount < 1n || amount > (1n << 64n) - 1n) throw Error('invalid u64 amount');
  return amount;
}
const GRANTS = {
  tUSDC: ['FAUCET_TUSDC_AMOUNT', '1000'], tSOL: ['FAUCET_TSOL_AMOUNT', '10'],
  pSOL: ['FAUCET_PSOL_AMOUNT', PYTH_BANKS.pSOL.faucetAmount], pBTC: ['FAUCET_PBTC_AMOUNT', PYTH_BANKS.pBTC.faucetAmount],
  pETH: ['FAUCET_PETH_AMOUNT', PYTH_BANKS.pETH.faucetAmount], tHYPE: ['FAUCET_THYPE_AMOUNT', '6'],
} as const;
/** tUSDC、tSOL 必须有;Pyth 与 tHYPE 银行是可选项,池子里有才发。 */
export function faucetGrants(banks: BankView[], env: NodeJS.ProcessEnv = process.env): Grant[] {
  return (Object.keys(GRANTS) as (keyof typeof GRANTS)[]).flatMap(label => {
    const bank = banks.find(b => b.label === label);
    if (!bank) { if (label.startsWith('p') || label === 'tHYPE') return []; throw Error('faucet bank unavailable'); }
    const [name, fallback] = GRANTS[label];
    return [{ label, mint: new PublicKey(bank.mint), amount: nativeAmount(env[name] ?? fallback, bank.decimals), decimals: bank.decimals }];
  });
}
export function windowHours(value: string | undefined): number { return positiveInteger(value, 5, 'window hours'); }
export function windowMax(value: string | undefined): number { return positiveInteger(value, 30, 'window max'); }
export function minimumSol(value: string | undefined): number {
  const parsed = value === undefined ? 0.2 : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw Error('invalid faucet minimum SOL');
  return parsed;
}
function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw Error(`invalid faucet ${name}`);
  return Number(value);
}
