/** INPUT: Db、RPC、公开钱包地址。 OUTPUT: WalletView。 POSITION: M7 钱包只读服务。 SYNC: folder.md。 */
import { getAssociatedTokenAddressSync, unpackAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey, type AccountInfo } from '@solana/web3.js';
import type { Db } from '../store/db';
import type { WalletView } from './types';
import type { WalletServices } from './wallet-rpc';
import { getPool } from './queries';
import { walletAccount } from './builder/state';
import { publicKey } from './wallet-input';
export async function tokenBalance(rpc: Pick<WalletServices['rpc'], 'getAccountInfo'>, mint: PublicKey, wallet: PublicKey): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(mint, wallet);
  return ataAmount(ata, await rpc.getAccountInfo(ata, 'confirmed'), mint, wallet);
}
function ataAmount(ata: PublicKey, info: AccountInfo<Buffer> | null, mint: PublicKey, wallet: PublicKey): bigint {
  if (!info) return 0n;
  const account = unpackAccount(ata, info, TOKEN_PROGRAM_ID);
  if (!account.mint.equals(mint) || !account.owner.equals(wallet)) throw new Error('invalid token account');
  return account.amount;
}
export async function getWallet(db: Db, services: WalletServices, input: unknown): Promise<WalletView> {
  const wallet = publicKey(input), pool = await getPool(db);
  // 钱包账户与所有代币账户共用一次批量读取;钱包账户不存在时 SOL 余额为零。
  const atas = pool.banks.map(b => getAssociatedTokenAddressSync(new PublicKey(b.mint), wallet));
  const [walletInfo, ...infos] = await services.rpc.getMultipleAccountsInfo([wallet, ...atas], 'confirmed');
  const lamports = walletInfo?.lamports ?? 0;
  if (!Number.isSafeInteger(lamports) || lamports < 0) throw new Error('unsafe balance');
  const tokens = pool.banks.map((b, i) => ({ bank: b.address, mint: b.mint, label: b.label,
    decimals: b.decimals, amount: String(ataAmount(atas[i], infos[i], new PublicKey(b.mint), wallet)) }));
  const user = pool.group ? await walletAccount(db, wallet.toBase58(), pool.group) : null;
  return { wallet: wallet.toBase58(), sol_lamports: String(lamports), tokens, marginfi_account: user?.address ?? null, faucet_url: services.faucetUrl ?? null };
}
