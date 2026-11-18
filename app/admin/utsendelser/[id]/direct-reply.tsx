'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/admin/Button';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import type { DirectReplyMatch, DirectReplyState } from '@/lib/utsendelser/direct-reply';
import { useUtsendelseAction } from './use-action';

const MIN_QUERY_LENGTH = 2;

const STATE_TEXT: Record<Exclude<DirectReplyState, 'pagar'>, string> = {
  svarte: 'Har svart. Får ikke flere e-poster.',
  ferdig: 'Har fått alle e-postene.',
  stoppet: 'Får ikke flere e-poster.',
};

/** Svar som går rett til avsenderen, ser ikke systemet. Her stopper man resten av e-postene for hånd. */
export function DirectReply({ utsendelseId }: { utsendelseId: string }) {
  const inputId = useId();
  const { run, busy } = useUtsendelseAction(utsendelseId);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<DirectReplyMatch[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirm, setConfirm] = useState<DirectReplyMatch | null>(null);
  const term = query.trim();
  const searching = term.length >= MIN_QUERY_LENGTH;
  const shown = searching ? matches : null;

  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setFailed(false);
      try {
        const res = await fetch(`/api/admin/utsendelser/${utsendelseId}/svar-direkte?sok=${encodeURIComponent(term)}`, { signal: controller.signal });
        if (!res.ok) throw new Error(String(res.status));
        const data: { matches: DirectReplyMatch[] } = await res.json();
        setMatches(data.matches);
        setFailed(false);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [term, searching, utsendelseId]);

  async function stop(match: DirectReplyMatch) {
    const data = await run('POST', '/svar-direkte', { contactId: match.contactId }, `E-postene til ${match.name} er stoppet.`);
    if (!data) return;
    setConfirm(null);
    setMatches((ms) => ms?.map((m) => (m.contactId === match.contactId ? { ...m, state: 'svarte' } : m)) ?? null);
  }

  return (
    <div id="svart-direkte" className="mt-6 scroll-mt-6 rounded-xl border border-gray-200 bg-white px-5 py-4">
      <label htmlFor={inputId} className="block font-medium text-gray-900">Har noen svart deg direkte?</label>
      <p className="mt-1 text-sm text-gray-600">
        Svar som kommer rett til deg, ser ikke systemet. Søk opp personen og stopp resten av e-postene, så får de ikke flere.
      </p>
      <input
        id={inputId}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Navn, e-post eller bedrift"
        autoComplete="off"
        className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-bjerke-blue focus:ring-2 focus:ring-bjerke-blue/20 sm:max-w-sm"
      />

      <div aria-live="polite" className="mt-3 text-sm">
        {searching && failed ? (
          <p className="text-red-700">Fikk ikke søkt. Prøv igjen.</p>
        ) : shown === null ? null : shown.length === 0 && !loading ? (
          <p className="text-gray-600">Fant ingen som har fått e-post fra utsendelsen med «{term}».</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {shown.map((m) => (
              <li key={m.contactId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">
                    {m.name}
                    {m.org ? <span className="font-normal text-gray-600"> · {m.org}</span> : null}
                  </p>
                  <p className="text-gray-600">
                    {m.email ? `${m.email} · ` : ''}
                    Har fått {m.received} av {m.total} e-poster
                    {m.state === 'pagar' ? '' : `. ${STATE_TEXT[m.state]}`}
                  </p>
                </div>
                {m.state === 'pagar' ? (
                  <Button variant="secondary" disabled={busy} onClick={() => setConfirm(m)}>Stopp e-postene</Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmModal
        open={confirm !== null}
        title={confirm ? `Stoppe e-postene til ${confirm.name}?` : ''}
        message={confirm ? `${confirm.name} får ingen flere e-poster fra utsendelsen, og vises under «Svar». E-poster som alt er sendt, kan ikke hentes tilbake.` : ''}
        confirmLabel="Stopp e-postene"
        variant="warning"
        loading={busy}
        onConfirm={() => confirm && void stop(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
