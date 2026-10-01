'use client';

import Link from 'next/link';
import { buttonClass } from './Button';

type IconType = 'courses' | 'registrations' | 'users' | 'bookings' | 'activity' | 'search' | 'email';

interface EmptyStateAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface EmptyStateProps {
  icon?: IconType;
  title: string;
  description?: string;
  /** Neste steg — vises som primærknapp. */
  action?: EmptyStateAction;
  /** Et alternativ, f.eks. «Start fra en mal». */
  secondaryAction?: EmptyStateAction;
}

const PRIMARY = buttonClass('primary');
const SECONDARY = buttonClass('secondary');

function ActionButton({ action, className }: { action: EmptyStateAction; className: string }) {
  if (action.href) {
    return (
      <Link href={action.href} className={className}>
        {action.label}
      </Link>
    );
  }
  return (
    <button type="button" onClick={action.onClick} className={className}>
      {action.label}
    </button>
  );
}

function EmptyIcon({ type }: { type: IconType }) {
  const cls = 'h-24 w-24 text-gray-300';

  switch (type) {
    case 'courses':
      return (
        <svg className={cls} fill="none" viewBox="0 0 96 96" stroke="currentColor" strokeWidth={1.5}>
          <rect x="16" y="20" width="64" height="48" rx="4" />
          <path d="M16 32h64" />
          <path d="M28 44h20" />
          <path d="M28 52h12" />
          <circle cx="64" cy="48" r="8" />
          <path d="M60 48l3 3 5-6" />
          <path d="M32 72l4-4h24l4 4" />
        </svg>
      );
    case 'registrations':
      return (
        <svg className={cls} fill="none" viewBox="0 0 96 96" stroke="currentColor" strokeWidth={1.5}>
          <rect x="20" y="16" width="56" height="64" rx="4" />
          <path d="M32 32h32" />
          <path d="M32 42h32" />
          <path d="M32 52h20" />
          <path d="M32 62h16" />
          <circle cx="66" cy="60" r="12" />
          <path d="M62 60h8" />
          <path d="M66 56v8" />
        </svg>
      );
    case 'users':
      return (
        <svg className={cls} fill="none" viewBox="0 0 96 96" stroke="currentColor" strokeWidth={1.5}>
          <circle cx="48" cy="36" r="12" />
          <path d="M28 72c0-11.046 8.954-20 20-20s20 8.954 20 20" />
          <circle cx="72" cy="32" r="8" />
          <path d="M64 60c0-4 3.582-8 8-8s8 4 8 8" />
          <circle cx="24" cy="32" r="8" />
          <path d="M16 60c0-4 3.582-8 8-8s8 4 8 8" />
        </svg>
      );
    case 'bookings':
      return (
        <svg className={cls} fill="none" viewBox="0 0 96 96" stroke="currentColor" strokeWidth={1.5}>
          <rect x="16" y="24" width="64" height="52" rx="4" />
          <path d="M16 36h64" />
          <path d="M32 16v16" />
          <path d="M64 16v16" />
          <rect x="28" y="44" width="10" height="8" rx="1" />
          <rect x="43" y="44" width="10" height="8" rx="1" />
          <rect x="58" y="44" width="10" height="8" rx="1" />
          <rect x="28" y="58" width="10" height="8" rx="1" />
          <rect x="43" y="58" width="10" height="8" rx="1" />
        </svg>
      );
    case 'activity':
      return (
        <svg className={cls} fill="none" viewBox="0 0 96 96" stroke="currentColor" strokeWidth={1.5}>
          <circle cx="48" cy="48" r="32" />
          <path d="M48 28v20l14 14" />
          <path d="M36 18l-4-6" />
          <path d="M60 18l4-6" />
        </svg>
      );
    case 'search':
      return (
        <svg className={cls} fill="none" viewBox="0 0 96 96" stroke="currentColor" strokeWidth={1.5}>
          <circle cx="42" cy="42" r="20" />
          <path d="M56 56l18 18" strokeLinecap="round" />
          <path d="M34 38h16" />
          <path d="M34 46h10" />
        </svg>
      );
    case 'email':
      return (
        <svg className={cls} fill="none" viewBox="0 0 96 96" stroke="currentColor" strokeWidth={1.5}>
          <rect x="14" y="26" width="52" height="36" rx="4" />
          <path d="M14 30l26 18 26-18" />
          <path d="M66 44h10" />
          <path d="M72 38l6 6-6 6" />
          <circle cx="80" cy="70" r="8" />
          <path d="M77 70l2 2 4-4" />
        </svg>
      );
    default:
      return null;
  }
}

export function EmptyState({ icon = 'search', title, description, action, secondaryAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <EmptyIcon type={icon} />
      <h3 className="mt-4 text-lg font-medium text-gray-900">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-gray-600">{description}</p>}
      {(action || secondaryAction) && (
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {action && <ActionButton action={action} className={PRIMARY} />}
          {secondaryAction && <ActionButton action={secondaryAction} className={SECONDARY} />}
        </div>
      )}
    </div>
  );
}
