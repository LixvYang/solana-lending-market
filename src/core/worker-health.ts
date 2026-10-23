/** Worker liveness is based on completed work, not a timer or RPC probe. */
import { createServer } from 'node:http';
export function workerHealthy(lastSuccess: number | null, now: number, periodMs: number): boolean {
  return lastSuccess !== null && now - lastSuccess <= periodMs * 3;
}
export function startWorkerHealth(periodMs: number, port: number | undefined, host = '0.0.0.0') {
  let lastSuccess: number | null = null;
  let server: ReturnType<typeof createServer> | null = null;
  if (port !== undefined) {
    server = createServer((req, res) => {
      const ok = req.url === '/healthz' && workerHealthy(lastSuccess, Date.now(), periodMs);
      res.statusCode = ok ? 200 : 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok }));
    });
    server.listen(port, host);
  }
  return { success: () => { lastSuccess = Date.now(); }, close: () => new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve()) };
}
