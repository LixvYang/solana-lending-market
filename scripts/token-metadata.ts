/**
 * INPUT: ANCHOR_WALLET(测试币的 mint authority)、RPC_URL、assets/tokens/<符号>.json。
 * OUTPUT: tSOL / tUSDC / pSOL 的 Metaplex 链上元数据(名称、符号、指向 JSON 的 URI),钱包据此显示名称与图标。
 * POSITION: 管理员 CLI,幂等:不存在就创建,和 JSON 不一致才更新,一致则跳过。SYNC: folder.md。
 *
 *   pnpm exec tsx scripts/token-metadata.ts            # 先确认 assets/tokens 已推送、URI 能访问
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { deriveKeypair } from '../scenario/lib/actors';
import { createMetadataIx, decodeMetadata, metadataPda, updateMetadataIx, type TokenInfo } from '../src/metadata/metaplex';
import { cliRpc, readKeypair, sendInstructions } from './admin-runtime';

const BASE = 'https://raw.githubusercontent.com/LixvYang/solana-lending-market/main/assets/tokens';

async function main() {
  if (process.argv[2] === '--help') { console.log('用法: token-metadata  (需要 ANCHOR_WALLET,仅 devnet)'); return; }
  const admin = readKeypair(process.env.ANCHOR_WALLET), rpc = cliRpc();
  for (const symbol of ['tSOL', 'tUSDC', 'pSOL']) {
    const json = JSON.parse(readFileSync(`assets/tokens/${symbol}.json`, 'utf8')) as { name: string; symbol: string };
    const want: TokenInfo = { name: json.name, symbol: json.symbol, uri: `${BASE}/${symbol}.json` };
    // 钱包会去拉这个 URI;拉不到就别写上链,免得写进一个死链接。
    const probe = await fetch(want.uri, { signal: AbortSignal.timeout(15_000) });
    if (!probe.ok) throw new Error(`${want.uri} → ${probe.status},先推送 assets/tokens`);
    const mint = deriveKeypair(`mint/${symbol}`).publicKey, pda = metadataPda(mint);
    const existing = await rpc.getAccountInfo(pda, 'confirmed');
    const current = existing ? decodeMetadata(existing.data) : null;
    if (current && current.name === want.name && current.symbol === want.symbol && current.uri === want.uri) { console.log(`${symbol}: 已是最新,跳过`); continue; }
    const ix = current ? updateMetadataIx(mint, admin.publicKey, want) : createMetadataIx(mint, admin.publicKey, want);
    console.log(`${symbol}: ${current ? '更新' : '创建'} ${pda.toBase58()} → ${await sendInstructions(rpc, admin, [ix])}`);
  }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
