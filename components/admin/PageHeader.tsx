import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: ReactNode;
  /** Én linje om hva siden er til. */
  description?: ReactNode;
  /** Sidens hovedhandling (helst én primærknapp) og ev. sekundære. */
  actions?: ReactNode;
  className?: string;
}

/** Felles sidetopp i admin: tittel, én forklarende linje og handlinger til høyre. */
export function PageHeader({ title, description, actions, className = 'mb-6' }: PageHeaderProps) {
  return (
    <div className={`flex flex-wrap items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-gray-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
