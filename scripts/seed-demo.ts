/** 管理员一次性创建真实演示仓位；私钥只写入用户配置目录。 */
import 'dotenv/config';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, VersionedTransaction, sendAndConfirmTransaction } from '@solana/web3.js';
import type { BuildResponse, PoolView, SendResponse, WalletView } from '../src/api/types';
import { decodeAccount } from '../src/decoder/account';
import { marginfiIdl } from '../src/decoder/idl';
import { pgDb } from '../src/store/db';
import { loadLabels } from '../src/store/labels';
import { readKeypair } from './admin-runtime';
import { createSecretFile, DEMO_POSITIONS, demoKeyPath, netPosition, positionPlan } from './demo-config';

const api = process.env.API_URL ?? 'http://localhost:8787';
const connection = new Connection(process.env.RPC_URL!, 'confirmed');

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${api}${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json() as T & { error?: unknown };
  if (!response.ok) throw new Error(`${path} ${response.status}: ${JSON.stringify(data.error ?? data)}`);
  return data;
}
const native = (amount: string, decimals: number) => String(BigInt(Math.round(Number(amount) * 10 ** decimals)));
const ui = (amount: string, decimals: number) => Number(amount) / 10 ** decimals;

async function main() {
  const dryRun = process.argv.slice(2).includes('--dry-run');
  if (process.argv.slice(2).some(arg => arg !== '--dry-run')) throw Error('用法: seed-demo [--dry-run]');
  if (!process.env.RPC_URL || !process.env.ANCHOR_WALLET) throw Error('需要 RPC_URL 与 ANCHOR_WALLET');
  if (await connection.getGenesisHash() !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG') throw Error('RPC 不是 Solana devnet');
  const admin = readKeypair(process.env.ANCHOR_WALLET);
  const pool = await request<PoolView>('/api/pool');
  if (!pool.group) throw Error('API 没有当前借贷池');
  const bank = Object.fromEntries(pool.banks.map(b => [b.label, b]));
  for (const symbol of new Set(Object.values(DEMO_POSITIONS).flatMap(p => [...Object.keys(p.deposits), ...Object.keys(p.borrows)])))
    if (!bank[symbol]) throw Error(`API 未返回银行 ${symbol}`);
  const keys: Record<string, Keypair> = {};
  for (const name of Object.keys(DEMO_POSITIONS)) {
    const path = demoKeyPath(name, homedir());
    if (!existsSync(path) && !dryRun) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const key = Keypair.generate();
      writeFileSync(path, createSecretFile(key), { flag: 'wx', mode: 0o600 });
      chmodSync(dirname(path), 0o700);
      keys[name] = key;
    } else if (existsSync(path)) { chmodSync(path, 0o600); keys[name] = readKeypair(path); }
    else keys[name] = Keypair.generate();
  }

  // 分两轮：先让所有账户存入，再统一借款——否则 borrower-1 借 pETH 时，pETH 的存款要等 borrower-2 才进池，流动性不够。
  for (const phase of ['deposit', 'borrow'] as const)
  for (const [name, target] of Object.entries(DEMO_POSITIONS)) {
    const effectiveTarget = netPosition(target);
    const wallet = keys[name], address = wallet.publicKey.toBase58();
    const walletView = await request<WalletView>(`/api/wallet/${address}`);
    const current = walletView.marginfi_account ? await currentPosition(walletView.marginfi_account, pool) : { deposits: {}, borrows: {} };
    const plan = positionPlan(effectiveTarget, current);
    console.log(`[${phase}] ${name} ${address}${dryRun ? ' (dry-run)' : ''}`);
    if (JSON.stringify(effectiveTarget) !== JSON.stringify(target)) console.log('提示:同一银行的存款与借款会在 marginfi 内净额结算,按净头寸播种。');
    if (dryRun) { console.log(JSON.stringify(phase === 'deposit' ? { deposits: plan.deposits } : { borrows: plan.borrows })); continue; }
    if (phase === 'borrow') {
      for (const [symbol, amount] of Object.entries(plan.borrows)) await execute(name, wallet, 'borrow', bank[symbol], amount);
      await label(name, address, (await request<WalletView>(`/api/wallet/${address}`)).marginfi_account);
      continue;
    }

    // 低于 0.01 SOL 才补到 0.05:付过手续费与开户租金后余额自然低于 0.05,不应每次重跑都补。
    if (Number(walletView.sol_lamports) < 10_000_000) {
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: wallet.publicKey, lamports: 50_000_000 - Number(walletView.sol_lamports) }));
      console.log(`SOL ${await sendAndConfirmTransaction(connection, tx, [admin])}`);
    }
    const mintIxs = [];
    for (const [symbol, amount] of Object.entries(plan.deposits)) {
      const b = bank[symbol], ata = getAssociatedTokenAddressSync(new PublicKey(b.mint), wallet.publicKey);
      const held = BigInt(walletView.tokens.find(token => token.label === symbol)?.amount ?? '0');
      const needed = BigInt(native(amount, b.decimals)) - held;
      mintIxs.push(createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata, wallet.publicKey, new PublicKey(b.mint)));
      if (needed > 0n) mintIxs.push(createMintToInstruction(new PublicKey(b.mint), ata, admin.publicKey, needed));
    }
    if (mintIxs.length) console.log(`mint ${await sendAndConfirmTransaction(connection, new Transaction().add(...mintIxs), [admin])}`);
    for (const [symbol, amount] of Object.entries(plan.deposits)) await execute(name, wallet, 'deposit', bank[symbol], amount);
  }
}

async function execute(name: string, wallet: Keypair, action: 'deposit' | 'borrow', b: PoolView['banks'][number], amount: string) {
  const built = await request<BuildResponse>('/api/build', { wallet: wallet.publicKey.toBase58(), action, bank: b.address, amount: native(amount, b.decimals) });
  if (!built.simulation.ok) throw new Error(`${name} ${action} ${b.label}: ${built.simulation.error?.message ?? 'simulation failed'}`);
  const tx = VersionedTransaction.deserialize(Buffer.from(built.transaction, 'base64'));
  tx.sign([wallet]);
  const sent = await request<SendResponse>('/api/send', { transaction: Buffer.from(tx.serialize()).toString('base64') });
  if (sent.status !== 'confirmed') throw new Error(`${name} ${action} ${b.label} failed: ${sent.error?.message ?? sent.status}`);
  console.log(`${action} ${amount} ${b.label}: ${sent.signature}`);
}

async function currentPosition(address: string, pool: PoolView) {
  const accountAddress = new PublicKey(address), info = await connection.getAccountInfo(accountAddress, 'confirmed');
  if (!info || !info.owner.equals(new PublicKey(pool.program))) throw Error(`链上 marginfi account 不存在或 owner 错误: ${address}`);
  const decoded = decodeAccount(info.data, marginfiIdl);
  if (!('data' in decoded) || decoded.name !== 'MarginfiAccount') throw Error(`无法解码 marginfi account: ${address}`);
  const data = decoded.data as { lending_account: { balances: { active: boolean; bank_pk: string; asset_shares: { value: number[] }; liability_shares: { value: number[] } }[] } };
  const positions = { deposits: {} as Record<string, string>, borrows: {} as Record<string, string> };
  for (const balance of data.lending_account.balances.filter(item => item.active)) {
    const bank = pool.banks.find(item => item.address === balance.bank_pk);
    if (!bank) continue;
    const bankInfo = await connection.getAccountInfo(new PublicKey(balance.bank_pk), 'confirmed');
    if (!bankInfo || !bankInfo.owner.equals(new PublicKey(pool.program))) throw Error(`银行账户缺失或 owner 错误: ${bank.label}`);
    const decodedBank = decodeAccount(bankInfo.data, marginfiIdl);
    if (!('data' in decodedBank) || decodedBank.name !== 'Bank') throw Error(`无法解码银行账户: ${bank.label}`);
    const values = decodedBank.data as { asset_share_value: { value: number[] }; liability_share_value: { value: number[] } };
    const deposit = ui(nativeFromShares(balance.asset_shares.value, values.asset_share_value.value), bank.decimals);
    const borrow = ui(nativeFromShares(balance.liability_shares.value, values.liability_share_value.value), bank.decimals);
    if (deposit > 0) positions.deposits[bank.label] = String(deposit);
    if (borrow > 0) positions.borrows[bank.label] = String(borrow);
  }
  return positions;
}

function nativeFromShares(shares: number[], shareValue: number[]) {
  const fixed = (value: number[]) => { const bytes = Buffer.from(value); return bytes.readBigUInt64LE(0) + (bytes.readBigInt64LE(8) << 64n); };
  return (fixed(shares) * fixed(shareValue) / (1n << 96n)).toString();
}

async function label(name: string, wallet: string, account: string | null) {
  if (!account) throw Error(`marginfi account 未返回: ${name}`);
  const db = pgDb();
  try { await loadLabels(db, { mints: {}, banks: {}, actors: { [name]: wallet }, marginfiAccounts: { [name]: account } }); }
  finally { await db.close(); }
}
void main().then(() => process.exit(0), error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
