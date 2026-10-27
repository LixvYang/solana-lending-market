import 'dotenv/config';
import { PublicKey } from '@solana/web3.js';
import { createActors } from '../scenario/lib/actors';
import { createContext } from '../scenario/lib/runtime';
import { fetchAccount } from '../scenario/lib/state';
import { rateCurve, rateCurveSummary } from './demo-config';
import { send } from '../scenario/lib/rpc';

const ADDITIONAL_BANKS = {
  pSOL: 'D77PE9gnPYQD16kwDFSHgXfReA8Ud133PF3bKVfPr4pN',
  pBTC: '96YbFnubhTuipauMm7K9yUuZbnVtiVaG2ywh8gNSqFgo',
  pETH: '8SrSgi5EXVme1ayntfXEfKKTnPzMRBroG6o26ue2KEw8',
  tHYPE: 'H3eVeTmiHAP3jhd46ubVxVf58nMhQK4dJ2ScFFTtDRaE',
} as const;

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--dry-run') || args.length > 1) throw Error('用法: set-rate-curve [--dry-run]');
  const dryRun = args.includes('--dry-run'), ctx = await createContext('');
  const banks = { ...Object.fromEntries(Object.entries(createActors().banks).map(([key, value]) => [key, value.publicKey])),
    ...Object.fromEntries(Object.entries(ADDITIONAL_BANKS).map(([key, value]) => [key, new PublicKey(value)])) };
  const group = ctx.actors.group.publicKey;
  for (const [symbol, bank] of Object.entries(banks)) {
    const wanted = rateCurve(symbol), current = await fetchAccount(ctx, 'bank', bank);
    const same = Object.entries(wanted).filter(([key]) => key !== 'protocolOriginationFee').every(([key, value]) =>
      Buffer.from(current.config.interestRateConfig[key]?.value ?? []).equals(Buffer.from(value?.value ?? [])));
    const config = { assetWeightInit: null, assetWeightMaint: null, liabilityWeightInit: null, liabilityWeightMaint: null,
      depositLimit: null, borrowLimit: null, operationalState: null, interestRateConfig: wanted,
      riskTier: null, assetTag: null, totalAssetValueInitLimit: null, oracleMaxAge: null,
      permissionlessBadDebtSettlement: null, freezeSettings: null };
    console.log(`${bank.toBase58()} ${rateCurveSummary(symbol)} ${same ? 'skip (already set)' : dryRun ? 'would configure' : 'configure'}`);
    if (!same && !dryRun) await send(ctx, `configure rate curve ${symbol}`, [await ctx.program.methods.lendingPoolConfigureBank(config)
      .accountsStrict({ marginfiGroup: group, admin: ctx.admin.publicKey, bank }).instruction()]);
  }
}
void main().then(() => process.exit(0), error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
