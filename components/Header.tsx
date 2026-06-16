'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useSettings, useStrings } from '@/components/SettingsProvider';

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { data: session } = useSession();
  const settings = useSettings();
  const t = useStrings();

  const headerLabel = settings.site_name?.replace(/^Bjerke\s+/i, '').toUpperCase() || 'REGISTRERING';

  return (
    <header className="bg-bjerke-blue text-white sticky top-0 z-50 shadow-lg">
      <nav className="max-w-7xl mx-auto px-6 py-3">
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
                href="/auth/login"
                className="bg-white text-bjerke-blue px-5 py-2 rounded-md font-semibold text-sm uppercase tracking-wide hover:bg-gray-100 transition"
              >
                {t('nav.login')}
              </Link>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-1"
            aria-label="Toggle menu"
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
          <div className="md:hidden mt-4 pb-4 space-y-3 border-t border-white/20 pt-4">
            <Link
              href="/arrangementer"
              className="block uppercase text-sm tracking-wide hover:text-blue-200 transition"
              onClick={() => setMobileMenuOpen(false)}
            >
              {settings.nav_courses_label}
            </Link>
            {session ? (
              <>
                {(session.user.role === 'admin' || session.user.role === 'superadmin') && (
                  <Link
                    href="/admin"
                    className="block uppercase text-sm tracking-wide hover:text-blue-200 transition"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {t('nav.admin')}
                  </Link>
                )}
                <Link
                  href="/dashboard"
                  className="block bg-white text-bjerke-blue px-4 py-2 rounded-md font-semibold text-center text-sm uppercase tracking-wide hover:bg-gray-100 transition"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {t('nav.my_page')}
                </Link>
                <button
                  onClick={() => { setMobileMenuOpen(false); signOut({ callbackUrl: '/' }); }}
                  className="block w-full text-left uppercase text-sm tracking-wide text-white/70 hover:text-white transition"
                >
                  {t('nav.logout')}
                </button>
              </>
            ) : (
              <Link
                href="/auth/login"
                className="block bg-white text-bjerke-blue px-4 py-2 rounded-md font-semibold text-center text-sm uppercase tracking-wide hover:bg-gray-100 transition"
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
