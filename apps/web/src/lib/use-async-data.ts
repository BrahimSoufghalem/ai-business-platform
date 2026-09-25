'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** Small data-fetching hook with abort handling and a reload function. */
export function useAsyncData<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): AsyncState<T> & { reload: () => void; setData: (data: T) => void } {
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: true, error: null });
  const counterRef = useRef(0);

  const load = useCallback(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcher(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : 'error';
        setState({ data: null, loading: false, error: message });
      });
    return controller;
  }, deps);

  useEffect(() => {
    const controller = load();
    return () => controller.abort();
  }, [load]);

  const reload = useCallback(() => {
    counterRef.current += 1;
    load();
  }, [load]);

  const setData = useCallback((data: T) => {
    setState({ data, loading: false, error: null });
  }, []);

  return { ...state, reload, setData };
}
