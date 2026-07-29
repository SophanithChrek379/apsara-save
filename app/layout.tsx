import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { ThemeSync } from '@/components/theme-sync';

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'Apsara Save — Daily Saving Tracker',
  description: 'Save $1.25 every day of 2026. Target goal: $456.25.',
};

/* Mobile browsers tint their chrome from this. Two media-scoped values let that
   bar follow the device appearance with no script involved. */
export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
};

/* The shadcn token sets are class-scoped (`@custom-variant dark (&:is(.dark *))`),
   so a media query alone cannot reach the dark palette — something has to put the
   class on <html>. Doing it here, before first paint, avoids the flash of the
   wrong palette that applying it from an effect would cause. ThemeSync keeps it
   in step afterwards; this only decides the first frame. */
const THEME_SCRIPT = `try{document.documentElement.classList.toggle('dark',window.matchMedia('(prefers-color-scheme: dark)').matches)}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the script below edits this element's class list
    // before React hydrates, so it legitimately differs from the server's HTML.
    <html
      lang="en"
      className={cn('font-sans', geist.variable)}
      suppressHydrationWarning
    >
      <body className="font-sans">
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
