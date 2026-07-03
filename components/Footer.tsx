'use client';

import Link from 'next/link';
import { useSettings, useStrings } from '@/components/SettingsProvider';
import { LEGAL_PAGES } from '@/lib/legal-defaults';

export default function Footer() {
  const settings = useSettings();
  const t = useStrings();
  const siteName = settings.site_name || 'Bjerke';
  const contactEmail = settings.contact_email || '';
  const contactAddress = settings.contact_address || '';
  const footerText = settings.footer_text || '';
  const instructorName = settings.instructor_name || '';
  const instructorCert = settings.instructor_certification || '';

  return (
    <footer className="bg-bjerke-blue text-white py-12">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid md:grid-cols-3 gap-8">
          <div>
            <h3 className="text-lg font-bold mb-4 uppercase tracking-wide">{siteName}</h3>
            {footerText && (
              <p className="text-sm text-white/70 leading-relaxed mb-3">
                {footerText}
              </p>
            )}
            {instructorName && (
              <p className="text-sm text-white/70">
                {t('footer.instructor_label')} <strong className="text-white/90">{instructorName}</strong>
                {instructorCert ? ` (${instructorCert})` : ''}
              </p>
            )}
          </div>

          <div>
            <h3 className="text-lg font-bold mb-4 uppercase tracking-wide">{t('footer.links_heading')}</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/" className="text-white/70 hover:text-white transition">
                  {t('footer.home')}
                </Link>
              </li>
              <li>
                <Link href="/arrangementer" className="text-white/70 hover:text-white transition">
                  {settings.nav_courses_label || 'Kurs & Leirer'}
                </Link>
              </li>
              <li>
                <Link href="/dashboard" className="text-white/70 hover:text-white transition">
                  Min Side
                </Link>
              </li>
              <li>
                <a href="https://bjerke.no" target="_blank" rel="noopener noreferrer" className="text-white/70 hover:text-white transition">
                  {t('footer.parent_site')}
                </a>
              </li>
              {LEGAL_PAGES.map((page) => (
                <li key={page.slug}>
                  <Link href={`/${page.slug}`} className="text-white/70 hover:text-white transition">
                    {page.navLabel}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/feedback" className="text-white/70 hover:text-white transition">
                  {t('feedback.footer_link')}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-bold mb-4 uppercase tracking-wide">{t('footer.contact_heading')}</h3>
            <ul className="space-y-2 text-sm text-white/70">
              <li>
                {t('footer.email_label')}{' '}
                <a href={`mailto:${contactEmail}`} className="hover:text-white transition">
                  {contactEmail}
                </a>
              </li>
              {settings.contact_phone && (
                <li>
                  {t('footer.phone_label')}{' '}
                  <a href={`tel:${settings.contact_phone}`} className="hover:text-white transition">
                    {settings.contact_phone}
                  </a>
                </li>
              )}
              <li>{t('footer.address_label')} {contactAddress}</li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/20 mt-10 pt-8 text-sm text-center text-white/50">
          <p>&copy; {new Date().getFullYear()} {siteName}. {t('footer.copyright')}</p>
        </div>
      </div>
    </footer>
  );
}
