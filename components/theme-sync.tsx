'use client';

import { useEffect } from 'react';

import { useSystemTheme } from '@/hooks/use-system-theme';

/**
 * Keeps the `dark` class on <html> in step with the device appearance.
 *
 * The inline script in the root layout sets the class for the first frame; this
 * owns every frame after it. Renders nothing — it exists only for the effect.
 */
export function ThemeSync() {
  const theme = useSystemTheme();

  useEffect(() => {
    // null means the hydrating render, where the appearance is not known yet.
    // The inline script already applied the right class, so leave it alone.
    if (theme === null) return;

    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  return null;
}
