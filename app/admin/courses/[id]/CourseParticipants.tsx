'use client';

import { useState } from 'react';
import { useToast } from '@/components/admin/Toast';
import { Badge } from '@/components/admin/StatusBadge';
import { formatPhone } from '@/lib/admin-format';
import { paymentStatusBadge } from '@/lib/payments/badge';

export interface CourseParticipant {
  id: number;
  status: string;
  paymentStatus: string;
  paymentProvider: string | null;
  createdAt: string;
  /** Barnet, eller den voksne selv på voksenarrangementer. */
  name: string;
  isAdult: boolean;
  age: number | null;
  allergies: string | null;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
}

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Venter' },
  { value: 'confirmed', label: 'Bekreftet' },
  { value: 'waitlist', label: 'Venteliste' },
  { value: 'cancelled', label: 'Avlyst' },
];

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-900',
  confirmed: 'bg-green-100 text-green-800',
  waitlist: 'bg-blue-100 text-blue-900',
  cancelled: 'bg-gray-200 text-gray-700',
};

const PROVIDERS: Record<string, string> = { stripe: 'kort', vipps: 'Vipps' };

function Payment({ status, provider }: { status: string; provider: string | null }) {
  const badge = paymentStatusBadge(status);
  if (!badge) return <span className="text-gray-500">Ikke betalt</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge className={badge.className}>{badge.label}</Badge>
      {provider && <span className="text-xs text-gray-600">med {PROVIDERS[provider] ?? provider}</span>}
    </span>
  );
}

function StatusSelect({ reg, busy, onChange }: { reg: CourseParticipant; busy: boolean; onChange: (status: string) => void }) {
  return (
    <select
      value={reg.status}
      onChange={(e) => onChange(e.target.value)}
      disabled={busy}
      aria-label={`Status for ${reg.name}`}
      className={`min-h-9 cursor-pointer rounded-full border-0 py-1 pl-3 pr-8 text-xs font-semibold focus:ring-2 focus:ring-bjerke-blue ${
        STATUS_COLORS[reg.status] ?? 'bg-gray-100 text-gray-800'
      } ${busy ? 'cursor-wait opacity-50' : ''}`}
    >
      {STATUS_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Deltakerlista på kurssiden: allergier, kontakt og betaling synlig uten å åpne noe. */
export function CourseParticipants({ registrations: initial, adultCourse }: { registrations: CourseParticipant[]; adultCourse: boolean }) {
  const [registrations, setRegistrations] = useState(initial);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const { toast } = useToast();

  async function updateStatus(reg: CourseParticipant, status: string) {
    setUpdatingId(reg.id);
    try {
      const res = await fetch(`/api/admin/registrations/${reg.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Statusen ble ikke endret. Prøv igjen.');
      setRegistrations((prev) => prev.map((r) => (r.id === reg.id ? { ...r, status } : r)));
      const label = STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
      toast(`${reg.name} er satt til «${label}»`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt. Prøv igjen om litt.', 'error');
    } finally {
      setUpdatingId(null);
    }
  }

  const personHeading = adultCourse ? 'Deltaker' : 'Barn';

  return (
    <section aria-labelledby="deltakerliste" className="overflow-hidden rounded-xl border border-gray-200 bg-white print:hidden">
      <h2 id="deltakerliste" className="border-b border-gray-200 bg-gray-50 px-4 py-3 text-base font-semibold text-gray-900 sm:px-6">
        Deltakere <span className="font-normal tabular-nums text-gray-600">({registrations.length})</span>
      </h2>

      {registrations.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="font-medium text-gray-900">Ingen har meldt seg på ennå</p>
          <p className="mt-1 text-sm text-gray-600">
            Påmeldinger fra nettsiden dukker opp her. Du kan også legge inn en påmelding selv under Påmeldinger.
          </p>
        </div>
      ) : (
        <>
          {/* Mobil: kort */}
          <ul className="divide-y divide-gray-100 md:hidden">
            {registrations.map((reg) => (
              <li key={reg.id} className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">
                      {reg.name}
                      {reg.age !== null && <span className="font-normal text-gray-600"> · {reg.age} år</span>}
                    </p>
                    {!reg.isAdult && <p className="text-sm text-gray-600">Foresatt: {reg.parentName}</p>}
                  </div>
                  <StatusSelect reg={reg} busy={updatingId === reg.id} onChange={(s) => updateStatus(reg, s)} />
                </div>
                {reg.allergies && (
                  <p className="rounded-md bg-amber-50 px-2 py-1 text-sm text-amber-950">
                    <span className="font-medium">Allergier/hensyn:</span> {reg.allergies}
                  </p>
                )}
                <p className="flex flex-wrap gap-x-3 text-sm">
                  <a href={`mailto:${reg.parentEmail}`} className="break-all text-bjerke-blue hover:underline">{reg.parentEmail}</a>
                  {reg.parentPhone && (
                    <a href={`tel:${reg.parentPhone}`} className="whitespace-nowrap text-bjerke-blue hover:underline">{formatPhone(reg.parentPhone)}</a>
                  )}
                </p>
                <div className="flex items-center justify-between text-sm">
                  <Payment status={reg.paymentStatus} provider={reg.paymentProvider} />
                  <span className="text-gray-500">{new Date(reg.createdAt).toLocaleDateString('nb-NO')}</span>
                </div>
              </li>
            ))}
          </ul>

          {/* Desktop: tabell */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-600">
                <tr>
                  <th scope="col" className="px-4 py-3 sm:px-6">{personHeading}</th>
                  <th scope="col" className="px-4 py-3">Allergier og hensyn</th>
                  <th scope="col" className="px-4 py-3">{adultCourse ? 'Kontakt' : 'Foresatt'}</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Betaling</th>
                  <th scope="col" className="px-4 py-3">Påmeldt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {registrations.map((reg) => (
                  <tr key={reg.id} className="align-top hover:bg-gray-50">
                    <td className="px-4 py-3 sm:px-6">
                      <p className="font-medium text-gray-900">{reg.name}</p>
                      {reg.age !== null && <p className="text-gray-600">{reg.age} år</p>}
                    </td>
                    <td className="max-w-[16rem] px-4 py-3">
                      {reg.allergies ? <span className="text-amber-900">{reg.allergies}</span> : <span className="text-gray-400">–</span>}
                    </td>
                    <td className="px-4 py-3">
                      {!reg.isAdult && <p className="text-gray-900">{reg.parentName}</p>}
                      <a href={`mailto:${reg.parentEmail}`} className="block text-bjerke-blue hover:underline">{reg.parentEmail}</a>
                      {reg.parentPhone && (
                        <a href={`tel:${reg.parentPhone}`} className="block whitespace-nowrap text-gray-700 hover:underline">
                          {formatPhone(reg.parentPhone)}
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusSelect reg={reg} busy={updatingId === reg.id} onChange={(s) => updateStatus(reg, s)} />
                    </td>
                    <td className="px-4 py-3">
                      <Payment status={reg.paymentStatus} provider={reg.paymentProvider} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">{new Date(reg.createdAt).toLocaleDateString('nb-NO')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
