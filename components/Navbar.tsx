import React, { useState } from 'react';

interface NavLink {
  label: string;
  href: string;
}

interface NavbarProps {
  logoText?: string;
  links?: NavLink[];
}

const defaultLinks: NavLink[] = [
  { label: 'Hjem', href: '/' },
  { label: 'Kurs', href: '/kurs' },
  { label: 'Om oss', href: '/om-oss' },
  { label: 'Logg inn', href: '/logg-inn' },
];

export const Navbar: React.FC<NavbarProps> = ({
  logoText = 'Bjerke Travskole',
  links = defaultLinks,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <nav className="bg-[#003B7A] text-white sticky top-0 z-50 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-[70px]">
          {/* Logo */}
          <div className="flex-shrink-0">
            <a href="/" className="text-xl font-bold hover:text-gray-200 transition-colors">
              {logoText}
            </a>
          </div>

          {/* Desktop Navigation - hidden on mobile */}
          <div className="hidden md:flex space-x-8">
            {links.map((link, index) => (
              <a
                key={index}
                href={link.href}
                className="hover:text-gray-200 font-medium transition-colors"
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* Hamburger Menu Button - mobile only */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="md:hidden p-2 rounded-md hover:bg-[#002855] focus:outline-none focus:ring-2 focus:ring-white"
            aria-label="Toggle menu"
          >
            <svg
              className="h-6 w-6"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              {isMenuOpen ? (
                <path d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMenuOpen && (
        <div className="md:hidden border-t border-[#0052A3]">
          <div className="px-2 pt-2 pb-3 space-y-1">
            {links.map((link, index) => (
              <a
                key={index}
                href={link.href}
                className="block px-3 py-2 rounded-md hover:bg-[#002855] font-medium transition-colors"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
};
