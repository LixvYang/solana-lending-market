/** INPUT: Db、假/真实 RPC、BuildRequest。 OUTPUT: v0 部分签名交易与模拟。 POSITION: M7 构建服务，无管理员密钥。 SYNC: folder.md。 */
import { Keypair, PublicKey, ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import type { Db } from '../../store/db';
import { decodePullFeed } from '../../decoder/switchboard';
import { decodePriceUpdate } from '../../decoder/pyth';
import { isPythPush, oracleAccountOf } from '../../oracle/pyth';
import { refreshTimestampIx } from '../../oracle/mock-write';
import { mockOracleOwner, oracleOwners } from '../../store/accounts';
import { getPool } from '../queries';
import { readState } from '../state';
import type { BuildResponse } from '../types';
import type { WalletServices } from '../wallet-rpc';
import { ApiError } from '../errors';
import { buildInput, formatAmount } from '../wallet-input';
import { programError, publicLogs } from '../program-error';
import { chainWalletAccount, walletAccount, type BuildBank } from './state';
import { remainingBanks, observation } from './remaining';
import { initInstruction, lendingInstruction } from './instructions';
/** 价格比这个新就不用刷新;marginfi 的上限是 oracle_max_age(我们配的是 240 秒)。 */
const REFRESH_AFTER_SECONDS = 30n;

async function clusterTime(services: WalletServices): Promise<bigint> {
  // 用链上时间，不用本机时间:本机时钟快了会写出"未来"的时间戳。取不到(或测试里没有)才退回本机时钟。
  try { const t = await services.rpc.getBlockTime(await services.rpc.getSlot('confirmed')); if (t) return BigInt(t); } catch { /* 退回 */ }
  return BigInt(Math.floor((services.clock?.now() ?? Date.now()) / 1000));
}

export class PriceStale extends ApiError {
  // 只在价格确实无法刷新时出现;公开稳定错误码，不向用户暴露维护细节。
  constructor(message = '价格暂时不可用，请稍后重试。') { super(409, message, 'PRICE_UNAVAILABLE'); }
}
export async function buildTransaction(db: Db, services: WalletServices, input: unknown): Promise<BuildResponse> {
  const request = buildInput(input), pool = await getPool(db), state = await readState(db);
  const bank = state.banks[request.bank] as BuildBank | undefined, view = pool.banks.find(b => b.address === request.bank);
  if (!pool.group || !bank || !view || bank.group !== pool.group) throw new ApiError(400, 'bank outside pool');
  const wallet = new PublicKey(request.wallet), group = new PublicKey(pool.group), target = new PublicKey(request.bank);
  const user = services.readUserFromChain ? await chainWalletAccount(db, services.rpc, request.wallet, pool.group)
    : await walletAccount(db, request.wallet, pool.group);
  if (!user && request.action !== 'deposit') throw new ApiError(400, 'deposit first to create account');
  const remaining = request.action === 'borrow' || request.action === 'withdraw'
    ? remainingBanks(user!.data.lending_account.balances, request.action, request.bank, request.all === true) : [];
  const banks = state.banks as Record<string, BuildBank>;
  const metas = observation(remaining, banks, pool.group);
  // #region ep8-price-refresh
  // 借款/取款要求价格新鲜。mock 账户只允许公开刷新时间戳，价格写入仍要求管理员授权。
  // 用户交易可以代为刷新新鲜度，不再携带 feed 私钥或改价权限。
  // 这样不依赖任何后台进程;进程挂了、刚重启、网络抖动都不会让用户看到"价格过期"。
  const refresh: { feed: PublicKey; program: PublicKey }[] = [];
  let now = 0n;
  if (request.action === 'borrow' || request.action === 'withdraw') {
    now = await clusterTime(services);
    for (const address of new Set([...remaining, request.bank])) {
      const config = banks[address].config, oracle = oracleAccountOf(config);
      if (!oracle) throw new PriceStale();
      const feedKey = new PublicKey(oracle);
      const feed = await services.rpc.getAccountInfo(feedKey, 'confirmed'); // 读链上当前值，库里的快照不能作为新鲜度证据
      if (!feed || !(services.oracleOwners ?? oracleOwners()).has(feed.owner.toBase58())) throw new PriceStale();
      if (isPythPush(config.oracle_setup)) {
        // Pyth 的价格由 Pyth 自己推送,我们写不了;只能确认它还在银行允许的年龄内,否则如实告诉用户等一下。
        const pyth = decodePriceUpdate(feed.data);
        if (pyth.verification !== 'Full' || now - pyth.publish_time > BigInt(config.oracle_max_age)) throw new PriceStale('Pyth 价格暂未更新，请过一两分钟再试。');
        continue;
      }
      if (!feed.owner.equals(new PublicKey(mockOracleOwner()))) throw new PriceStale();
      let price;
      try { price = decodePullFeed(feed.data); } catch { throw new PriceStale(); }
      if (!price.sample_size) throw new PriceStale(); // 从未有过价格:没有可保鲜的值
      const age = now - price.last_update_timestamp;
      if (age <= REFRESH_AFTER_SECONDS && age >= 0n) continue; // 够新,不动(正常运行时这笔交易保持最小)
      refresh.push({ feed: feedKey, program: feed.owner });
    }
  }
  // #endregion
  const ata = getAssociatedTokenAddressSync(new PublicKey(bank.mint), wallet);
  const instructions = [createAssociatedTokenAccountIdempotentInstruction(wallet, ata, wallet, new PublicKey(bank.mint)),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })];
  // #region ep8-first-deposit
  // 账户不是 PDA；唯一一次性 keypair 只签自己的创建，不为用户付费，也不落盘。
  const fresh = user ? null : Keypair.generate(), account = user ? new PublicKey(user.address) : fresh!.publicKey;
  for (const r of refresh) instructions.push(refreshTimestampIx(r.program, r.feed));
  if (fresh) instructions.push(await initInstruction(group, account, wallet));
  const amount = request.all ? 0n : BigInt(request.amount);
  instructions.push(await lendingInstruction(request.action, group, account, wallet, target, ata, amount, request.all === true, metas));
  const latest = await services.rpc.getLatestBlockhash('confirmed');
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: latest.blockhash, instructions }).compileToV0Message());
  if (fresh) tx.sign([fresh]); // 仅一次性账户由服务端代签;用户的签名由钱包补上
  // #endregion
  if (tx.serialize().length > 1232) throw new ApiError(400, 'transaction exceeds 1232 bytes');
  // #region ep8-simulate
  const simulated = (await services.rpc.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' })).value;
  const simulation = { ok: simulated.err === null, error: simulated.err === null ? null : programError(simulated.err),
    logs: publicLogs(simulated.logs), units_consumed: simulated.unitsConsumed ?? null };
  // #endregion
  const verbs = { deposit: '存入', withdraw: '取出', borrow: '借出', repay: '偿还' };
  return { transaction: Buffer.from(tx.serialize()).toString('base64'), last_valid_block_height: latest.lastValidBlockHeight,
    creates_account: !!fresh, marginfi_account: account.toBase58(), simulation,
    summary: `${verbs[request.action]} ${request.all ? '全部' : formatAmount(amount, view.decimals)} ${view.label}` };
}
