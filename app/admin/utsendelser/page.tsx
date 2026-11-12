import Link from 'next/link';
import { PageHeader } from '@/components/admin/PageHeader';
import { Badge } from '@/components/admin/StatusBadge';
import { EmptyState } from '@/components/admin/EmptyState';
import { getUtsendelser } from '@/lib/utsendelser/config';
import { loadUtsendelseSummary } from '@/lib/utsendelser/overview';
import { STATUS_BADGE, formatCount } from './status';

export const dynamic = 'force-dynamic';

export default async function UtsendelserPage() {
  const summaries = await Promise.all((await getUtsendelser()).map(loadUtsendelseSummary));

  return (
    <div>
      <PageHeader
        title="Utsendelser"
        description="E-poster til mange på én gang. Les e-postene, endre teksten og send til én gruppe om gangen."
      />
      {summaries.length === 0 ? (
        <EmptyState title="Ingen utsendelser ennå" description="Når en utsendelse er lagt opp, finner du den her." />
      ) : (
        <ul className="space-y-3">
          {summaries.map((s) => {
            const badge = STATUS_BADGE[s.status];
            return (
              <li key={s.id}>
                <Link
                  href={`/admin/utsendelser/${s.id}`}
                  className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white px-5 py-4 hover:border-gray-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900">{s.navn}</p>
                    {s.beskrivelse && <p className="mt-0.5 text-sm text-gray-600">{s.beskrivelse}</p>}
                    <p className="mt-1 text-sm text-gray-700">
                      Sendt til {formatCount(s.totals.sent)} av {formatCount(s.totals.sent + s.totals.remaining)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Badge className={badge.className}>{badge.label}</Badge>
                    <span aria-hidden="true" className="text-gray-400">→</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
