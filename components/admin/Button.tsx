import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

/**
 * Admin-knapper — ett visuelt system:
 * - primary: marineblå (bjerke-blue), sidens hovedhandling — maks én per skjermbilde/dialog.
 * - secondary: hvit med grå kant, alt annet.
 * - danger: rød, kun for selve bekreftelsen av noe som ikke kan angres (f.eks. i ConfirmModal).
 * - dangerText: rød tekstknapp for radhandlinger som «Slett».
 * - link: marineblå tekstknapp for radhandlinger som «Rediger».
 * Grønt brukes bare i statusmerker, aldri på knapper.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'dangerText' | 'link';
export type ButtonSize = 'sm' | 'md';

const BASE =
  'inline-flex items-center justify-center gap-2 font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bjerke-blue focus-visible:ring-offset-2 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

const SOLID = 'rounded-lg active:scale-[0.96] motion-reduce:active:scale-100';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: `${SOLID} bg-bjerke-blue text-white shadow-sm hover:bg-bjerke-blue-dark`,
  secondary: `${SOLID} border border-gray-300 bg-white text-gray-700 shadow-sm hover:bg-gray-50 hover:text-gray-900`,
  danger: `${SOLID} bg-red-600 text-white shadow-sm hover:bg-red-700 focus-visible:ring-red-600`,
  dangerText: 'rounded-md text-red-600 hover:text-red-700 hover:underline underline-offset-2 focus-visible:ring-red-600 focus-visible:ring-offset-1',
  link: 'rounded-md text-bjerke-blue hover:text-bjerke-blue-dark hover:underline underline-offset-2 focus-visible:ring-offset-1',
};

const SIZES: Record<ButtonSize, Record<'solid' | 'text', string>> = {
  md: { solid: 'min-h-10 px-4 py-2 text-sm', text: 'min-h-8 px-1 text-sm' },
  sm: { solid: 'min-h-8 px-3 py-1.5 text-sm', text: 'min-h-6 px-0.5 text-sm' },
};

const isText = (variant: ButtonVariant) => variant === 'dangerText' || variant === 'link';

/** Klassene for en knapp — bruk på <button>, <Link> eller <a> når komponentene under ikke passer. */
export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  extra = '',
): string {
  return [BASE, VARIANTS[variant], SIZES[size][isText(variant) ? 'text' : 'solid'], extra].filter(Boolean).join(' ');
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin motion-reduce:animate-none`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

interface ButtonOwnProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Viser spinner, deaktiverer knappen og setter aria-busy. */
  loading?: boolean;
  /** Tekst mens `loading` (f.eks. «Lagrer …»). Standard: vanlig innhold. */
  loadingLabel?: ReactNode;
}

export type ButtonProps = ButtonOwnProps & ComponentProps<'button'>;

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingLabel,
  className = '',
  disabled,
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}
      {...props}
    >
      {loading && <Spinner />}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  );
}

export type ButtonLinkProps = Omit<ButtonOwnProps, 'loading' | 'loadingLabel'> & ComponentProps<typeof Link>;

/** Navigasjon som ser ut som en knapp. Virker før hydrering (vanlig lenke). */
export function ButtonLink({ variant = 'primary', size = 'md', className = '', ...props }: ButtonLinkProps) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}
