/**
 * INPUT: ANCHOR_WALLET、RPC_URL、已由 add-pyth-bank 建好的 pSOL 银行。
 * OUTPUT: devnet 上的两条借款路径,证明 Pyth 价格在健康检查里两个方向都被使用:
 *   A. 存 pSOL(Pyth 价格作抵押)→ 借 tUSDC
 *   B. 存 tUSDC → 借 pSOL(Pyth 价格作负债)
 * POSITION: 管理员验收 CLI,直接调程序,不经过 API。用户钱包是一次性的,不落盘。花费约 0.03 SOL。SYNC: folder.md。
 */
import 'dotenv/config';
import anchor from '@coral-xyz/anchor';
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Keypair, PublicKey, SystemProgram, type AccountMeta } from '@solana/web3.js';
import { deriveKeypair } from '../scenario/lib/actors';
import { pda } from '../scenario/lib/marginfi';
import { send } from '../scenario/lib/rpc';
import { createContext } from '../scenario/lib/runtime';
import { fetchAccount } from '../scenario/lib/state';
import { decodePriceUpdate } from '../src/decoder/pyth';
import { mockFeedSigner, refreshTimestampIx } from '../src/oracle/mock-write';
import { FEED_IDS, pythPushAccount } from '../src/oracle/pyth';

const { BN } = anchor;

async function main() {
  const ctx = await createContext(''), connection = ctx.provider.connection, group = ctx.actors.group.publicKey;
  const pyth = pythPushAccount(FEED_IDS['SOL/USD']), usdcFeed = deriveKeypair('feed/tUSDC').publicKey;
  const pSOL = { bank: deriveKeypair('bank/pSOL').publicKey, mint: deriveKeypair('mint/pSOL').publicKey, oracle: pyth };
  const tUSDC = { bank: ctx.actors.banks.tUSDC.publicKey, mint: ctx.actors.mints.tUSDC.publicKey, oracle: usdcFeed };
  type B = typeof pSOL;
  const price = decodePriceUpdate((await connection.getAccountInfo(pyth))!.data);
  const now = BigInt((await connection.getBlockTime(await connection.getSlot()))!);
  console.log(`Pyth SOL/USD = $${price.price.decimal} ± ${price.conf.decimal},${price.verification},${now - price.publish_time} 秒前`);

  const meta = (b: B): AccountMeta[] => [b.bank, b.oracle].map(pubkey => ({ pubkey, isSigner: false, isWritable: false }));
  // tUSDC 用的是我们的 mock 价格账户:顺手刷新时间戳(D-017 的做法);Pyth 账户由 Pyth 自己保鲜,不能也不需要我们写。
  const usdcSigner = mockFeedSigner(usdcFeed)!, mocks = (await connection.getAccountInfo(usdcFeed))!.owner;
  const user = async (name: string, fund: { b: B; amount: bigint }) => {
    const wallet = Keypair.generate(), account = Keypair.generate();
    const ata = getAssociatedTokenAddressSync(fund.b.mint, wallet.publicKey);
    await send(ctx, `${name}: 准备`, [SystemProgram.transfer({ fromPubkey: ctx.admin.publicKey, toPubkey: wallet.publicKey, lamports: 10_000_000 }),
      createAssociatedTokenAccountIdempotentInstruction(ctx.admin.publicKey, ata, wallet.publicKey, fund.b.mint),
      createMintToInstruction(fund.b.mint, ata, ctx.admin.publicKey, fund.amount),
      await ctx.program.methods.marginfiAccountInitialize().accountsStrict({ marginfiGroup: group, marginfiAccount: account.publicKey,
        authority: wallet.publicKey, feePayer: ctx.admin.publicKey, systemProgram: SystemProgram.programId }).instruction()], [wallet, account]);
    await send(ctx, `${name}: 存款`, [await ctx.program.methods.lendingAccountDeposit(new BN(fund.amount.toString())).accountsStrict({
      marginfiGroup: group, marginfiAccount: account.publicKey, signer: wallet.publicKey, bank: fund.b.bank,
      signerTokenAccount: ata, bankLiquidityVault: pda(ctx, 'liquidity_vault', fund.b.bank), tokenProgram: TOKEN_PROGRAM_ID }).instruction()], [wallet]);
    return { wallet, account };
  };
  const borrow = async (name: string, u: { wallet: Keypair; account: Keypair }, collateral: B, debt: B, amount: bigint) => {
    const ata = getAssociatedTokenAddressSync(debt.mint, u.wallet.publicKey);
    const t = BigInt((await connection.getBlockTime(await connection.getSlot()))!);
    const signature = await send(ctx, `${name}: 借款`, [refreshTimestampIx(mocks, usdcFeed, t),
      createAssociatedTokenAccountIdempotentInstruction(ctx.admin.publicKey, ata, u.wallet.publicKey, debt.mint),
      await ctx.program.methods.lendingAccountBorrow(new BN(amount.toString())).accountsStrict({
        marginfiGroup: group, marginfiAccount: u.account.publicKey, signer: u.wallet.publicKey, bank: debt.bank,
        destinationTokenAccount: ata, bankLiquidityVaultAuthority: pda(ctx, 'liquidity_vault_auth', debt.bank),
        bankLiquidityVault: pda(ctx, 'liquidity_vault', debt.bank), tokenProgram: TOKEN_PROGRAM_ID })
        // 槽位顺序:先存款的抵押,再新开的负债(find_or_create 用第一个空槽)。
        .remainingAccounts([...meta(collateral), ...meta(debt)]).instruction()], [u.wallet, usdcSigner]);
    const got = await connection.getTokenAccountBalance(ata);
    console.log(`${name}: 借到 ${got.value.uiAmountString} ✓  ${signature}`);
  };

  // A: 10 pSOL ≈ $1047 × 0.8 = $838 开仓抵押力,借 100 tUSDC × 1.1 = $110。
  const dave = await user('A', { b: pSOL, amount: 10_000_000_000n });
  await borrow('A', dave, pSOL, tUSDC, 100_000_000n);
  // B: 500 tUSDC 抵押力 $500,借 1 pSOL ≈ $105 × 1.1 = $115(流动性来自 A 刚存的 pSOL)。
  const erin = await user('B', { b: tUSDC, amount: 500_000_000n });
  await borrow('B', erin, tUSDC, pSOL, 1_000_000_000n);
  const bank = await fetchAccount(ctx, 'bank', pSOL.bank);
  console.log(`pSOL 银行 oracle_setup=${JSON.stringify(bank.config.oracleSetup)} max_age=${bank.config.oracleMaxAge}`);
}
// web3.js Connection 的 websocket 订阅会让进程一直挂着(曾留下跑完却不退出的进程),跑完显式退出。
void main().then(() => process.exit(0), error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
