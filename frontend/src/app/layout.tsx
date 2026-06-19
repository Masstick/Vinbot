import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import { Sidebar } from '@/components/Sidebar';
import { CurrentUserProvider } from '@/lib/CurrentUserContext';
import './globals.css';

const geist = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Vinbot — Arbitrage Vinted',
  description: 'Bot de surveillance et outil d\'analyse achat-revente en temps réel',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full bg-zinc-950 text-zinc-50 flex flex-col lg:flex-row">
        <CurrentUserProvider>
          <Sidebar />
          <main className="flex-1 min-w-0 w-full px-4 py-6 md:p-6 lg:p-8 max-w-7xl mx-auto page-transition">
            {children}
          </main>
        </CurrentUserProvider>
      </body>
    </html>
  );
}

