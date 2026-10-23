/** INPUT: 专用钱包、RPC、资产配置与报价时读取的 USD 单价。 OUTPUT: 兑换报价(兑换台已签名的交易)与受限转发。 POSITION: 兑换台,只提供资产、不垫付 SOL 手续费。 SYNC: folder.md。 */
import { ComputeBudgetProgram, Keypair, PublicKey, SystemInstruction, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, TokenInstruction, createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction, decodeTransferInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { ApiError } from '../api/errors';
import { guardTransaction, submitSigned } from '../api/send';
import { tokenBalance } from '../api/wallet';
import { objectBody, publicKey } from '../api/wallet-input';
import type { WalletRpc, WaitClock } from '../api/wallet-rpc';
import { realClock } from '../api/wallet-rpc';
import type { OracleSource, SendResponse, SwapAsset, SwapQuoteResponse, SwapRatesView } from '../api/types';
import { nativeAmount } from './config';
import type { DeskLeg } from '../store/desk-events';

export interface SwapAssetConfig {
  symbol: SwapAsset;
  decimals: number;
  /** SOL 没有 mint(原生资产);代币有。 */
  mint?: PublicKey;
}
/** 带上当时单价的资产:USD × 1e6(整数),例如 $50 = 50_000_000n。 */
export type PricedAsset = SwapAssetConfig & { usdMicro: bigint };
/** 报价时的单价从哪来。兑换台不自己定价:每个资产读它在借贷池里用的同一个价格账户(prices.ts)。 */
export interface PriceReader {
  (asset: SwapAssetConfig): Promise<{ usdMicro: bigint; source: OracleSource }>;
  /** 报价要绕过汇率表缓存,确保签名交易按此刻链上价格计算。 */
  fresh?: PriceReader;
}
export interface SwapConfig { assets: SwapAssetConfig[]; price: PriceReader; minUsdMicro: bigint; maxUsdMicro: bigint; /** 兑换台至少保留的 SOL(付 ATA 租金等)。 */ keepLamports?: bigint }

// #region ep8-swap-math
/**
 * 卖出 amountIn(原生单位)能换到多少:整数运算、向下取整,永远不会多给。
 *   换出 = 卖出 × 单价(卖出) × 10^小数位(换出) / (单价(换出) × 10^小数位(卖出))
 * 例:1 SOL($50) → tUSDC($1):1e9 × 50e6 × 1e6 / (1e6 × 1e9) = 50e6,即 50 tUSDC。
 * 同一次报价里所有汇率都来自同一张 USD 单价表,SOL→tSOL→tUSDC→SOL 绕一圈只会因取整而略少,不会凭空变多(没有套利环)。
 * 单价跟着预言机走(Pyth 是真实行情),所以不同时刻的报价会不同。
 */
export const swapOut = (amountIn: bigint, from: PricedAsset, to: PricedAsset): bigint =>
  amountIn * from.usdMicro * 10n ** BigInt(to.decimals) / (to.usdMicro * 10n ** BigInt(from.decimals));
/** 这笔卖出的价值(USD × 1e6),用来做上下限。 */
export const notionalMicro = (amountIn: bigint, from: PricedAsset): bigint => amountIn * from.usdMicro / 10n ** BigInt(from.decimals);
// #endregion

const ui = (native: bigint, decimals: number) => {
  const base = 10n ** BigInt(decimals), fraction = (native % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${native / base}${fraction ? `.${fraction}` : ''}`;
};

/**
 * 从兑换交易本身读出"谁卖出什么、换到什么"。交易字节是用户提交上来的，在本机解码，不调用 RPC;
 * 也不依赖报价时的内存状态——兑换台重启或云上多实例(报价落 A、提交落 B)都不会漏记。
 * 数量可信：消息体上有兑换台的签名，改动任何字节都会使签名失效、交易发不出去。
 * SPL 转账指令只带源/目标账户，不带 mint:用"钱包 + mint"在本地算 ATA 去比对，得到是哪种币。
 */
export function swapLegs(tx: VersionedTransaction, desk: PublicKey, assets: SwapAssetConfig[]): { wallet: string; from: DeskLeg; to: DeskLeg } | null {
  const message = TransactionMessage.decompile(tx.message), wallet = message.payerKey;
  const legs: { sender: PublicKey; asset: SwapAssetConfig; amount: bigint }[] = [];
  for (const ix of message.instructions) {
    if (ix.programId.equals(SystemProgram.programId) && SystemInstruction.decodeInstructionType(ix) === 'Transfer') {
      const t = SystemInstruction.decodeTransfer(ix), sol = assets.find(a => !a.mint);
      if (sol) legs.push({ sender: t.fromPubkey, asset: sol, amount: BigInt(t.lamports) });
    } else if (ix.programId.equals(TOKEN_PROGRAM_ID) && ix.data[0] === TokenInstruction.Transfer) {
      const t = decodeTransferInstruction(ix), owner = t.keys.owner.pubkey;
      const asset = assets.find(a => a.mint && getAssociatedTokenAddressSync(a.mint, owner).equals(t.keys.source.pubkey));
      if (asset) legs.push({ sender: owner, asset, amount: BigInt(t.data.amount) });
    }
  }
  const sold = legs.find(l => l.sender.equals(wallet)), bought = legs.find(l => l.sender.equals(desk));
  if (!sold || !bought) return null;
  const leg = (l: typeof sold): DeskLeg => ({ symbol: l.asset.symbol, amount: String(l.amount), decimals: l.asset.decimals });
  return { wallet: wallet.toBase58(), from: leg(sold), to: leg(bought) };
}

export function createSwap(desk: Keypair, rpc: WalletRpc, config: SwapConfig, clock: WaitClock = realClock,
  record?: (signature: string, wallet: string, from: DeskLeg, to: DeskLeg) => Promise<void>) {
  const allowed = new Set([ComputeBudgetProgram.programId, SystemProgram.programId, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID].map(p => p.toBase58()));
  const keep = config.keepLamports ?? 50_000_000n; // 兑换台至少留 0.05 SOL
  const priced = async (a: SwapAssetConfig): Promise<PricedAsset> => {
    const { usdMicro } = await (config.price.fresh ?? config.price)(a);
    if (usdMicro <= 0n) throw new ApiError(503, `${a.symbol} 价格暂时不可用，请稍后再试。`);
    return { ...a, usdMicro };
  };
  const asset = (symbol: unknown) => {
    const found = config.assets.find(a => a.symbol === symbol);
    if (!found) throw new ApiError(400, 'unknown asset');
    return found;
  };
  /** 兑换台持有多少该资产(SOL 看余额,代币看 ATA)。 */
  const deskHolds = async (a: SwapAssetConfig) => a.mint ? tokenBalance(rpc, a.mint, desk.publicKey) : BigInt(await rpc.getBalance(desk.publicKey, 'confirmed')) - keep;

  return {
    async rates(): Promise<SwapRatesView> {
      // 逐个资产取价，单个预言机暂不可用不应拖垮其他资产的报价。
      const settled = await Promise.allSettled(config.assets.map(a => config.price(a)));
      return { assets: config.assets.map((a, i) => {
        const r = settled[i];
        return r.status === 'fulfilled' ? { symbol: a.symbol, decimals: a.decimals, usd: ui(r.value.usdMicro, 6), source: r.value.source }
          : { symbol: a.symbol, decimals: a.decimals, usd: null, source: null, unavailable: r.reason instanceof Error ? r.reason.message : String(r.reason) };
      }),
        min_usd: ui(config.minUsdMicro, 6), max_usd: ui(config.maxUsdMicro, 6) };
    },

    async quote(input: unknown): Promise<SwapQuoteResponse> {
      const body = objectBody(input), wallet = publicKey(body.wallet), fromAsset = asset(body.from), toAsset = asset(body.to);
      if (fromAsset.symbol === toAsset.symbol) throw new ApiError(400, 'cannot swap an asset for itself');
      const [from, to] = await Promise.all([priced(fromAsset), priced(toAsset)]);
      let amountIn: bigint;
      try { amountIn = nativeAmount(String(body.amount), from.decimals); } catch { throw new ApiError(400, 'invalid amount'); }
      const value = notionalMicro(amountIn, from);
      if (value < config.minUsdMicro || value > config.maxUsdMicro) throw new ApiError(400, `swap value must be between $${ui(config.minUsdMicro, 6)} and $${ui(config.maxUsdMicro, 6)}`);
      const out = swapOut(amountIn, from, to);
      if (out < 1n) throw new ApiError(400, 'amount too small');
      if (await deskHolds(to) < out) throw new ApiError(503, `兑换台的 ${to.symbol} 不足，请换小一点的数量或稍后再试。`);

      // #region ep8-swap-tx
      // 一笔交易里两件事:用户把 from 转给兑换台 + 兑换台把 to 转给用户。付手续费和 ATA 租金的是用户(payerKey = wallet)，
      // 兑换台只是"转出资产"的授权签名者，不垫付手续费。兑换台的签名覆盖整条消息，用户改动任何内容都会让它失效。
      const instructions: TransactionInstruction[] = [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 })];
      if (from.mint) instructions.push(createTransferInstruction(getAssociatedTokenAddressSync(from.mint, wallet), getAssociatedTokenAddressSync(from.mint, desk.publicKey), wallet, amountIn));
      else instructions.push(SystemProgram.transfer({ fromPubkey: wallet, toPubkey: desk.publicKey, lamports: amountIn }));
      if (to.mint) {
        const userAta = getAssociatedTokenAddressSync(to.mint, wallet);
        instructions.push(createAssociatedTokenAccountIdempotentInstruction(wallet, userAta, wallet, to.mint),
          createTransferInstruction(getAssociatedTokenAddressSync(to.mint, desk.publicKey), userAta, desk.publicKey, out));
      } else instructions.push(SystemProgram.transfer({ fromPubkey: desk.publicKey, toPubkey: wallet, lamports: out }));
      const block = await rpc.getLatestBlockhash('confirmed');
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: block.blockhash, instructions }).compileToV0Message());
      tx.sign([desk]);
      // #endregion
      return { transaction: Buffer.from(tx.serialize()).toString('base64'), last_valid_block_height: block.lastValidBlockHeight,
        from: from.symbol, to: to.symbol, in_amount: String(amountIn), in_decimals: from.decimals, out_amount: String(out), out_decimals: to.decimals,
        summary: `用 ${ui(amountIn, from.decimals)} ${from.symbol} 兑换 ${ui(out, to.decimals)} ${to.symbol}` };
    },

    /** 只转发"兑换台自己签过名、且只含 计算预算/系统/代币/ATA 程序"的交易。 */
    async submit(input: unknown): Promise<SendResponse> {
      const { bytes, signature } = guardTransaction(input,
        (used, signers) => signers.includes(desk.publicKey.toBase58()) && used.every(p => allowed.has(p)), 'not a swap transaction');
      const result = await submitSigned(bytes, signature, rpc, clock);
      const legs = result.status === 'confirmed' && record ? swapLegs(VersionedTransaction.deserialize(bytes), desk.publicKey, config.assets) : null;
      if (legs) try { await record!(signature, legs.wallet, legs.from, legs.to); }
      catch { console.error('desk history write failed'); }
      return result;
    },
  };
}
export type Swap = ReturnType<typeof createSwap>;
