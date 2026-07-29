'use client';

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-color-scheme: dark)';

export type SystemTheme = 'light' | 'dark';

/**
 * Tracks the device appearance and refreshes in the background.
 *
 * `change` on the media query list covers a tab that is awake and visible. On its
 * own that is not enough: a backgrounded tab can be frozen or discarded by the
 * browser, and a laptop that flips appearance while asleep never delivers the
 * event at all. So returning to the page re-reads the value too — otherwise a
 * tracker left open overnight keeps yesterday's palette until it is reloaded.
 *
 * visibilitychange and focus are both listened for on purpose: switching tabs
 * fires the first, returning to the window from another app fires the second, and
 * neither reliably fires for the other case.
 */
function subscribe(onStoreChange: () => void): () => void {
  const list = window.matchMedia(QUERY);

  list.addEventListener('change', onStoreChange);
  document.addEventListener('visibilitychange', onStoreChange);
  window.addEventListener('focus', onStoreChange);

  return () => {
    list.removeEventListener('change', onStoreChange);
    document.removeEventListener('visibilitychange', onStoreChange);
    window.removeEventListener('focus', onStoreChange);
  };
}

function getSnapshot(): SystemTheme {
  return window.matchMedia(QUERY).matches ? 'dark' : 'light';
}

/**
 * Returns null on the server and for the hydrating render, because the device
 * appearance is unknowable there — guessing would mismatch half the time. React
 * swaps in the real value immediately after, so callers should treat null as
 * "not known yet" rather than a default.
 */
function getServerSnapshot(): null {
  return null;
}

export function useSystemTheme(): SystemTheme | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
