'use client';

import { usePathname } from 'next/navigation';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { FeedbackWidget } from '@/components/FeedbackWidget';
import { hidesFloatingFeedbackOnMobile } from '@/lib/site-chrome';

/**
 * Rendrer den offentlige headeren/footeren for alle sider UNNTATT admin-området.
 * Admin har sin egen fullstendige chrome (AdminShell) — der ville den offentlige
 * markedsfooteren og -headeren vært dobbel og malplassert. I admin ligger
 * tilbakemeldingsknappen i toppfeltet (AdminShell) i stedet for å flyte over lagre-linjer.
 */
export default function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hideChrome = pathname?.startsWith('/admin') ?? false;

  if (hideChrome) return <>{children}</>;

  return (
    <>
      <a
        href="#innhold"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 focus:font-semibold focus:text-bjerke-blue focus:shadow-lg focus:outline-2 focus:outline-bjerke-blue"
      >
        Hopp til innhold
      </a>
      <Header />
      <div id="innhold" tabIndex={-1} className="outline-none">
        {children}
      </div>
      <Footer />
      <FeedbackWidget hideOnMobile={hidesFloatingFeedbackOnMobile(pathname)} />
    </>
  );
}
