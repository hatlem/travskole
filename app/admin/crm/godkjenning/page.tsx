'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { EmptyState } from '@/components/admin/EmptyState';
import { useToast } from '@/components/admin/Toast';
import { FactList, SanitizedHtmlPane } from '@/components/admin/crm/AiEmailCompare';

type View = 'pending' | 'handled';
type Decision = 'approve' | 'send_original' | 'skip';

interface Review {
  id: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  flow: { id: number; name: string };
  contact: { id: number; name: string; email: string | null } | null;
  subject: string;
  originalHtml: string;
  aiHtml: string;
  aiBody: string;
  factLines: string[];
  decidedBy: string | null;
  decidedAt: string | null;
}

const STATUS_NO: Record<string, string> = {
  approved: 'Godkjent (KI-versjon)',
  send_original: 'Original sendt',
  skipped: 'Hoppet over',
  expired: 'Fristen gikk ut — original sendt',
  obsolete: 'Utgått — mottakeren forlot flyten før beslutning',
};

const dateTimeFmt = new Intl.DateTimeFormat('nb-NO', {
  timeZone: 'Europe/Oslo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

export default function GodkjenningPage() {
  const { toast } = useToast();
  const [view, setView] = useState<View>('pending');
  const [reviews, setReviews] = useState<Review[]>([]);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [skipTarget, setSkipTarget] = useState<Review | null>(null);

  const load = useCallback(async (target: View, signal?: AbortSignal) => {
    setLoading(true); setError(null);
    try {
      const qs = target === 'handled' ? '?status=handled' : '';
      const res = await fetch(`/api/admin/crm/ai/reviews${qs}`, { signal });
      if (!res.ok) { setError('Kunne ikke laste godkjenningskøen'); return; }
      const data = await res.json();
      setReviews(data.reviews ?? []);
      setAiConfigured(Boolean(data.aiConfigured));
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError('Kunne ikke laste godkjenningskøen');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const t = setTimeout(() => load(view, controller.signal), 0);
    return () => { clearTimeout(t); controller.abort(); };
  }, [view, load]);

  const decide = async (review: Review, decision: Decision, editedBody?: string) => {
    if (busyId !== null) return;
    setBusyId(review.id);
    try {
      const res = await fetch(`/api/admin/crm/ai/reviews/${review.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, ...(editedBody !== undefined ? { body: editedBody } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error ?? 'Kunne ikke lagre beslutningen', 'error');
        if (res.status === 409) setReviews((prev) => prev.filter((r) => r.id !== review.id));
        return;
      }
      setReviews((prev) => prev.filter((r) => r.id !== review.id));
      const sentNow = data.processed ? ' og sendt' : ' — sendes ved neste kjøring';
      toast(
        decision === 'skip' ? 'Hoppet over — e-posten sendes ikke'
          : decision === 'approve' ? `KI-versjonen er godkjent${sentNow}`
            : `Originalen er valgt${sentNow}`,
        'success',
      );
      window.dispatchEvent(new Event('crm-review-count-changed'));
    } catch {
      toast('Kunne ikke lagre beslutningen', 'error');
    } finally {
      setBusyId(null);
      setSkipTarget(null);
    }
  };

  return (
    <div>
      <CrmTabs />
      <p className="text-sm text-gray-600 mb-4 max-w-3xl">
        E-postnoder i modusen «Godkjenn hver e-post» venter her før de sendes. Sammenlign originalen med KI-versjonen,
        rediger ved behov, og velg hva mottakeren skal få. Ubehandlede utkast sendes som original når fristen går ut.
      </p>

      {!aiConfigured && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 max-w-3xl">
          KI er ikke slått på for dette nettstedet, så ingen nye utkast lages og alle e-poster sendes som skrevet.
          KI aktiveres først når databehandleravtale med KI-leverandøren er på plass.
          {view === 'pending' && reviews.length > 0 && ' Utkast som ble laget før KI ble slått av, kan fortsatt behandles her.'}
        </div>
      )}

      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {([['pending', 'Venter'], ['handled', 'Behandlet']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setView(key)}
            className={`px-4 py-2 text-sm font-medium rounded-t-md border-b-2 -mb-px ${
              view === key ? 'border-blue-600 text-blue-700 bg-blue-50' : 'border-transparent text-gray-600 hover:bg-gray-50'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {error && <p className="text-red-600 mb-4">{error}</p>}
      {loading ? (
        <p className="text-gray-500">Laster …</p>
      ) : reviews.length === 0 ? (
        <EmptyState
          icon="activity"
          title={view === 'pending' ? 'Ingen e-poster venter på godkjenning' : 'Ingen behandlede utkast ennå'}
          description={view === 'pending'
            ? 'Når en flyt med KI-personalisering og godkjenning når en mottaker, dukker utkastet opp her.'
            : undefined}
        />
      ) : (
        <div className="space-y-6">
          {reviews.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              busy={busyId === review.id}
              disabled={busyId !== null}
              onApprove={(edited) => decide(review, 'approve', edited)}
              onSendOriginal={() => decide(review, 'send_original')}
              onSkip={() => setSkipTarget(review)}
            />
          ))}
        </div>
      )}

      <ConfirmModal
        open={skipTarget !== null}
        title="Hoppe over e-posten?"
        message={`${skipTarget?.contact?.name ?? 'Mottakeren'} får ikke denne e-posten, og flyten går videre til neste steg.`}
        confirmLabel="Hopp over"
        variant="warning"
        loading={skipTarget !== null && busyId === skipTarget.id}
        onConfirm={() => { if (skipTarget) void decide(skipTarget, 'skip'); }}
        onCancel={() => setSkipTarget(null)}
      />
    </div>
  );
}

function ReviewCard({ review, busy, disabled, onApprove, onSendOriginal, onSkip }: {
  review: Review;
  busy: boolean;
  disabled: boolean;
  onApprove: (editedBody?: string) => void;
  onSendOriginal: () => void;
  onSkip: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(review.aiBody);
  const pending = review.status === 'pending';
  const edited = editing && draft !== review.aiBody;

  return (
    <article className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">
            {review.contact ? (
              <Link href={`/admin/crm/kontakter/${review.contact.id}`} className="hover:underline">{review.contact.name}</Link>
            ) : 'Slettet kontakt'}
            {review.contact?.email && <span className="ml-2 text-sm font-normal text-gray-500">{review.contact.email}</span>}
          </h2>
          <p className="text-sm text-gray-600">
            <Link href={`/admin/crm/flyter/${review.flow.id}`} className="text-blue-700 hover:underline">{review.flow.name}</Link>
            {' · '}<span className="font-medium">Emne:</span> {review.subject}
          </p>
        </div>
        <p className="text-xs text-gray-500 text-right">
          {pending ? (
            <>Laget {dateTimeFmt.format(new Date(review.createdAt))}<br />
              Sendes som original {dateTimeFmt.format(new Date(review.expiresAt))} hvis ikke behandlet</>
          ) : (
            <>{STATUS_NO[review.status] ?? review.status}<br />
              {review.decidedBy ? `${review.decidedBy}, ` : ''}{dateTimeFmt.format(new Date(review.decidedAt ?? review.updatedAt))}</>
          )}
        </p>
      </header>

      <FactList factLines={review.factLines} />

      <div className="grid gap-3 md:grid-cols-2">
        <SanitizedHtmlPane title="Original" html={review.originalHtml} />
        {editing ? (
          <div className="rounded-md border border-purple-200">
            <div className="px-3 py-1.5 text-xs font-medium border-b border-purple-200 bg-purple-50 text-purple-800">
              KI-versjon (redigerer HTML)
            </div>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={12} disabled={disabled}
              className="w-full px-3 py-2 text-sm font-mono rounded-b-md focus:outline-none" />
          </div>
        ) : (
          <SanitizedHtmlPane title={pending ? 'KI-versjon' : 'KI-versjon (slik den ble godkjent)'} html={review.aiHtml} tone="ai" />
        )}
      </div>

      {pending && (
        <footer className="flex flex-wrap items-center gap-2 pt-1">
          <button onClick={() => onApprove(edited ? draft : undefined)} disabled={disabled || draft.trim() === ''}
            className="bg-green-600 text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50">
            {busy ? 'Sender …' : edited ? 'Godkjenn redigert tekst og send' : 'Godkjenn og send'}
          </button>
          <button onClick={onSendOriginal} disabled={disabled}
            className="border border-gray-300 px-3 py-1.5 rounded-md text-sm hover:bg-gray-50 disabled:opacity-50">
            Send original
          </button>
          <button onClick={onSkip} disabled={disabled}
            className="border border-gray-300 px-3 py-1.5 rounded-md text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">
            Hopp over
          </button>
          <button onClick={() => { setEditing((v) => !v); setDraft(review.aiBody); }} disabled={disabled}
            className="ml-auto text-sm text-purple-700 hover:underline disabled:opacity-50">
            {editing ? 'Avbryt redigering' : 'Rediger KI-tekst'}
          </button>
        </footer>
      )}
    </article>
  );
}
