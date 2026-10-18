import { useCallback, useEffect, useRef } from "react";

/**
 * Debounces saves while typing, and flushes any pending save when the
 * component unmounts (e.g. navigating away) so nothing is lost.
 */
export function useAutosave<T>(save: (value: T) => Promise<unknown>, delay = 600) {
  const pending = useRef<T | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const saveRef = useRef(save);
  saveRef.current = save;

  /** Saves anything pending now. Resolves once it's written. */
  const flush = useCallback((): Promise<void> => {
    window.clearTimeout(timer.current);
    if (pending.current === null) return Promise.resolve();
    const value = pending.current;
    pending.current = null;
    return saveRef.current(value).then(
      () => undefined,
      (e) => console.error("Save failed", e),
    );
  }, []);

  const schedule = useCallback(
    (value: T) => {
      pending.current = value;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, delay);
    },
    [delay, flush],
  );

  useEffect(() => {
    const onUnload = () => void flush();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      void flush();
    };
  }, [flush]);

  return { schedule, flush };
}
