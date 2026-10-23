/**
 * INPUT: ANCHOR_WALLET(group admin、测试币 mint authority)、RPC_URL、可选 FAUCET_KEYPAIR、--symbol、--run-id。
 * OUTPUT: 指定 Pyth 测试币与银行、给水龙头/兑换台的代币、链下标签。
 * POSITION: 管理员 CLI,幂等:已存在的步骤会核对后跳过。SYNC: folder.md。
 *
 *   pnpm exec tsx scripts/add-pyth-bank.ts                         # 默认 pSOL
 *   pnpm exec tsx scripts/add-pyth-bank.ts --symbol pBTC --run-id r4
 */
import 'dotenv/config';
import { MINT_SIZE, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createInitializeMint2Instruction,
  createMintToInstruction, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';
import { PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram } from '@solana/web3.js';
import { deriveKeypair } from '../scenario/lib/actors';
import { bankConfig } from '../scenario/lib/bank-config';
import { pda } from '../scenario/lib/marginfi';
import { send } from '../scenario/lib/rpc';
import { createContext } from '../scenario/lib/runtime';
import { fetchAccount } from '../scenario/lib/state';
import { FEED_IDS, feedIdAsKey, pythPushAccount } from '../src/oracle/pyth';
import { parsePythBankArgs, PYTH_BANKS, pythBankSeeds } from '../src/oracle/pyth-banks';
import { nativeAmount } from '../src/faucet/config';
import { readKeypair } from './admin-runtime';
import { pgDb } from '../src/store/db';
import { loadLabels } from '../src/store/labels';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { console.log('用法: add-pyth-bank [--symbol pSOL|pBTC|pETH] [--run-id X] (默认 pSOL)'); return; }
  const { symbol, runId } = parsePythBankArgs(args), asset = PYTH_BANKS[symbol];
  const ctx = await createContext(runId), connection = ctx.provider.connection;
  const seeds = pythBankSeeds(symbol, runId), mint = deriveKeypair(seeds.mint), bank = deriveKeypair(seeds.bank);
  const group = ctx.actors.group.publicKey;
  const feed = pythPushAccount(FEED_IDS[asset.feed]);
  console.log(`group ${group.toBase58()}\nmint  ${mint.publicKey.toBase58()}\nbank  ${bank.publicKey.toBase58()}\nfeed  ${feed.toBase58()} (Pyth ${asset.feed}, shard 0)`);
  if (!await connection.getAccountInfo(group)) throw new Error('group 不存在:先跑剧本');

  // 1. 管理员是 mint authority;新资产统一 8 位,与常见跨链 BTC/ETH token 一致。
  if (!await connection.getAccountInfo(mint.publicKey)) {
    const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    await send(ctx, `create mint ${symbol}`, [SystemProgram.createAccount({ fromPubkey: ctx.admin.publicKey, newAccountPubkey: mint.publicKey,
      lamports: rent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }), createInitializeMint2Instruction(mint.publicKey, asset.decimals, ctx.admin.publicKey, null)], [mint]);
  } else {
    const existing = await getMint(connection, mint.publicKey);
    if (existing.decimals !== asset.decimals || !existing.mintAuthority?.equals(ctx.admin.publicKey)) throw new Error(`${symbol} mint 已存在但精度或 authority 不对`);
  }

  // 2. 银行风险参数照搬 tSOL。新 feed 的间隔实测可到约 7 分钟,900 秒留出余量;
  //    devnet 价格因此可能旧几分钟,但能减少正常借款/取款被 PriceStale 拒绝。
  if (!await connection.getAccountInfo(bank.publicKey)) {
    const fee = await fetchAccount(ctx, 'feeState', ctx.feeState);
    const b = bank.publicKey;
    await send(ctx, `add bank ${symbol}`, [await ctx.program.methods.lendingPoolAddBank({ ...bankConfig('tSOL'), oracleMaxAge: asset.maxAge }).accountsStrict({
      marginfiGroup: group, admin: ctx.admin.publicKey, feePayer: ctx.admin.publicKey, feeState: ctx.feeState, globalFeeWallet: fee.globalFeeWallet,
      bankMint: mint.publicKey, bank: b, liquidityVaultAuthority: pda(ctx, 'liquidity_vault_auth', b), liquidityVault: pda(ctx, 'liquidity_vault', b),
      insuranceVaultAuthority: pda(ctx, 'insurance_vault_auth', b), insuranceVault: pda(ctx, 'insurance_vault', b),
      feeVaultAuthority: pda(ctx, 'fee_vault_auth', b), feeVault: pda(ctx, 'fee_vault', b),
      rent: SYSVAR_RENT_PUBKEY, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).instruction()], [bank]);
  }

  // #region ep8-pyth-configure
  // 3. 绑定 Pyth:setup = 3(PythPushOracle),"oracle" 参数传的是 feed id(32 字节当 Pubkey),
  //    remaining account 传真正的价格账户,程序用它核对 feed id 是否一致(price.rs check_ai_and_feed_id)。
  const current = await fetchAccount(ctx, 'bank', bank.publicKey);
  if (!(current.config.oracleKeys[0] as PublicKey).equals(feedIdAsKey(FEED_IDS[asset.feed]))) {
    await send(ctx, `configure oracle ${symbol} (Pyth)`, [await ctx.program.methods.lendingPoolConfigureBankOracle(3, feedIdAsKey(FEED_IDS[asset.feed]))
      .accountsStrict({ group, admin: ctx.admin.publicKey, bank: bank.publicKey })
      .remainingAccounts([{ pubkey: feed, isSigner: false, isWritable: false }]).instruction()]);
  }
  // #endregion

  // 4. 预置约 100 份水龙头量;新币默认以 faucet grant 的 100 倍备货,可用环境变量覆盖。
  if (process.env.FAUCET_KEYPAIR) {
    const desk = readKeypair(process.env.FAUCET_KEYPAIR).publicKey, ata = getAssociatedTokenAddressSync(mint.publicKey, desk);
    const envName = `FAUCET_SETUP_${symbol.toUpperCase()}`;
    // pBTC 的备货是 0.5 这样的小数，不能直接 BigInt();按小数位换成原生单位。
    const amount = nativeAmount(process.env[envName] ?? asset.setupAmount, asset.decimals);
    const held = await connection.getTokenAccountBalance(ata).then(r => BigInt(r.value.amount)).catch(() => 0n);
    if (held < amount / 2n) await send(ctx, `mint ${symbol} to faucet`, [createAssociatedTokenAccountIdempotentInstruction(ctx.admin.publicKey, ata, desk, mint.publicKey),
      createMintToInstruction(mint.publicKey, ata, ctx.admin.publicKey, amount - held)]);
  }
  // 5. 链下标签:API、水龙头、兑换台按代币符号找银行。数据库连不上只提示,不影响链上结果。
  const db = pgDb();
  try { await loadLabels(db, { mints: { [symbol]: mint.publicKey.toBase58() }, banks: { [symbol]: bank.publicKey.toBase58() }, marginfiAccounts: {}, actors: {} }); }
  catch { console.error('标签未写入(数据库不可用),之后可重跑本脚本'); } finally { await db.close(); }
  console.log('完成。下一步: scripts/verify-pyth-bank.ts 在 devnet 上验证借款,然后 ingest 入库。');
}
// web3.js Connection 的 websocket 订阅会让进程一直挂着(曾留下跑完却不退出的进程),跑完显式退出。
void main().then(() => process.exit(0), error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
