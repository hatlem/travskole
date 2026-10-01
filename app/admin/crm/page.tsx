import Link from 'next/link';
import type { Metadata } from 'next';
import { CRM_GROUPS, CRM_QUICK_ACTIONS, groupHref } from '@/lib/admin-nav';
import { ButtonLink } from '@/components/admin/Button';
import { PageHeader } from '@/components/admin/PageHeader';

export const metadata: Metadata = { title: 'CRM' };

const GROUP_ICONS: Record<string, string> = {
  kunder: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  salg: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
  epost: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  rapporter: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
};

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2';

/** CRM-forsiden: «Hva vil du gjøre?» — vanlige handlinger og de fire områdene. */
export default function CrmIndexPage() {
  return (
    <div className="max-w-5xl">
      <PageHeader
        className=""
        title="Hva vil du gjøre?"
        description={
          <>
            CRM er kundeoversikten deres: alle dere har kontakt med, salg som pågår, og e-poster som går ut av seg selv.
            Start med en vanlig handling, eller velg et område.
          </>
        }
      />

      <section aria-labelledby="crm-quick-actions" className="mt-6">
        <h2 id="crm-quick-actions" className="sr-only">Vanlige handlinger</h2>
        <ul className="flex flex-wrap gap-3">
          {CRM_QUICK_ACTIONS.map((action, index) => (
            <li key={action.href}>
              <ButtonLink href={action.href} variant={index === 0 ? 'primary' : 'secondary'}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                {action.label}
              </ButtonLink>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="crm-areas" className="mt-10">
        <h2 id="crm-areas" className="sr-only">Områder</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {CRM_GROUPS.map((group) => (
            <article
              key={group.id}
              id={group.id}
              aria-labelledby={`crm-group-${group.id}`}
              className="scroll-mt-20 bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col"
            >
              <div className="flex items-start gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-bjerke-blue" aria-hidden="true">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={GROUP_ICONS[group.id]} />
                  </svg>
                </span>
                <div className="min-w-0">
                  <h3 id={`crm-group-${group.id}`} className="text-xl font-semibold text-gray-900">
                    <Link href={groupHref(group)} className={`rounded-sm hover:underline ${focusRing}`}>
                      {group.label}
                    </Link>
                  </h3>
                  <p className="mt-1 text-sm text-gray-600">{group.description}</p>
                </div>
              </div>
              <ul className="mt-4 divide-y divide-gray-100 border-t border-gray-100">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className={`group flex items-center justify-between gap-3 py-3 rounded-sm ${focusRing}`}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-gray-900 group-hover:text-blue-700">{item.label}</span>
                        <span className="block text-sm text-gray-500">{item.description}</span>
                      </span>
                      <svg className="w-4 h-4 shrink-0 text-gray-400 group-hover:text-blue-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
