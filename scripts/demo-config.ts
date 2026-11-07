import anchor from '@coral-xyz/anchor';
import type { Keypair } from '@solana/web3.js';

const { BN } = anchor;

export const DEMO_POSITIONS = {
  'demo-lender': { deposits: { tHYPE: '60' }, borrows: {} },
  'demo-borrower-1': { deposits: { pBTC: '0.3' }, borrows: { tUSDC: '7000', pETH: '0.4', tHYPE: '9', tSOL: '60' } },
  'demo-borrower-2': { deposits: { pETH: '4', tSOL: '250' }, borrows: { tUSDC: '4600', pBTC: '0.05' } },
  'demo-borrower-3': { deposits: { pSOL: '80', tSOL: '200' }, borrows: { tUSDC: '4000', tSOL: '45', tHYPE: '9' } },
  'demo-borrower-4': { deposits: { tUSDC: '9000' }, borrows: { pSOL: '20', tSOL: '25' } },
} as const;

export function rateCurve(symbol: string) {
  const stable = symbol === 'tUSDC';
  const value = (n: number) => ({ value: [...fixed(n)] });
  return {
    optimalUtilizationRate: value(stable ? 0.8 : 0.45),
    plateauInterestRate: value(stable ? 0.07 : 0.08),
    maxInterestRate: value(stable ? 1 : 1.5),
    insuranceFeeFixedApr: value(0), insuranceIrFee: value(0.05),
    protocolFixedFeeApr: value(0), protocolIrFee: value(0.05),
    protocolOriginationFee: null,
  };
}

export function rateCurveSummary(symbol: string) {
  const stable = symbol === 'tUSDC';
  return `${symbol}: optimal=${stable ? '80%' : '45%'} plateau=${stable ? '7%' : '8%'} max=${stable ? '100%' : '150%'} protocol_ir_fee=5% insurance_ir_fee=5% fixed_apr=0%`;
}

function fixed(n: number): Uint8Array {
  const numerator = BigInt(Math.round(n * 1_000_000)) * (1n << 48n) / 1_000_000n;
  const bytes = Buffer.alloc(16);
  bytes.writeBigUInt64LE(numerator & ((1n << 64n) - 1n));
  bytes.writeBigUInt64LE(numerator >> 64n, 8);
  return bytes;
}

export interface Position { deposits: Record<string, string>; borrows: Record<string, string> }
export function netPosition(position: Position): Position {
  const deposits = { ...position.deposits }, borrows = { ...position.borrows };
  for (const symbol of Object.keys(deposits)) {
    if (!(symbol in borrows)) continue;
    const net = Number(deposits[symbol]) - Number(borrows[symbol]);
    delete deposits[symbol]; delete borrows[symbol];
    if (net > 0) deposits[symbol] = String(net);
    if (net < 0) borrows[symbol] = String(-net);
  }
  return { deposits, borrows };
}

export function positionPlan(target: Position, current: Position = { deposits: {}, borrows: {} }) {
  const delta = (wanted: Record<string, string>, held: Record<string, string>) => Object.fromEntries(
    Object.entries(wanted).flatMap(([symbol, amount]) => {
      const remaining = Math.max(0, Number(amount) - Number(held[symbol] ?? 0));
      // 链上份额换算有截断误差(如 154.999999999),差额小于目标的万分之一视为已达成，免得重跑时发出灰尘交易。
      return remaining > Number(amount) * 1e-4 ? [[symbol, String(Number(remaining.toFixed(10)))]] : [];
    }));
  return { deposits: delta(target.deposits, current.deposits), borrows: delta(target.borrows, current.borrows) };
}

export function demoKeyPath(name: string, home: string) {
  if (!(name in DEMO_POSITIONS)) throw new Error(`unknown demo wallet: ${name}`);
  return `${home.replace(/\/$/, '')}/.config/solana/lending-market-demo/${name}.json`;
}

export function createSecretFile(keypair: Keypair) { return JSON.stringify([...keypair.secretKey]); }
