import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface ForegroundRewitnessOptions {
  readonly foreground: boolean;
  readonly enabled: boolean;
  readonly refetch: () => Promise<unknown>;
  /** A new explicit route activation must re-witness even when this window was
   * already foreground. Undefined preserves the ordinary foreground contract. */
  readonly requestKey?: string | number;
}

/**
 * Re-witnesses a mounted data surface whenever it becomes observable again.
 *
 * Hidden workspace modules may keep their React Query cache alive, but cached
 * data may not regain verified standing merely because the window is brought
 * forward. The synchronous foreground edge marks the surface as re-witnessing
 * before paint; focus and visibility restoration then use the same guarded
 * refetch path. A capability-derived `enabled` flag remains authoritative.
 */
export function useForegroundRewitness({
  foreground,
  enabled,
  refetch,
  requestKey,
}: ForegroundRewitnessOptions): boolean {
  const foregroundRef = useRef(foreground);
  const enabledRef = useRef(enabled);
  const previousForeground = useRef(foreground);
  const previousRequestKey = useRef(requestKey);
  const exposureActive = useRef(
    typeof document === 'undefined'
      ? true
      : document.visibilityState === 'visible' &&
          (typeof document.hasFocus !== 'function' || document.hasFocus()),
  );
  const rewitnessingRef = useRef(false);
  const requestRef = useRef(0);
  const [rewitnessing, setRewitnessing] = useState(false);

  foregroundRef.current = foreground;
  enabledRef.current = enabled;
  const enteredForeground = foreground && !previousForeground.current;
  const reactivatedRoute = foreground && !Object.is(previousRequestKey.current, requestKey);

  const rewitness = useCallback(() => {
    if (!foregroundRef.current || !enabledRef.current || rewitnessingRef.current) return;
    const request = ++requestRef.current;
    rewitnessingRef.current = true;
    setRewitnessing(true);
    void refetch().finally(() => {
      if (request !== requestRef.current) return;
      rewitnessingRef.current = false;
      setRewitnessing(false);
    });
  }, [refetch]);

  // Cached content becomes stale before the foreground frame is painted. A
  // regular effect would leave one verified old-data frame.
  useLayoutEffect(() => {
    const wasForeground = previousForeground.current;
    const priorRequestKey = previousRequestKey.current;
    previousForeground.current = foreground;
    previousRequestKey.current = requestKey;
    if ((!wasForeground && foreground) || (foreground && !Object.is(priorRequestKey, requestKey))) rewitness();
  }, [foreground, requestKey, rewitness]);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const restoreExposure = () => {
      if (document.visibilityState !== 'visible' || exposureActive.current) return;
      exposureActive.current = true;
      rewitness();
    };
    const onBlur = () => {
      exposureActive.current = false;
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        exposureActive.current = false;
        return;
      }
      if (typeof document.hasFocus !== 'function' || document.hasFocus()) restoreExposure();
    };

    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', restoreExposure);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', restoreExposure);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [rewitness]);

  useEffect(
    () => () => {
      // A force-close unmounts its module. Ignore any refetch completion that
      // was already in flight instead of scheduling state into a dead window.
      requestRef.current += 1;
      rewitnessingRef.current = false;
    },
    [],
  );

  return rewitnessing || enteredForeground || reactivatedRoute;
}
