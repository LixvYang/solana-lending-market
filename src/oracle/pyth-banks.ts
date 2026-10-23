/** INPUT: Pyth 银行符号与可选 run id。 OUTPUT: 固定 mint/bank 派生和资产参数。 POSITION: Pyth 银行管理脚本共用配置。 SYNC: folder.md。 */
/** Pyth 资产 grant 按 devnet 价配到约 $500;setup 预置约 100 份,均可用环境变量覆盖。 */
export const PYTH_BANKS = {
  pSOL: { feed: 'SOL/USD', decimals: 9, maxAge: 300, faucetAmount: '10', setupAmount: '20000' },
  pBTC: { feed: 'BTC/USD', decimals: 8, maxAge: 900, faucetAmount: '0.006', setupAmount: '0.6' },
  pETH: { feed: 'ETH/USD', decimals: 8, maxAge: 900, faucetAmount: '0.2', setupAmount: '20' },
} as const;

export type PythBankSymbol = keyof typeof PYTH_BANKS;

export function parsePythBankArgs(args: string[]): { symbol: PythBankSymbol; runId: string } {
  let symbol: PythBankSymbol = 'pSOL', runId = '';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--symbol' && args[i + 1] && args[i + 1] in PYTH_BANKS) symbol = args[++i] as PythBankSymbol;
    else if (arg === '--run-id' && args[i + 1] && !args[i + 1].startsWith('--')) runId = args[++i];
    else throw new Error(`invalid arguments: ${arg}`);
  }
  return { symbol, runId };
}

export function pythBankSeeds(symbol: PythBankSymbol, runId = '') {
  return {
    mint: `mint/${symbol}`,
    bank: runId ? `bank/${symbol}/${runId}` : `bank/${symbol}`,
  };
}
