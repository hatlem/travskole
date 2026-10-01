'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/admin/Toast';
import { Button } from '../Button';

interface FlowOption { id: number; name: string; status: string; isMarketing: boolean; anchorMode: string }

interface AddToFlowProps {
  contactId: number;
  /** Viser advarsel når en markedsføringsflyt velges for en kontakt uten samtykke. */
  hasMarketingConsent?: boolean;
  /** Flyter kontakten allerede er med i — vises ikke i velgeren. */
  excludeFlowIds?: number[];
  onEnrolled?: () => void;
}

async function postEnrollment(flowId: number, body: Record<string, unknown>) {
  const res = await fetch(`/api/admin/crm/flows/${flowId}/enrollments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

/** Meld en kontakt manuelt inn i en aktiv flyt. */
export function AddToFlow({ contactId, hasMarketingConsent = true, excludeFlowIds = [], onEnrolled }: AddToFlowProps) {
  const { toast } = useToast();
  const [flows, setFlows] = useState<FlowOption[] | null>(null);
  const [flowId, setFlowId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/admin/crm/flows', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error())))
      .then((data) => setFlows((data.flows ?? []).filter((f: FlowOption) => f.status === 'active' && f.anchorMode !== 'course')))
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFlows([]);
      });
    return () => controller.abort();
  }, []);

  const excluded = new Set(excludeFlowIds);
  const choices = flows?.filter((f) => !excluded.has(f.id)) ?? null;
  const selected = choices?.find((f) => String(f.id) === flowId) ?? null;

  async function enroll() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const { res, data } = await postEnrollment(selected.id, { contactIds: [contactId] });
      if (!res.ok) {
        toast(data.error || 'Kunne ikke legge kontakten i flyten. Prøv igjen.', 'error');
        return;
      }
      const enrolled = typeof data.enrolled === 'number' ? data.enrolled : 0;
      if (enrolled > 0 && selected.isMarketing && !hasMarketingConsent) {
        toast(`Lagt til i «${selected.name}», men kontakten har ikke samtykket til markedsføring og får ingen e-post fra flyten`, 'info');
      } else if (enrolled > 0) toast(`Lagt til i «${selected.name}» — første e-post går ut etter oppsettet i flyten`, 'success');
      else if (data.skippedSuppressed > 0) toast('Kontakten står på ikke-kontakt-listen og kan ikke få e-post fra flytene', 'error');
      else toast(`Kontakten er allerede med i «${selected.name}»`, 'info');
      setFlowId('');
      if (enrolled > 0) onEnrolled?.();
    } catch {
      toast('Kunne ikke legge kontakten i flyten. Prøv igjen.', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (choices === null) return <p className="text-sm text-gray-400">Laster flyter …</p>;
  if (choices.length === 0) return (
    <p className="text-sm text-gray-500">
      {flows && flows.length > 0
        ? 'Kontakten er allerede med i alle aktive e-postflyter.'
        : 'Ingen e-postflyter er aktive nå, så det er ingen å legge kontakten i.'}{' '}
      <Link href="/admin/crm/flyter" className="text-blue-700 hover:underline">Se e-postflytene</Link>
    </p>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Velg e-postflyt"
          value={flowId}
          onChange={(e) => setFlowId(e.target.value)}
          className="border border-gray-300 rounded-md px-2 py-1.5 text-sm flex-1 min-w-[12rem]"
        >
          <option value="">Velg e-postflyt</option>
          {choices.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <Button variant="secondary" size="sm" onClick={enroll} disabled={!selected} loading={busy} loadingLabel="Legger til …">
          Legg til
        </Button>
      </div>
      {selected?.isMarketing && !hasMarketingConsent && (
        <p className="text-xs text-amber-700">
          Dette er en markedsføringsflyt, og kontakten har ikke sagt ja til markedsføring. Kontakten blir med i flyten, men får ingen av e-postene.
        </p>
      )}
    </div>
  );
}
