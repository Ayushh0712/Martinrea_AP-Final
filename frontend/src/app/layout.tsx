import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Martinrea — Automation Suite',
  description:
    'Accounts payable automation — capture, match, route, and approve every supplier invoice with a full audit trail.',
  icons: { icon: '/martinrea-logo.png' },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans antialiased bg-canvas text-ink">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
