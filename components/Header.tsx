'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="bg-[#003B7A] text-white sticky top-0 z-50">
      <nav className="max-w-6xl mx-auto px-4 py-4">
        <div className="flex justify-between items-center">
          {/* Logo - Placeholder fra Bjerke.no (inntil travskole får egen logo) */}
          <Link href="/" className="flex items-center">
            <Image 
              src="/bjerkebanen-logo-invertert.png" 
              alt="Bjerke Travbane" 
              width={180} 
              height={50}
              className="h-12 w-auto"
              priority
            />
            <span className="ml-3 text-lg font-semibold border-l border-white/30 pl-3">
              Travskole
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-6">
            <Link href="/" className="hover:text-blue-200 transition">
              Hjem
            </Link>
            <Link href="/courses" className="hover:text-blue-200 transition">
              Kurs & Leirer
            </Link>
            <Link 
              href="/dashboard" 
              className="bg-white text-[#003B7A] px-4 py-2 rounded-lg font-semibold hover:bg-gray-100 transition"
            >
              Min Side
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden"
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
          <div className="md:hidden mt-4 pb-4 space-y-3">
            <Link 
              href="/" 
              className="block hover:text-blue-200 transition"
              onClick={() => setMobileMenuOpen(false)}
            >
              Hjem
            </Link>
            <Link 
              href="/courses" 
              className="block hover:text-blue-200 transition"
              onClick={() => setMobileMenuOpen(false)}
            >
              Kurs & Leirer
            </Link>
            <Link 
              href="/dashboard" 
              className="block bg-white text-[#003B7A] px-4 py-2 rounded-lg font-semibold text-center hover:bg-gray-100 transition"
              onClick={() => setMobileMenuOpen(false)}
            >
              Min Side
            </Link>
          </div>
        )}
      </nav>
    </header>
  );
}
