'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { PageHeader } from '@/components/admin/PageHeader';
import { Badge } from '@/components/admin/StatusBadge';
import { Button } from '@/components/admin/Button';
import type { FlowView, ReplyView, UtsendelseView } from '@/lib/utsendelser/overview';
import { STATUS_BADGE } from '../status';
import { EmailStepCard } from './email-step-card';
import { GroupsSection, type SerializedGroup, type SourceOption } from './groups-section';
import { SettingsCard, type SenderOption } from './settings-card';
import { ProviderPauseNote } from './provider-pause-note';
import { useUtsendelseAction } from './use-action';
import type { TestRecipient } from '@/lib/utsendelser/staff';

type SerializedReply = Omit<ReplyView, 'repliedAt'> & { repliedAt: string };
export type SerializedView = Omit<UtsendelseView, 'groups' | 'replies'> & { groups: SerializedGroup[]; replies: SerializedReply[] };

export interface DetailOptions {
  senders: SenderOption[];
  lists: SourceOption[];
  segments: SourceOption[];
}

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('nb-NO', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' });

export function UtsendelseDetail({ view, myEmail, testOthers, options }: { view: SerializedView; myEmail: string; testOthers: TestRecipient[]; options: DetailOptions }) {
  const { run, busy } = useUtsendelseAction(view.id);
  const badge = STATUS_BADGE[view.status];
  const isPaused = view.status === 'pause';
  const canPause = view.flows.some((f) => f.status === 'active');
  const firstFlow = view.flows[0];

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={view.navn}
        description={view.beskrivelse}
        actions={
          <div className="flex items-center gap-3">
            <Badge className={badge.className}>{badge.label}</Badge>
            {(canPause || isPaused) && (
              <Button
                variant="secondary"
                loading={busy}
                onClick={() =>
                  run('POST', '/pause', { paused: !isPaused }, isPaused ? 'Utsendelsen fortsetter.' : 'Utsendelsen står på pause. Ingen e-poster går ut.')
                }
              >
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

      {view.pace.providerPausedUntil && !isPaused && <ProviderPauseNote until={view.pace.providerPausedUntil} />}

      {firstFlow && (
        <SettingsCard
          utsendelseId={view.id}
          navn={view.navn}
          beskrivelse={view.beskrivelse}
          senderIdentityId={firstFlow.senderIdentityId}
          senderName={firstFlow.senderName}
          sendWindow={firstFlow.sendWindow}
          sendWindowDraft={firstFlow.sendWindowDraft}
          senderMixed={view.senderMixed}
          windowMixed={view.windowMixed}
          senders={options.senders}
          sent={view.totals.sent}
          total={view.totals.total}
          remaining={view.totals.remaining}
          perHour={view.pace.perHour}
        />
      )}

      <GroupsSection
        utsendelseId={view.id}
        groups={view.groups}
        flows={view.flows.map((f) => ({ flowId: f.flowId, navn: f.navn }))}
        lists={options.lists}
        segments={options.segments}
        paused={isPaused}
      />

      <section aria-labelledby="emails-title" className="mb-12">
        <h2 id="emails-title" className="text-lg font-semibold text-gray-900">E-postene</h2>
        <p className="mt-1 mb-4 text-sm text-gray-600">Slik ser e-postene ut for mottakeren. Du kan endre teksten og ventetiden når som helst.</p>
        <div className="space-y-6">
          {view.flows.map((flow, i) =>
            view.flows.length > 1 ? (
              <details key={flow.flowId} open={i === 0} className="group rounded-xl border border-gray-200 bg-gray-50/60 px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold text-gray-900">
                  <span>
                    {flow.navn}
                    <span className="ml-2 text-sm font-normal text-gray-500">
                      {flow.steps.length} {flow.steps.length === 1 ? 'e-post' : 'e-poster'}
                    </span>
                  </span>
                  <span className="text-sm font-normal text-blue-700 group-open:hidden">Vis</span>
                  <span className="hidden text-sm font-normal text-blue-700 group-open:inline">Skjul</span>
                </summary>
                <div className="mt-4">
                  <FlowEmails flow={flow} utsendelseId={view.id} myEmail={myEmail} testOthers={testOthers} />
                </div>
              </details>
            ) : (
              <FlowEmails key={flow.flowId} flow={flow} utsendelseId={view.id} myEmail={myEmail} testOthers={testOthers} />
            ),
          )}
        </div>
      </section>

      <Replies replies={view.replies} />

      <ArchiveSection utsendelseId={view.id} activeEnrollments={view.activeEnrollments} />
    </div>
  );
}

function FlowEmails({ flow, utsendelseId, myEmail, testOthers }: { flow: FlowView; utsendelseId: string; myEmail: string; testOthers: TestRecipient[] }) {
  const { run, busy } = useUtsendelseAction(utsendelseId);
  const [adding, setAdding] = useState(false);
  const [days, setDays] = useState(7);
  const daysValid = Number.isInteger(days) && days >= 1 && days <= 60;

  return (
    <div>
      {flow.sampleLabel && <p className="mb-3 text-sm text-gray-600">Vist slik {flow.sampleLabel} får dem.</p>}
      <ol className="space-y-4">
        {flow.steps.map((step) => (
          <li key={step.nodeId}>
            <EmailStepCard
              utsendelseId={utsendelseId}
              flowId={flow.flowId}
              step={step}
              sampleContactId={flow.sampleContactId}
              myEmail={myEmail}
              testOthers={testOthers}
              canRemove={flow.canChangeSteps && flow.steps.length > 1}
            />
          </li>
        ))}
      </ol>
      {flow.canChangeSteps ? (
        adding ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-700">
            <label htmlFor={`add-${flow.flowId}`}>Ny e-post sendes</label>
            <input
              id={`add-${flow.flowId}`}
              type="number"
              min={1}
              max={60}
              value={Number.isFinite(days) ? days : ''}
              onChange={(e) => setDays(Number(e.target.value))}
              className="w-16 rounded-md border border-gray-300 px-2 py-1 text-sm tabular-nums"
            />
            <span>dager etter e-post {flow.steps.length}</span>
            <Button
              size="sm"
              loading={busy}
              disabled={!daysValid}
              onClick={async () => {
                if (await run('POST', '/epost', { flowId: flow.flowId, days }, 'E-posten er lagt til. Skriv teksten i den nye e-posten.')) setAdding(false);
              }}
            >
              Legg til
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setAdding(false)}>Avbryt</Button>
          </div>
        ) : (
          <Button className="mt-4" variant="secondary" onClick={() => setAdding(true)}>+ Legg til en e-post</Button>
        )
      ) : (
        <p className="mt-3 text-xs text-gray-500">E-poster kan bare legges til eller fjernes før du har sendt. Tekst og ventetid kan du endre når som helst.</p>
      )}
    </div>
  );
}

function Replies({ replies }: { replies: SerializedReply[] }) {
  return (
    <section aria-labelledby="replies-title">
      <h2 id="replies-title" className="text-lg font-semibold text-gray-900">Svar</h2>
      <p className="mt-1 mb-4 text-sm text-gray-600">Svarene kommer til registrering@bjerke.no. Her ser du hvem som har svart.</p>
      {replies.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-600">Ingen har svart ennå.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {replies.map((r) => (
            <li key={`${r.contactId}-${r.repliedAt}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-gray-900">
                  {r.name}
                  {r.organization ? <span className="font-normal text-gray-600"> · {r.organization}</span> : null}
                </p>
                <p className="text-gray-600">
                  {r.email}
                  {r.stepNumber ? ` · svarte på e-post ${r.stepNumber}` : ''} · {dateTime(r.repliedAt)}
                </p>
              </div>
              <Link href={`/admin/crm/kontakter/${r.contactId}`} className="shrink-0 font-medium text-bjerke-blue hover:underline">
                Åpne kontakten →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ArchiveSection({ utsendelseId, activeEnrollments }: { utsendelseId: string; activeEnrollments: number }) {
  const router = useRouter();
  const { run, busy } = useUtsendelseAction(utsendelseId);
  const [confirm, setConfirm] = useState(false);

  return (
    <section aria-labelledby="archive-title" className="mt-12 border-t border-gray-200 pt-6">
      <h2 id="archive-title" className="text-sm font-semibold text-gray-900">Ferdig med utsendelsen?</h2>
      {activeEnrollments > 0 ? (
        <p className="mt-1 text-sm text-gray-600">
          Du kan arkivere den når alle har fått e-postene sine. Nå venter {activeEnrollments.toLocaleString('nb-NO')} på flere.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-gray-600">Arkiver den, så forsvinner den fra lista. Kontaktene og svarene blir liggende i CRM.</p>
          <Button className="mt-3" variant="secondary" size="sm" onClick={() => setConfirm(true)}>Arkiver utsendelsen</Button>
        </>
      )}
      <ConfirmModal
        open={confirm}
        title="Arkivere utsendelsen?"
        message="Den forsvinner fra lista over utsendelser og kan ikke sendes mer. Kontaktene og svarene blir liggende i CRM."
        confirmLabel="Arkiver"
        loading={busy}
        onConfirm={async () => {
          if (await run('DELETE', '', {}, 'Utsendelsen er arkivert.', { refresh: false })) router.replace('/admin/utsendelser');
        }}
        onCancel={() => setConfirm(false)}
      />
    </section>
  );
}
