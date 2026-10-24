/** INPUT: 固定 IDL、公开账户与数量。 OUTPUT: Anchor init/lending 指令。 POSITION: M7 无管理员构造器。 SYNC: folder.md。 */
import * as anchorModule from '@coral-xyz/anchor';
import type { Idl, Provider } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, type AccountMeta } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import idl from '../../decoder/idl/marginfi.idl.json';
import type { WalletAction } from '../types';
// 空 provider：这里只调用 accountsStrict().instruction()，绝不加载钱包或隐式访问 RPC。
// anchor 是 CommonJS 包：本地 tsx(原生 ESM)只认得出部分命名导出(BN 认不出),Vercel 编译成 CommonJS 后又没有 default。
// 取 default ?? 模块本身，两种运行方式都拿到完整导出。
const anchor = (anchorModule as { default?: typeof anchorModule }).default ?? anchorModule;
const program = new anchor.Program(idl as Idl, {} as Provider);
const pda = (seed: string, bank: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from(seed), bank.toBuffer()], program.programId)[0];
export const initInstruction = (group: PublicKey, account: PublicKey, wallet: PublicKey) => program.methods.marginfiAccountInitialize().accountsStrict({
  marginfiGroup: group, marginfiAccount: account, authority: wallet, feePayer: wallet, systemProgram: SystemProgram.programId,
}).instruction();
export function lendingInstruction(action: WalletAction, group: PublicKey, account: PublicKey, wallet: PublicKey, bank: PublicKey,
  ata: PublicKey, amount: bigint, all: boolean, remaining: AccountMeta[]) {
  const common = { marginfiGroup: group, marginfiAccount: account, signer: wallet, bank,
    bankLiquidityVault: pda('liquidity_vault', bank), tokenProgram: TOKEN_PROGRAM_ID };
  const n = new anchor.BN(amount.toString());
  if (action === 'deposit' || action === 'repay') {
    const builder = action === 'deposit' ? program.methods.lendingAccountDeposit(n) : program.methods.lendingAccountRepay(n, all);
    return builder.accountsStrict({ ...common, signerTokenAccount: ata }).instruction();
  }
  const builder = action === 'borrow' ? program.methods.lendingAccountBorrow(n) : program.methods.lendingAccountWithdraw(n, all);
  return builder.accountsStrict({ ...common, destinationTokenAccount: ata, bankLiquidityVaultAuthority: pda('liquidity_vault_auth', bank) })
    .remainingAccounts(remaining).instruction();
}
