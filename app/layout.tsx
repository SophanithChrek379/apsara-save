import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Apsara Save — Daily Saving Tracker',
  description: 'Save $1.25 every day of 2026. Target goal: $456.25.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 font-sans text-zinc-100">{children}</body>
    </html>
  );
}
