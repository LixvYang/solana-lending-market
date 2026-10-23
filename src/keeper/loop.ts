/** INPUT: 一轮刷新、等待/日志回调。 OUTPUT: 失败五次退出码。 POSITION: EP8 keeper 离线可测调度。 SYNC: folder.md。 */
export async function keeperLoop(tick: () => Promise<void>, wait: (ms: number) => Promise<void>, interval: number,
  stopped: () => boolean = () => false, log: (message: string) => void = console.error): Promise<number> {
  let failures = 0;
  while (!stopped()) {
    try { await tick(); failures = 0; }
    catch {
      failures++;
      // 不打印异常对象：底层 RPC 的异常可能含 api-key/私钥或请求正文。
      log(`price keeper refresh failed (${failures}/5)`);
      if (failures >= 5) return 1;
    }
    if (!stopped()) await wait(interval);
  }
  return 0;
}
export function intervalMs(args: string[]): number {
  // tSOL/tUSDC 最长允许 240 秒,tHYPE 900 秒;默认 180 秒留有余量,用户交易也会顺便刷新 mock 价格。
  if (!args.length) return 180_000;
  if (args.length !== 2 || args[0] !== '--interval' || !/^\d+$/.test(args[1])) throw Error('invalid interval');
  const seconds = Number(args[1]);
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 86400) throw Error('invalid interval');
  return seconds * 1000;
}
