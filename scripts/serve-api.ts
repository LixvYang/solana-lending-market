/** INPUT: DATABASE_URL / PORT / 可选 RPC_URL / FAUCET_URL。 OUTPUT: API 服务。 POSITION: EP7/8 CLI，无管理员钱包。 SYNC: 同步 folder.md。 */
import 'dotenv/config';
import { rpcConnection } from '../src/api/wallet-rpc';
import { pgDb } from '../src/store/db';
import { createApiServer, hostAddress, portNumber } from '../src/api/server';
function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('用法: serve-api (PORT 默认 8787)');
    return;
  }
  if (args.length)
    throw new Error('invalid arguments');
  const port = portNumber(process.env.PORT), db = pgDb();
  // 无 RPC 时只读服务照常启动；这里永不读取 ANCHOR_WALLET。
  const services = process.env.RPC_URL ? { rpc: rpcConnection(process.env.RPC_URL), faucetUrl: process.env.FAUCET_URL, readUserFromChain: true } : undefined;
  const server = createApiServer(db, services);
  server.on('error', () => { console.error('API server failed'); void db.close(); process.exitCode = 1; });
  const host = hostAddress();
  server.listen(port, host, () => console.log(`API listening on http://${host}:${port}`));
  const stop = () => server.close(() => { void db.close(); });
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
try {
  main();
}
catch {
  console.error('API startup failed; check arguments and PORT');
  process.exitCode = 1;
}
