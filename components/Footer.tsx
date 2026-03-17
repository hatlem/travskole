'use client';

import Link from 'next/link';
import { useSettings } from '@/components/SettingsProvider';

export default function Footer() {
  const settings = useSettings();
  const siteName = settings.site_name || 'Bjerke Ponniskole';
  const contactEmail = settings.contact_email || 'ponniskolen@bjerke.no';
  const contactAddress = settings.contact_address || 'Refstadveien 27, 0589 Oslo';
  const footerText = settings.footer_text || '';
  const instructorName = settings.instructor_name || 'Hege Arverud';
  const instructorCert = settings.instructor_certification || 'DNT-sertifisert';

  return (
    <footer className="bg-[#003B7A] text-white py-12">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid md:grid-cols-3 gap-8">
          <div>
            <h3 className="text-lg font-bold mb-4 uppercase tracking-wide">{siteName}</h3>
            {footerText && (
              <p className="text-sm text-white/70 leading-relaxed mb-3">
                {footerText}
              </p>
            )}
            <p className="text-sm text-white/70">
              Instruktør: <strong className="text-white/90">{instructorName}</strong> ({instructorCert})
            </p>
          </div>

          <div>
            <h3 className="text-lg font-bold mb-4 uppercase tracking-wide">Lenker</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/" className="text-white/70 hover:text-white transition">
                  Hjem
                </Link>
              </li>
              <li>
                <Link href="/arrangementer" className="text-white/70 hover:text-white transition">
                  Kurs & Leirer
                </Link>
              </li>
              <li>
                <Link href="/dashboard" className="text-white/70 hover:text-white transition">
                  Min Side
                </Link>
              </li>
              <li>
                <a href="https://bjerke.no" target="_blank" rel="noopener noreferrer" className="text-white/70 hover:text-white transition">
                  Bjerke Travbane
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-bold mb-4 uppercase tracking-wide">Kontakt</h3>
            <ul className="space-y-2 text-sm text-white/70">
              <li>
                E-post:{' '}
                <a href={`mailto:${contactEmail}`} className="hover:text-white transition">
                  {contactEmail}
                </a>
              </li>
              {settings.contact_phone && (
                <li>
                  Telefon:{' '}
                  <a href={`tel:${settings.contact_phone}`} className="hover:text-white transition">
                    {settings.contact_phone}
                  </a>
                </li>
              )}
              <li>Adresse: {contactAddress}</li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/20 mt-10 pt-8 text-sm text-center text-white/50">
          <p>&copy; {new Date().getFullYear()} {siteName}. Alle rettigheter reservert.</p>
        </div>
      </div>
    </footer>
  );
}
