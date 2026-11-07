import { useEffect, useRef, useState } from 'react';

/**
 * 定时刷新。后台刷新是**静默**的:
 * - 刷新期间保留上一次的数据,不置灰、不出现骨架、不跳版面;
 * - 新数据和旧数据完全相同时不触发重渲染(用序列化结果比较),页面不会无谓地重绘;
 * - 标签页在后台时暂停轮询,切回来立刻刷新一次,省 RPC/数据库请求;
 * - 刷新失败时保留旧数据,只记录错误(下一次成功会清掉)。
 * loading 只在"第一次还没有任何数据"时为 true。
 */
export function usePoll<T>(load: () => Promise<T>, deps: unknown[], everyMs = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let alive = true;
    let last = '';
    const run = async () => {
      if (document.hidden) return;
      try {
        const next = await loadRef.current();
        if (!alive) return;
        const serialized = JSON.stringify(next);
        if (serialized !== last) { last = serialized; setData(next); }
        setError(null);
        setUpdatedAt(new Date());
      } catch (e) { if (alive) setError(e); }
    };
    void run();
    const timer = setInterval(run, everyMs);
    const onVisible = () => { if (!document.hidden) void run(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, updatedAt, loading: data === null && error === null };
}
