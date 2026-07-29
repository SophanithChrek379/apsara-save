'use client';

import { useEffect, useRef } from 'react';

/**
 * Modal plumbing that the browser does not give us for free: Escape to close,
 * a scroll-locked page behind, and focus kept inside the dialog and handed back
 * on exit. Radix/shadcn bundle all three; this is the no-dependency equivalent.
 *
 * Attach the returned ref to the dialog panel — the element carrying
 * role="dialog" — not to the full-screen positioning wrapper.
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose: () => void,
) {
  const panelRef = useRef<T>(null);

  // Callers pass inline arrows (`() => setOpen(false)`), so onClose changes
  // identity on every parent render. Reading it through a ref keeps the effects
  // below keyed on `open` alone instead of tearing down on unrelated renders.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    // Padding equal to the width the scrollbar gives up keeps the page behind
    // from jumping sideways as overflow goes hidden. Overlay scrollbars
    // (macOS, touch) measure 0, so the compensation is skipped there.
    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;

    // Restore the previous inline values rather than blanking them, so nesting
    // or a second lock cannot leave the page permanently unscrollable.
    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    if (!panel) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the panel itself, not its first button: with aria-labelledby set,
    // screen readers announce the dialog's title instead of "Close".
    panel.focus();

    // Queried on each Tab rather than cached — panel content can swap while
    // open (e.g. an image falling back to a placeholder).
    const focusable = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) =>
          el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden',
      );

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      const escaped = !panel.contains(active);

      // Wrap at whichever end Tab is leaving from; also reel focus back in if it
      // is already outside (browser chrome, a stray programmatic focus).
      if (event.shiftKey ? active === first || escaped : active === last || escaped) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Hand focus back to the trigger, unless it left the DOM meanwhile.
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  return panelRef;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');
