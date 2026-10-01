'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/admin/Toast';
import { Button } from '@/components/admin/Button';
import type { BackfillCursor } from '@/lib/crm/backfill';

interface Missing { bookings: number; registrations: number }
interface BackfillResponse {
  done: boolean;
  cursor: BackfillCursor | null;
  processed: { bookings: number; registrations: number; failed: number };
  contacts: number;
  organizations: number;
  deals: number;
  error?: string;
}
interface Summary {
  bookings: number;
  registrations: number;
  failed: number;
  contacts: number;
  organizations: number;
  deals: number;
}

// Hindrer evig løkke hvis serveren skulle returnere done:false uten fremdrift.
const MAX_ROUNDS = 500;

/** Superadmin-kort: kjører CRM-broen over historiske bookinger og påmeldinger. */
export function HistoryBackfillCard() {
  const { toast } = useToast();
  const [missing, setMissing] = useState<Missing | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const cancelledRef = useRef(false);

  const loadMissing = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/crm/backfill');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Kunne ikke sjekke hva som mangler. Last siden på nytt.');
      setMissing(data.missing);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Kunne ikke sjekke hva som mangler. Last siden på nytt.', 'error');
    }
  }, [toast]);

  useEffect(() => {
    const t = setTimeout(loadMissing, 0);
    return () => {
      clearTimeout(t);
      cancelledRef.current = true;
    };
  }, [loadMissing]);

  async function run() {
    if (running) return;
    cancelledRef.current = false;
    setRunning(true);
    setSummary(null);
    setProgress(0);
    setTotal(missing ? missing.bookings + missing.registrations : 0);

    const acc: Summary = { bookings: 0, registrations: 0, failed: 0, contacts: 0, organizations: 0, deals: 0 };
    let cursor: BackfillCursor | null = null;
    try {
      for (let round = 0; round < MAX_ROUNDS && !cancelledRef.current; round++) {
        const res = await fetch('/api/admin/crm/backfill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cursor }),
        });
        const data: BackfillResponse = await res.json();
        if (!res.ok) throw new Error(data.error || 'Innhentingen stoppet. Det som er gjort, er lagret — trykk på knappen igjen for å fortsette.');

        acc.bookings += data.processed.bookings;
        acc.registrations += data.processed.registrations;
        acc.failed += data.processed.failed;
        acc.contacts = data.contacts;
        acc.organizations = data.organizations;
        acc.deals = data.deals;
        setProgress(acc.bookings + acc.registrations);

        if (data.done || !data.cursor) {
          setSummary({ ...acc });
          toast(
            acc.failed
              ? `${acc.failed} kunne ikke hentes inn. Resten er klart: ${acc.bookings} forespørsler og ${acc.registrations} påmeldinger. Prøv igjen senere, eller se Aktivitetsloggen.`
              : `Ferdig: ${acc.bookings} forespørsler og ${acc.registrations} påmeldinger er hentet inn`,
            acc.failed ? 'error' : 'success',
          );
          break;
        }
        cursor = data.cursor;
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Innhentingen stoppet. Det som er gjort, er lagret — trykk på knappen igjen for å fortsette.', 'error');
      if (acc.bookings + acc.registrations > 0) setSummary({ ...acc });
    } finally {
      setRunning(false);
      if (!cancelledRef.current) loadMissing();
    }
  }

  const remaining = missing ? missing.bookings + missing.registrations : null;
  const pct = total > 0 ? Math.min(100, Math.round((progress / total) * 100)) : 0;

  return (
    <section className="border border-gray-200 rounded-lg p-4 bg-white">
      <h2 className="font-semibold mb-1">Hent inn tidligere forespørsler og påmeldinger</h2>
      <p className="text-sm text-gray-500 mb-3">
        Lager kontakter, bedrifter og avtaler av gamle forespørsler og påmeldinger som ikke er hentet inn ennå.
        Trygt å kjøre flere ganger — eksisterende avtaler og endringer du har gjort, røres ikke.
      </p>

      <p className="text-sm mb-3" aria-live="polite">
        {missing === null
          ? 'Sjekker status …'
          : remaining === 0
            ? 'Alle forespørsler og påmeldinger er allerede hentet inn.'
            : `${missing.bookings} forespørsler og ${missing.registrations} påmeldinger er ikke hentet inn ennå.`}
      </p>

      {running && (
        <div className="mb-3">
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-gray-500 mt-1 tabular-nums">
            Behandlet {progress}{total > 0 && ` av ${total}`} …
          </p>
        </div>
      )}

      <Button variant="secondary" onClick={run} disabled={!remaining} loading={running} loadingLabel="Henter inn …">
        Hent inn historikk
      </Button>

      {summary && (
        <div className="mt-4 border border-green-200 bg-green-50 rounded-lg p-3 text-sm">
          <p>
            Behandlet {summary.bookings} forespørsler og {summary.registrations} påmeldinger
            {summary.failed > 0 && <span className="text-red-700"> ({summary.failed} kunne ikke hentes inn — se Aktivitetsloggen)</span>}.
          </p>
          <p className="text-gray-600 mt-1">
            Dere har nå {summary.contacts} kontakter, {summary.organizations} bedrifter og {summary.deals} avtaler.
          </p>
        </div>
      )}
    </section>
  );
}
