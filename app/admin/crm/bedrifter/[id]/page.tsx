'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { useToast } from '@/components/admin/Toast';
import { EmptyState } from '@/components/admin/EmptyState';
import { CardSkeleton } from '@/components/admin/Skeleton';

interface OrgDetail {
  id: number;
  name: string;
  domain: string | null;
  orgNumber: string | null;
  phone: string | null;
  address: string | null;
  stage: string;
  tags: string[];
  contacts: {
    id: number;
    name: string;
    email: string | null;
    phone: string | null;
    roleTitle: string | null;
  }[];
  deals: {
    id: number;
    title: string;
    value: number | null;
    eventType: string | null;
    eventDate: string | null;
    status: string;
    stage: { name: string };
  }[];
  activities: {
    id: number;
    type: string;
    title: string;
    body: string | null;
    occurredAt: string;
  }[];
}

const STAGES = [
  { value: 'lead', label: 'Interessent' },
  { value: 'active', label: 'Aktiv' },
  { value: 'customer', label: 'Kunde' },
  { value: 'dormant', label: 'Sovende' },
  { value: 'lost', label: 'Tapt' },
];

function fmtDate(d: string | null): string {
  return d ? new Date(d).toLocaleDateString('nb-NO') : '—';
}

export default function BedriftDetaljPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [noteText, setNoteText] = useState('');
  const { toast } = useToast();
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const res = await fetch(`/api/admin/crm/organizations/${id}`, { signal: controller.signal });
      if (!res.ok) throw new Error('Kunne ikke laste bedriftdetaljer');
      const data = await res.json();
      setOrg(data.organization);
      setLoadError(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setLoadError(true);
      setOrg(null);
      toast(err instanceof Error ? err.message : 'Kunne ikke laste bedriftdetaljer', 'error');
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
        setInitialLoading(false);
      }
    }
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function setStage(stage: string) {
    try {
      const res = await fetch(`/api/admin/crm/organizations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast(data.error || 'Noe gikk galt', 'error');
        return;
      }
      toast('Stadium oppdatert', 'success');
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
    }
  }

  async function addNote() {
    if (!noteText.trim()) return;
    try {
      const res = await fetch('/api/admin/crm/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: noteText, organizationId: Number(id) }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast(data.error || 'Noe gikk galt', 'error');
        return;
      }
      setNoteText('');
      toast('Notat lagret', 'success');
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
    }
  }

  if (initialLoading) {
    return (
      <div>
        <CrmTabs />
        <div className="p-8">
          <div className="space-y-6">
            <CardSkeleton />
            <div className="grid md:grid-cols-2 gap-6">
              <CardSkeleton />
              <CardSkeleton />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div>
        <CrmTabs />
        <EmptyState
          title="Kunne ikke laste bedriftdetaljer"
          description="Noe gikk galt under henting av bedriftdetaljer. Prøv igjen."
          action={{ label: 'Prøv igjen', onClick: () => load() }}
        />
      </div>
    );
  }

  if (!org) {
    return (
      <div>
        <CrmTabs />
        <div className="text-gray-500 p-8">Bedriften finnes ikke.</div>
      </div>
    );
  }

  const totalValue = org.deals
    .filter((d) => d.status !== 'lost' && d.value !== null)
    .reduce((sum, d) => sum + (d.value ?? 0), 0);

  return (
    <div>
      <CrmTabs />

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">{org.name}</h1>
          <p className="text-gray-600 text-sm mt-1">
            {org.domain ?? 'Ikke noe domene'} · {org.phone ?? 'Ingen telefon'}
            {org.orgNumber && <> · Org.nr {org.orgNumber}</>}
          </p>
          <p className="text-gray-700 text-sm mt-2 font-medium">
            Samlet verdi (åpne + vunnede deals): {totalValue.toLocaleString('nb-NO')} kr
          </p>
        </div>
        <label className="text-sm text-gray-600">
          Stadium:{' '}
          <select
            value={org.stage}
            onChange={(e) => setStage(e.target.value)}
            className="border border-gray-300 rounded-md px-2 py-1 text-sm"
          >
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-6">
          <section>
            <h2 className="font-semibold mb-3">Kontaktpersoner ({org.contacts.length})</h2>
            {org.contacts.length === 0 ? (
              <p className="text-sm text-gray-500">Ingen kontaktpersoner.</p>
            ) : (
              <ul className="space-y-2">
                {org.contacts.map((c) => (
                  <li key={c.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                    <Link
                      href={`/admin/crm/kontakter/${c.id}`}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {c.name}
                    </Link>
                    {c.roleTitle && <span className="text-gray-500 ml-2">{c.roleTitle}</span>}
                    <p className="text-gray-600 mt-0.5">
                      {c.email ?? '—'} · {c.phone ?? '—'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="font-semibold mb-3">Bookinghistorikk ({org.deals.length})</h2>
            {org.deals.length === 0 ? (
              <p className="text-sm text-gray-500">Ingen deals ennå.</p>
            ) : (
              <ul className="space-y-2">
                {org.deals.map((d) => (
                  <li key={d.id} className="border border-gray-200 rounded-lg p-3 text-sm flex items-center justify-between">
                    <div>
                      <span className="font-medium">{d.title}</span>
                      <span className="text-gray-500 ml-2">{d.stage.name}</span>
                      {d.eventType && (
                        <span className="bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded ml-2">
                          {d.eventType}
                        </span>
                      )}
                      {d.eventDate && <span className="text-gray-500 ml-2">{fmtDate(d.eventDate)}</span>}
                    </div>
                    <span className="text-gray-700">
                      {d.value !== null ? `${d.value.toLocaleString('nb-NO')} kr` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section>
            <h2 className="font-semibold mb-3">Notat</h2>
            <div className="flex gap-2">
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Skriv et notat …"
                rows={2}
                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm flex-1"
              />
              <button
                onClick={addNote}
                disabled={!noteText.trim()}
                className="bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm self-end disabled:opacity-50"
              >
                Lagre
              </button>
            </div>
          </section>

          <section>
            <h2 className="font-semibold mb-3">Tidslinje</h2>
            {org.activities.length === 0 ? (
              <p className="text-sm text-gray-500">Ingen aktivitet ennå.</p>
            ) : (
              <ol className="space-y-3">
                {org.activities.map((a) => (
                  <li key={a.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{a.title}</span>
                      <span className="text-gray-500 text-xs">{fmtDate(a.occurredAt)}</span>
                    </div>
                    {a.body && <p className="text-gray-600 mt-1 whitespace-pre-wrap">{a.body}</p>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
