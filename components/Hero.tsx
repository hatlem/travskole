import Image from 'next/image';
import Link from 'next/link';

interface HeroProps {
  title: string;
  subtitle: string;
  ctaText?: string;
  ctaLink?: string;
  imageUrl?: string;
}

/**
 * Forsidebilde med tekst. Bildet er LCP-elementet (priority); gradienten er kun
 * et gjennomskinnelig lag for lesbarhet. Lav på mobil så første arrangement synes.
 */
export default function Hero({
  title,
  subtitle,
  ctaText,
  ctaLink,
  imageUrl = '/images/hero-sulky-track.jpg',
}: HeroProps) {
  return (
    <div className="relative isolate h-[46svh] min-h-[340px] max-h-[520px] overflow-hidden bg-bjerke-blue md:h-[70vh] md:max-h-none md:min-h-[500px]">
      <Image src={imageUrl} alt="" fill priority sizes="100vw" className="-z-10 object-cover" />
      <div aria-hidden="true" className="absolute inset-0 -z-10 hero-overlay" />
      <div
        aria-hidden="true"
        className="absolute bottom-0 left-0 right-0 h-10 bg-gray-50 md:h-24"
        style={{ clipPath: 'polygon(0 100%, 100% 100%, 100% 0)' }}
      />

      <div className="flex h-full flex-col items-center justify-center px-4 pb-8 text-white md:pb-0">
        <h1 className="mb-3 max-w-4xl text-center text-3xl font-bold leading-tight text-balance drop-shadow-sm md:mb-4 md:text-6xl">
          {title}
        </h1>
        <p className="mb-6 max-w-2xl text-center text-base text-white/95 text-pretty md:mb-8 md:text-xl">
          {subtitle}
        </p>
        {ctaText && ctaLink && (
          <Link
            href={ctaLink}
            className="inline-flex min-h-12 items-center rounded-md bg-white px-6 text-sm font-bold uppercase tracking-wide text-bjerke-blue shadow-lg transition-colors hover:bg-gray-100 md:px-8 md:text-base"
          >
            {ctaText}
          </Link>
        )}
      </div>
    </div>
  );
}
