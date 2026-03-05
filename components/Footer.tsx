'use client';

import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="bg-[#003B7A] text-white py-12">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid md:grid-cols-3 gap-8">
          <div>
            <h3 className="text-lg font-bold mb-4 uppercase tracking-wide">Bjerke Travskole</h3>
            <p className="text-sm text-white/70 leading-relaxed mb-3">
              Vi tilbyr trygg og lærerik travsport for barn og unge i alle aldre.
              Travskolen drives av Bjerke Travbane.
            </p>
            <p className="text-sm text-white/70">
              Instruktør: <strong className="text-white/90">Hege Arverud</strong> (DNT-sertifisert)
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
                <a href="mailto:travskolen@bjerke.no" className="hover:text-white transition">
                  travskolen@bjerke.no
                </a>
              </li>
              <li>Adresse: Refstadveien 27, 0589 Oslo</li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/20 mt-10 pt-8 text-sm text-center text-white/50">
          <p>&copy; {new Date().getFullYear()} Bjerke Travskole. Alle rettigheter reservert.</p>
        </div>
      </div>
    </footer>
  );
}
