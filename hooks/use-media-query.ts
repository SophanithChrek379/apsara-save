'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Subscribes to a CSS media query and re-renders on change.
 *
 * useSyncExternalStore rather than useState + useEffect: it reads the match
 * during render instead of one paint later, so a breakpoint-dependent branch
 * never renders the wrong variant first and swaps.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onStoreChange);
      return () => list.removeEventListener('change', onStoreChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    // No viewport on the server. Reporting false keeps the server and hydration
    // renders identical; callers should treat false as the mobile-first default.
    () => false,
  );
}
