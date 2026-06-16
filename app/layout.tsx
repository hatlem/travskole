import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Providers from "@/components/Providers";
import { SettingsProvider } from "@/components/SettingsProvider";
import { FeedbackWidget } from "@/components/FeedbackWidget";
import { getSettings } from "@/lib/settings";

export const dynamic = 'force-dynamic';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  return {
    title: {
      default: s.site_name,
      template: `%s | ${s.site_name}`,
    },
    description: s.site_description,
    openGraph: {
      type: 'website',
      locale: 'nb_NO',
      siteName: s.site_name,
      title: s.site_name,
      description: s.site_short_description,
    },
    robots: {
      index: true,
      follow: true,
    },
    icons: {
      icon: '/favicon.svg',
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const settings = await getSettings();
  // SECURITY: kun gyldige container-ID-er injiseres i inline-script
  // (JSON.stringify alene escaper ikke '</script>')
  const gtmId = /^GTM-[A-Z0-9]+$/.test(settings.gtm_id) ? settings.gtm_id : '';

  return (
    <html lang="nb">
      <head>
        {/* Google Tag Manager — configured via admin settings (gtm_id) */}
        {gtmId && (
          <Script id="gtm-head" strategy="afterInteractive">
            {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer',${JSON.stringify(gtmId)});`}
          </Script>
        )}
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* Google Tag Manager (noscript) */}
        {gtmId && (
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(gtmId)}`}
              height="0"
              width="0"
              style={{display:'none',visibility:'hidden'}}
            />
          </noscript>
        )}
        <Providers>
          <SettingsProvider settings={settings}>
            <Header />
            {children}
            <Footer />
            <FeedbackWidget />
          </SettingsProvider>
        </Providers>
      </body>
    </html>
  );
}
