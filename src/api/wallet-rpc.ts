/** INPUT: web3 Connection。 OUTPUT: 可注入 RPC 与等待时钟。 POSITION: M7 网络边界，无钱包/密钥加载。 SYNC: folder.md。 */
import { Connection } from '@solana/web3.js';
export type WalletRpc = Pick<Connection, 'getLatestBlockhash' | 'simulateTransaction' | 'getAccountInfo' | 'getMultipleAccountsInfo' | 'getMultipleAccountsInfoAndContext' | 'getProgramAccounts' | 'getSlot' | 'getBlockTime' | 'getBalance' | 'sendRawTransaction' | 'getSignatureStatuses' | 'getTransaction'>;
export interface WaitClock { now(): number; sleep(ms: number): Promise<void> }
export const realClock: WaitClock = { now: Date.now, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) };
export interface WalletServices {
  rpc: WalletRpc; faucetUrl?: string; clock?: WaitClock; oracleOwners?: Set<string>;
  /**
   * 用户账户的内容从链上读最新，而不是用数据库快照。生产环境必须开(serve-api 会开)。
   * 为什么：索引器有延迟。快照落后时，刚存过款的用户会被当成"首次"而重复创建账户，
   * 余额槽位也可能过期，导致 remaining accounts 的顺序不对。离线测试默认关(没有链可读)。
   */
  readUserFromChain?: boolean;
}

export function rpcConnection(url: string): Connection {
  // 有界单次请求，关闭驱动内部 429 重试；转发/keeper 自己控制重试和截止时间。
  return new Connection(url, { commitment: 'confirmed', disableRetryOnRateLimit: true,
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }) });
}
