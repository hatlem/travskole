'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/admin/crm/kontakter', label: 'Kontakter' },
  { href: '/admin/crm/bedrifter', label: 'Bedrifter' },
  { href: '/admin/crm/pipeline', label: 'Pipeline' },
  { href: '/admin/crm/oppgaver', label: 'Oppgaver' },
  { href: '/admin/crm/segmenter', label: 'Segmenter' },
  { href: '/admin/crm/import', label: 'Import' },
];

export function CrmTabs() {
  const pathname = usePathname();
  return (
    <div className="flex gap-1 border-b border-gray-200 mb-6">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-2 text-sm font-medium rounded-t-md border-b-2 -mb-px transition-colors ${
              active
                ? 'border-blue-600 text-blue-700 bg-blue-50'
                : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
