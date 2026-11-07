/** INPUT: 最低余额、当前余额、时间。 OUTPUT: 是否应输出本小时首次告警。 POSITION: 专用服务余额告警限频。 */
export function lowBalanceWarning() {
  let lastWarning = Number.NEGATIVE_INFINITY;
  return (balance: number, threshold: number, now = Date.now()): boolean => {
    if (balance >= threshold || now - lastWarning < 3_600_000) return false;
    lastWarning = now;
    return true;
  };
}
