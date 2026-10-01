'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useSettings, useStrings } from '@/components/SettingsProvider';

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { data: session } = useSession();
  const settings = useSettings();
  const t = useStrings();
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Esc lukker mobilmenyen og gir fokus tilbake til menyknappen.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMobileMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileMenuOpen]);

  const headerLabel = settings.site_name?.replace(/^Bjerke\s+/i, '').toUpperCase() || 'REGISTRERING';

  return (
    <header className="bg-bjerke-blue text-white sticky top-0 z-50 shadow-lg">
      <nav aria-label="Hovedmeny" className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
        <div className="flex justify-between items-center">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/bjerkebanen-logo-invertert.png"
              alt="Bjerke Travbane"
              width={160}
              height={45}
              className="h-10 w-auto"
              priority
            />
            <span className="text-lg font-bold tracking-wide text-blue-200 border-l border-white/20 pl-3">
              {headerLabel}
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-8">
            <Link href="/arrangementer" className="nav-link text-white/90 hover:text-white transition">
              {settings.nav_courses_label}
            </Link>
            {session ? (
              <>
                {(session.user.role === 'admin' || session.user.role === 'superadmin') && (
                  <Link href="/admin" className="nav-link text-white/90 hover:text-white transition">
                    {t('nav.admin')}
                  </Link>
                )}
                <Link
                  href="/dashboard"
                  className="bg-white text-bjerke-blue px-5 py-2 rounded-md font-semibold text-sm uppercase tracking-wide hover:bg-gray-100 transition"
                >
                  {t('nav.my_page')}
                </Link>
                <button
                  onClick={() => signOut({ callbackUrl: '/' })}
                  className="text-white/70 hover:text-white text-sm uppercase tracking-wide transition"
                >
                  {t('nav.logout')}
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="bg-white text-bjerke-blue px-5 py-2 rounded-md font-semibold text-sm uppercase tracking-wide hover:bg-gray-100 transition"
              >
                {t('nav.login')}
              </Link>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            ref={menuButtonRef}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden -mr-2 flex h-11 w-11 items-center justify-center rounded-md hover:bg-white/10"
            aria-label={mobileMenuOpen ? 'Lukk meny' : 'Åpne meny'}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div id="mobile-menu" className="md:hidden mt-3 pb-3 space-y-1 border-t border-white/20 pt-3">
            <Link
              href="/arrangementer"
              className="flex min-h-11 items-center uppercase text-sm tracking-wide hover:text-blue-200 transition"
              onClick={() => setMobileMenuOpen(false)}
            >
              {settings.nav_courses_label}
            </Link>
            {session ? (
              <>
                {(session.user.role === 'admin' || session.user.role === 'superadmin') && (
                  <Link
                    href="/admin"
                    className="flex min-h-11 items-center uppercase text-sm tracking-wide hover:text-blue-200 transition"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {t('nav.admin')}
                  </Link>
                )}
                <Link
                  href="/dashboard"
                  className="flex min-h-11 items-center justify-center bg-white text-bjerke-blue px-4 rounded-md font-semibold text-sm uppercase tracking-wide hover:bg-gray-100 transition"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {t('nav.my_page')}
                </Link>
                <button
                  onClick={() => { setMobileMenuOpen(false); signOut({ callbackUrl: '/' }); }}
                  className="flex min-h-11 w-full items-center text-left uppercase text-sm tracking-wide text-white/80 hover:text-white transition"
                >
                  {t('nav.logout')}
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="flex min-h-11 items-center justify-center bg-white text-bjerke-blue px-4 rounded-md font-semibold text-sm uppercase tracking-wide hover:bg-gray-100 transition"
                onClick={() => setMobileMenuOpen(false)}
              >
                {t('nav.login')}
              </Link>
            )}
          </div>
        )}
      </nav>
    </header>
  );
}
