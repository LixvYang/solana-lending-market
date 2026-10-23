/** INPUT: HYPE oracle CLI options. OUTPUT: fixed-price defaults and stable identities. POSITION: HYPE migration from Pyth to our mock PullFeed. SYNC: folder.md. */
export const HYPE_PRICE = '80';
export const HYPE_FEED_LABEL = 'tHYPE';

// The deployed mint and bank were derived before the display symbol changed.
export const HYPE_BANK_SEEDS = { mint: 'mint/pHYPE', bank: 'bank/pHYPE' } as const;

export function parseHypeOracleArgs(args: string[]): string {
  let price = HYPE_PRICE;
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--price' || !args[i + 1]) throw new Error(`invalid arguments: ${args[i]}`);
    price = args[++i];
  }
  return price;
}

/** Exact Switchboard 18 decimal price, bounded to a positive i128. */
export function fixed18Price(value: string): bigint {
  if (!/^\d+(?:\.\d{1,18})?$/.test(value)) throw new Error('invalid price');
  const [whole, fraction = ''] = value.split('.');
  const price = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
  if (price <= 0n || price >= 1n << 127n) throw new Error('invalid price');
  return price;
}
