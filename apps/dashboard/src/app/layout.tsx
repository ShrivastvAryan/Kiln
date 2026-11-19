import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';
import { AuthProvider } from '@/hooks/auth';
import './globals.css';

// Self-hosted by next/font (no layout shift, no requests to Google at runtime).
const sans = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-sans-family', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono-family', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Kiln', template: '%s · Kiln' },
  description: 'Kiln operator console: deploy Git repositories and watch builds in real time.',
  applicationName: 'Kiln',
  // iOS "Add to Home Screen": app name and status bar style (icon comes from app/apple-icon.png)
  appleWebApp: { capable: true, title: 'Kiln', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  themeColor: '#0c0a09',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
