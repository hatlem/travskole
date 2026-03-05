'use client';

import React from 'react';

interface HeroProps {
  title: string;
  subtitle: string;
  ctaText?: string;
  ctaLink?: string;
  imageUrl?: string;
}

export default function Hero({
  title,
  subtitle,
  ctaText,
  ctaLink,
  imageUrl = '/images/hero-sulky-track.jpg'
}: HeroProps) {
  return (
    <div
      className="relative h-[70vh] min-h-[500px] bg-cover bg-center"
      style={{ backgroundImage: `url(${imageUrl})` }}
    >
      {/* Gradient fallback when image is missing */}
      <div className="absolute inset-0 hero-gradient" />
      {/* Dark overlay for readability */}
      <div className="absolute inset-0 bg-black/40" />
      {/* Decorative diagonal element — inspired by bjerke.no's dynamic feel */}
      <div className="absolute bottom-0 left-0 right-0 h-24 bg-gray-50" style={{ clipPath: 'polygon(0 100%, 100% 100%, 100% 0)' }} />

      <div className="relative z-10 flex flex-col items-center justify-center h-full text-white px-4">
        <h1 className="text-4xl md:text-6xl font-bold mb-4 text-center max-w-4xl leading-tight">
          {title}
        </h1>
        <p className="text-lg md:text-xl mb-8 text-center max-w-2xl text-white/90">
          {subtitle}
        </p>
        {ctaText && ctaLink && (
          <a
            href={ctaLink}
            className="bg-white text-[#003B7A] hover:bg-gray-100 px-8 py-4 rounded-md font-bold text-base uppercase tracking-wide transition shadow-lg"
          >
            {ctaText}
          </a>
        )}
      </div>
    </div>
  );
}
