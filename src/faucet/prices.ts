/** INPUT: RPC、每个兑换资产对应的价格账户。 OUTPUT: PriceReader(链上当前价 → USD × 1e6)。 POSITION: 兑换台定价,与借贷池读同一批价格账户。 SYNC: folder.md。 */
import type { PublicKey } from '@solana/web3.js';
import { ApiError } from '../api/errors';
import type { OracleSource } from '../api/types';
import type { WalletRpc } from '../api/wallet-rpc';
import { decodePriceUpdate, DISCRIMINATOR as PYTH } from '../decoder/pyth';
import { decodePullFeed, DISCRIMINATOR as PULL } from '../decoder/switchboard';
import type { PriceReader } from './swap';

const SWITCHBOARD = 'Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2';
/** Pyth 价格超过这个年龄就不报价:兑换按真实行情成交,旧价格会被人拿来套利。 */
export const MAX_PYTH_AGE_SECONDS = 600n;

/** 价格账户字节 → USD × 1e6(向下取整)。Pyth 检查校验级别与年龄;mock 价格是我们定的,时间戳只在借款时刷新,不看年龄。 */
export function usdMicroOf(data: Uint8Array, owner: string, nowSeconds: bigint): { usdMicro: bigint; source: OracleSource } {
  const head = Buffer.from(data.subarray(0, 8));
  if (head.equals(PYTH)) {
    const p = decodePriceUpdate(data);
    if (p.verification !== 'Full' || p.price.numerator <= 0n || nowSeconds - p.publish_time > MAX_PYTH_AGE_SECONDS) throw new ApiError(503, 'Pyth 价格暂未更新，请稍后再试。');
    return { usdMicro: p.price.numerator * 1_000_000n / p.price.denominator, source: 'pyth' };
  }
  if (head.equals(PULL)) {
    const f = decodePullFeed(data);
    if (!f.sample_size || f.price.numerator <= 0n) throw new ApiError(503, '价格暂时不可用，请稍后再试。'); // 从未 crank 的账户价格是 0
    return { usdMicro: f.price.numerator * 1_000_000n / f.price.denominator, source: owner === SWITCHBOARD ? 'switchboard' : 'mock' };
  }
  throw new ApiError(503, '价格账户格式不认识');
}

const RATES_CACHE_MS = 15_000;
export function oraclePrices(rpc: WalletRpc, accounts: Partial<Record<string, PublicKey>>, now = () => Date.now()): PriceReader {
  const keys = Object.values(accounts).filter((key): key is PublicKey => Boolean(key));
  let cached: { until: number; infos: Awaited<ReturnType<WalletRpc['getMultipleAccountsInfo']>> } | null = null;
  let pending: Promise<Awaited<ReturnType<WalletRpc['getMultipleAccountsInfo']>>> | null = null;
  const readAll = async () => {
    if (cached && cached.until > now()) return cached.infos;
    if (pending) return pending;
    pending = rpc.getMultipleAccountsInfo(keys, 'confirmed');
    try {
      const infos = await pending;
      cached = { infos, until: now() + RATES_CACHE_MS };
      return infos;
    } finally { pending = null; }
  };
  const decode = (asset: Parameters<PriceReader>[0], info: Awaited<ReturnType<WalletRpc['getAccountInfo']>>) => {
    const account = accounts[asset.symbol];
    if (!account) throw new ApiError(503, `${asset.symbol} 没有价格来源`);
    if (!info) throw new ApiError(503, `${asset.symbol} 价格账户不存在`);
    return usdMicroOf(info.data, info.owner.toBase58(), BigInt(Math.floor(now() / 1000)));
  };
  const read: PriceReader = async asset => {
    const account = accounts[asset.symbol];
    if (!account) throw new ApiError(503, `${asset.symbol} 没有价格来源`);
    const infos = await readAll(), index = keys.findIndex(key => key.equals(account));
    return decode(asset, infos[index] ?? null);
  };
  read.fresh = async asset => {
    const account = accounts[asset.symbol];
    if (!account) throw new ApiError(503, `${asset.symbol} 没有价格来源`);
    return decode(asset, await rpc.getAccountInfo(account, 'confirmed'));
  };
  return read;
}
