export function selectedService(value: string | undefined): 'api' | 'faucet' | 'keeper' | 'ingest' {
  if (value === 'api' || value === 'faucet' || value === 'keeper' || value === 'ingest') return value;
  throw new Error('SERVICE must be api, faucet, keeper, or ingest');
}
