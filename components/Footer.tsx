'use client';

import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-300 py-12">
      <div className="max-w-6xl mx-auto px-4">
        <div className="grid md:grid-cols-3 gap-8">
          {/* About */}
          <div>
            <h3 className="text-white text-lg font-semibold mb-4">Bjerke Travskole</h3>
            <p className="text-sm">
              Vi tilbyr trygg og lærerik travsport for barn og unge i alle aldre.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-white text-lg font-semibold mb-4">Lenker</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/" className="hover:text-white transition">
                  Hjem
                </Link>
              </li>
              <li>
                <Link href="/courses" className="hover:text-white transition">
                  Kurs & Leirer
                </Link>
              </li>
              <li>
                <Link href="/dashboard" className="hover:text-white transition">
                  Min Side
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="text-white text-lg font-semibold mb-4">Kontakt</h3>
            <ul className="space-y-2 text-sm">
              <li>E-post: travskole@bjerke.no</li>
              <li>Telefon: +47 12 34 56 78</li>
              <li>Adresse: Bjerke Travbane, Oslo</li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-800 mt-8 pt-8 text-sm text-center">
          <p>&copy; {new Date().getFullYear()} Bjerke Travskole. Alle rettigheter reservert.</p>
        </div>
      </div>
    </footer>
  );
}
