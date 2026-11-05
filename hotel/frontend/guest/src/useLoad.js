import { useCallback, useEffect, useRef, useState } from 'react';
import { guestApi } from './api.js';

/**
 * Basit veri okuma: yükleniyor / hata / veri ve yeniden okuma. (Misafir uygulaması küçük kalsın diye sorgu
 * kütüphanesi yok.) `intervalMs` verilirse sekme görünürken aralıklarla tazelenir.
 *
 * @param {string | null} path @param {{ intervalMs?: number }} [options]
 */
export function useLoad(path, { intervalMs } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) });
  const controller = useRef(null);
  const load = useCallback(
    async ({ quiet = false } = {}) => {
      if (!path) return;
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      if (!quiet) setState((previous) => ({ ...previous, loading: true, error: null }));
      try {
        const data = await guestApi(path, { signal: current.signal });
        if (!current.signal.aborted) setState({ data, error: null, loading: false });
      } catch (error) {
        if (error?.name !== 'AbortError' && !current.signal.aborted) setState((previous) => ({ data: quiet ? previous.data : null, error, loading: false }));
      }
    },
    [path],
  );
  useEffect(() => {
    load();
    return () => controller.current?.abort();
  }, [load]);
  useEffect(() => {
    if (!intervalMs) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load({ quiet: true });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, load]);
  return { ...state, reload: load, setData: (data) => setState((previous) => ({ ...previous, data })) };
}
