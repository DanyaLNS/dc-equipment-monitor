import { useEffect, useState } from 'react';
import { ApiError, type Api, type Reply } from './api';

export function usePoll<T>(api: Api, path: string, revision: number) {
  const [result, setResult] = useState<{ path: string; data?: Reply<T>; error?: ApiError }>({ path });
  useEffect(() => {
    let active = true;
    let pending: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout>;
    let immediate = false;
    let retryAt = 0;
    async function update() {
      if (!active || document.hidden || pending) return;
      if (Date.now() < retryAt) {
        timer = setTimeout(update, retryAt - Date.now());
        return;
      }
      const started = performance.now();
      pending = new AbortController();
      try {
        const data = await api.request<T>(path, { signal: pending.signal });
        if (active && !pending.signal.aborted) setResult({ path, data });
      } catch (cause) {
        if (active && !pending.signal.aborted) {
          const error = cause as ApiError;
          retryAt = error.retryAt || 0;
          setResult(previous => ({ path, data: previous.path === path ? previous.data : undefined, error }));
        }
      } finally {
        pending = undefined;
        if (active && !document.hidden) {
          timer = setTimeout(update, immediate ? 0 : Math.max(0, 5000 - (performance.now() - started)));
        }
        immediate = false;
      }
    }
    function visibility() {
      clearTimeout(timer);
      if (document.hidden) pending?.abort();
      else if (pending) immediate = true;
      else void update();
    }
    document.addEventListener('visibilitychange', visibility);
    void update();
    return () => {
      active = false;
      clearTimeout(timer);
      pending?.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [api, path, revision]);
  return result.path === path ? result : { path };
}
