'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Badge } from '@/components/admin/StatusBadge';
import { Button } from '@/components/admin/Button';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { useToast } from '@/components/admin/Toast';
import type { FlowView, GroupView, UtsendelseView } from '@/lib/utsendelser/overview';
import { STATUS_BADGE, formatCount } from '../status';
import { EmailStepCard } from './email-step-card';

type SerializedGroup = Omit<GroupView, 'firstSentAt' | 'lastSentAt'> & { firstSentAt: string | null; lastSentAt: string | null };
type SerializedView = Omit<UtsendelseView, 'groups'> & { groups: SerializedGroup[] };

interface SendResult {
  sent: number;
  alreadySent: number;
  skippedSuppressed: number;
  skippedNoConsent: number;
  skippedMissing: number;
}

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('nb-NO', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' });

function resultMessage(r: SendResult): string {
  const skipped = r.skippedSuppressed + r.skippedNoConsent + r.skippedMissing;
  const base = r.sent === 0 ? 'Ingen nye å sende til.' : `Sendt til ${formatCount(r.sent)}. E-post 1 går ut i løpet av kort tid.`;
  return skipped > 0 ? `${base} ${formatCount(skipped)} hoppet over (meldt av eller mangler adresse).` : base;
}

export function UtsendelseDetail({ view, myEmail }: { view: SerializedView; myEmail: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [confirmGroup, setConfirmGroup] = useState<SerializedGroup | null>(null);
  const [sending, setSending] = useState(false);
  const [pausing, setPausing] = useState(false);

  const badge = STATUS_BADGE[view.status];
  const isPaused = view.status === 'pause';
  const canPause = view.flows.some((f) => f.status === 'active');
  const firstFlow = view.flows[0];

  async function send(group: SerializedGroup) {
    setSending(true);
    try {
      const res = await fetch(`/api/admin/utsendelser/${view.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gruppeId: group.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error ?? 'Kunne ikke sende. Prøv igjen.', 'error');
        return;
      }
      toast(resultMessage(data as SendResult), 'success');
      setConfirmGroup(null);
      router.refresh();
    } finally {
      setSending(false);
    }
  }

  async function togglePause() {
    setPausing(true);
    try {
      const res = await fetch(`/api/admin/utsendelser/${view.id}/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: !isPaused }),
      });
      if (!res.ok) {
        toast('Kunne ikke endre. Prøv igjen.', 'error');
        return;
      }
      toast(isPaused ? 'Utsendelsen fortsetter.' : 'Utsendelsen står på pause. Ingen e-poster går ut.', 'success');
      router.refresh();
    } finally {
      setPausing(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={view.navn}
        description={view.beskrivelse}
        actions={
          <div className="flex items-center gap-3">
            <Badge className={badge.className}>{badge.label}</Badge>
            {(canPause || isPaused) && (
              <Button variant="secondary" loading={pausing} onClick={togglePause}>
                {isPaused ? 'Fortsett' : 'Sett på pause'}
              </Button>
            )}
          </div>
        }
      />

      {isPaused && (
        <p role="status" className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
          Utsendelsen står på pause. Ingen e-poster går ut før du trykker «Fortsett».
        </p>
      )}

      <dl className="mb-10 grid gap-3 rounded-xl border border-gray-200 bg-white px-5 py-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-gray-600">Sendt til</dt>
          <dd className="mt-0.5 text-lg font-semibold text-gray-900">
            {formatCount(view.totals.sent)} <span className="text-sm font-normal text-gray-600">av {formatCount(view.totals.sent + view.totals.remaining)}</span>
          </dd>
        </div>
        {firstFlow?.senderName && (
          <div>
            <dt className="text-gray-600">Avsender</dt>
            <dd className="mt-0.5 text-gray-900">{firstFlow.senderName}</dd>
          </div>
        )}
        {firstFlow?.sendWindow && (
          <div>
            <dt className="text-gray-600">E-postene går ut</dt>
            <dd className="mt-0.5 text-gray-900">{firstFlow.sendWindow}</dd>
          </div>
        )}
      </dl>

      <section aria-labelledby="send-title" className="mb-12">
        <h2 id="send-title" className="text-lg font-semibold text-gray-900">Send</h2>
        <p className="mt-1 mb-4 text-sm text-gray-600">
          Velg hvem som skal få e-post 1 nå. Resten av e-postene kommer automatisk. Ingen får samme e-post to ganger.
        </p>
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {view.groups.map((g) => (
            <GroupRow key={g.id} group={g} showFlowName={view.flows.length > 1} disabled={isPaused} onSend={() => setConfirmGroup(g)} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="emails-title">
        <h2 id="emails-title" className="text-lg font-semibold text-gray-900">E-postene</h2>
        <p className="mt-1 mb-4 text-sm text-gray-600">Slik ser e-postene ut for mottakeren. Trykk «Endre» for å endre teksten.</p>
        <div className="space-y-10">
          {view.flows.map((flow) => (
            <FlowEmails key={flow.flowId} flow={flow} utsendelseId={view.id} myEmail={myEmail} showHeading={view.flows.length > 1} />
          ))}
        </div>
      </section>

      <ConfirmModal
        open={confirmGroup !== null}
        variant="info"
        title={confirmGroup ? `Sende til «${confirmGroup.navn}»?` : ''}
        message={
          confirmGroup && (
            <>
              <strong>{formatCount(confirmGroup.remaining)}</strong> {confirmGroup.remaining === 1 ? 'person får' : 'personer får'} e-post 1 nå.
              {firstFlow?.sendWindow ? ` E-postene går ut ${firstFlow.sendWindow.toLowerCase()}.` : ''} Resten av e-postene kommer automatisk etterpå.
              Du kan sette utsendelsen på pause når som helst.
            </>
          )
        }
        confirmLabel="Send nå"
        loading={sending}
        onConfirm={() => confirmGroup && send(confirmGroup)}
        onCancel={() => setConfirmGroup(null)}
      />
    </div>
  );
}

function GroupRow({
  group,
  showFlowName,
  disabled,
  onSend,
}: {
  group: SerializedGroup;
  showFlowName: boolean;
  disabled: boolean;
  onSend: () => void;
}) {
  const people = group.sent + group.remaining;
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium text-gray-900">{group.navn}</p>
        <p className="mt-0.5 text-sm text-gray-600">
          {formatCount(people)} {people === 1 ? 'person' : 'personer'}
          {showFlowName && group.flowNavn ? ` · ${group.flowNavn.toLowerCase()}` : ''}
          {group.beskrivelse ? ` · ${group.beskrivelse}` : ''}
        </p>
        {group.unreachable > 0 && (
          <p className="mt-0.5 text-xs text-gray-500">
            {formatCount(group.unreachable)} til kan ikke få e-post (har meldt seg av eller mangler adresse).
          </p>
        )}
        {group.missingSegment && <p className="mt-0.5 text-sm text-red-700">Gruppen finnes ikke lenger.</p>}
      </div>
      <div className="shrink-0 sm:text-right">
        {group.sent > 0 && group.lastSentAt && (
          <p className="text-sm text-green-800">
            <span aria-hidden="true">✓ </span>Sendt til {formatCount(group.sent)} · {dateTime(group.lastSentAt)}
          </p>
        )}
        {group.remaining > 0 ? (
          <Button className="mt-1" variant={group.sent > 0 ? 'secondary' : 'primary'} disabled={disabled} onClick={onSend}>
            {group.sent > 0 ? `Send til ${formatCount(group.remaining)} nye` : 'Send nå'}
          </Button>
        ) : (
          group.sent === 0 && !group.missingSegment && <p className="text-sm text-gray-500">Ingen å sende til</p>
        )}
      </div>
    </li>
  );
}

function FlowEmails({ flow, utsendelseId, myEmail, showHeading }: { flow: FlowView; utsendelseId: string; myEmail: string; showHeading: boolean }) {
  return (
    <div>
      {showHeading && <h3 className="mb-1 font-semibold text-gray-900">{flow.navn}</h3>}
      {flow.sampleName && <p className="mb-3 text-sm text-gray-600">Eksempel: slik får {flow.sampleName} dem.</p>}
      <ol className="space-y-4">
        {flow.steps.map((step) => (
          <li key={step.nodeId}>
            <EmailStepCard
              utsendelseId={utsendelseId}
              flowId={flow.flowId}
              step={step}
              sampleContactId={flow.sampleContactId}
              myEmail={myEmail}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}
