/** INPUT: SOL/BTC/ETH Pyth feed id(hex 或 marginfi 存在 oracle_keys[0] 里的 32 字节)。 OUTPUT: feed 表、赞助价格账户地址、程序地址常量。 POSITION: Pyth push 价格的地址规则,构建器/索引器/管理脚本共用。 SYNC: folder.md。 */
import { PublicKey } from '@solana/web3.js';

/** 价格账户的 owner:Pyth Solana Receiver。marginfi 只认这个 owner(state/price.rs)。 */
export const PYTH_RECEIVER = new PublicKey('rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ');
/** 推导赞助价格账户地址用的程序(Pyth Push Oracle)。 */
export const PYTH_PUSH_ORACLE = new PublicKey('pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT');
/** Pyth 官方赞助、持续更新的分片。marginfi 自己赞助的是 3301,devnet 上没有。 */
export const SPONSORED_SHARD = 0;
/** 用到的 feed id(主网与 devnet 相同)。 */
export const FEED_IDS = {
  'SOL/USD': 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  'BTC/USD': 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  'ETH/USD': 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
} as const;

// #region ep7-pyth-address
/**
 * mrgn-0.1.0 的 PythPushOracle 银行里,oracle_keys[0] 存的**不是账户地址,而是 32 字节 feed id**
 * (marginfi_group.rs get_pyth_push_oracle_feed_id)。交易里要传的价格账户是 Pyth 按 [分片 u16 LE, feed id] 推导的 PDA。
 * 程序只校验 owner、feed id 与校验级别,不校验地址,所以任何分片都行;我们用 Pyth 自己赞助的 0 号分片。
 */
export function pythPushAccount(feedId: string | Uint8Array, shard = SPONSORED_SHARD): PublicKey {
  const id = typeof feedId === 'string' ? Buffer.from(feedId.replace(/^0x/, ''), 'hex') : Buffer.from(feedId);
  if (id.length !== 32) throw new Error('feed id must be 32 bytes');
  const seed = Buffer.alloc(2);
  seed.writeUInt16LE(shard);
  return PublicKey.findProgramAddressSync([seed, id], PYTH_PUSH_ORACLE)[0];
}
// #endregion

/** feed id 当作 Pubkey 写进 oracle_keys[0](configure_bank_oracle 的参数类型是 Pubkey)。 */
export const feedIdAsKey = (hex: string) => new PublicKey(Buffer.from(hex, 'hex'));

/** 解码后的 OracleSetup 是 { PythPushOracle: {} } 这样的枚举对象。 */
export const isPythPush = (setup: unknown) => typeof setup === 'object' && setup !== null && 'PythPushOracle' in setup;

/**
 * 一个银行的价格要去读哪个账户。Switchboard(及我们的 mock)直接就是 oracle_keys[0];
 * Pyth push 银行的 oracle_keys[0] 是 feed id,要换算成价格账户。没有配置预言机时返回 null。
 */
export function oracleAccountOf(config: { oracle_setup: unknown; oracle_keys: string[] }): string | null {
  const key = config.oracle_keys[0];
  if (!key || key === PublicKey.default.toBase58()) return null;
  return isPythPush(config.oracle_setup) ? pythPushAccount(new PublicKey(key).toBytes()).toBase58() : key;
}
