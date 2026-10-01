'use client';

import { useLinkStatus } from 'next/link';

/**
 * Liten spinner inne i en <Link> mens siden den peker til lastes, så et klikk
 * aldri ser ut som om det ble borte. Må ligge inni <Link>.
 */
export function LinkPending({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      className={`${className} inline-block shrink-0 rounded-full border-2 border-current border-t-transparent transition-opacity motion-safe:animate-spin ${
        pending ? 'opacity-70 delay-100' : 'opacity-0'
      }`}
    />
  );
}
