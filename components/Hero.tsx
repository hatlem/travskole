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
      className="relative h-[60vh] bg-cover bg-center" 
      style={{ backgroundImage: `url(${imageUrl})` }}
    >
      <div className="absolute inset-0 bg-black bg-opacity-40"></div>
      <div className="relative z-10 flex flex-col items-center justify-center h-full text-white px-4">
        <h1 className="text-5xl font-bold mb-4 text-center max-w-4xl">
          {title}
        </h1>
        <p className="text-xl mb-8 text-center max-w-2xl">
          {subtitle}
        </p>
        {ctaText && ctaLink && (
          <a 
            href={ctaLink}
            className="bg-[#003B7A] hover:bg-[#002855] px-8 py-3 rounded-lg font-semibold text-lg transition"
          >
            {ctaText}
          </a>
        )}
      </div>
    </div>
  );
}
