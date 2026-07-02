'use client';

import { usePathname } from 'next/navigation';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

/**
 * Rendrer den offentlige headeren/footeren for alle sider UNNTATT admin-området.
 * Admin har sin egen fullstendige chrome (AdminShell) — der ville den offentlige
 * markedsfooteren og -headeren vært dobbel og malplassert.
 */
export default function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hideChrome = pathname?.startsWith('/admin') ?? false;

  return (
    <>
      {!hideChrome && <Header />}
      {children}
      {!hideChrome && <Footer />}
    </>
  );
}
