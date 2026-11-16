'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/admin/Button';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { paceSentence } from '@/lib/utsendelser/pace';
import { ProviderPauseNote } from '../provider-pause-note';
import { EmailBodyEditor } from '@/app/admin/crm/flyter/[id]/email-body-editor';
import type { RecipientRow } from '@/lib/utsendelser/one-by-one';
import { formatCount } from '../../status';
import { useUtsendelseAction } from '../use-action';
import { OneByOne } from './one-by-one';
import { TestSendButton } from '../test-send-button';
import type { TestRecipient } from '@/lib/utsendelser/staff';

export interface SendStep {
  nodeId: number;
  number: number;
  timing: string;
  subject: string;
  bodyHtml: string;
}

export interface SendFlow {
  flowId: number;
  status: string;
  senderName: string | null;
  sendWindow: string;
  sampleContactId: number | null;
  steps: SendStep[];
  /** E-poster kan legges til så lenge ingen har fått noen ennå. */
  canChangeSteps: boolean;
}

export interface SendGroup {
  id: string;
  navn: string;
  remaining: number;
  sent: number;
}

interface Props {
  utsendelseId: string;
  utsendelseNavn: string;
  group: SendGroup;
  otherGroups: { id: string; navn: string }[];
  flow: SendFlow;
  paused: boolean;
  /** Fart i timen (0 = ingen grense) og om leverandøren har bedt oss vente. */
  pace: { perHour: number; providerPausedUntil: string | null; queued: number };
  rows: RecipientRow[];
  myEmail: string;
  testOthers: TestRecipient[];
  initialMode: 'alle' | 'en';
}


interface SendResult {
  sent: number;
  skippedSuppressed: number;
  skippedNoConsent: number;
  skippedMissing: number;
}

export function sendResultMessage(r: SendResult): string {
  const skipped = r.skippedSuppressed + r.skippedNoConsent + r.skippedMissing;
  const base = r.sent === 0 ? 'Ingen nye å sende til.' : `Sendt til ${formatCount(r.sent)}. E-post 1 går ut innenfor sendetiden.`;
  return skipped > 0 ? `${base} ${formatCount(skipped)} hoppet over (meldt av eller mangler adresse).` : base;
}

export const people = (n: number) => `${formatCount(n)} ${n === 1 ? 'person' : 'personer'}`;

export function SendView(props: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [mode, setMode] = useState(props.initialMode);
  const [dirty, setDirty] = useState(false);

  // Ulagret tekst: spør før fanen lukkes, og før enhver lenke (meny, brødsmuler, tilbake) tar henne bort.
  useEffect(() => {
    if (!dirty) return;
    let leaving = false;
    const warnUnload = (e: BeforeUnloadEvent) => {
      if (!leaving) e.preventDefault();
    };
    const warnLink = (e: MouseEvent) => {
      // Ny fane, nedlasting o.l. tar henne ikke bort fra siden.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.('a[href]');
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download')) return;
      if (link.target && link.target !== '_self') return;
      if (link.origin === window.location.origin && link.pathname === window.location.pathname) return;
      if (window.confirm('Du har endringer som ikke er lagret. Vil du gå uten å lagre dem?')) {
        leaving = true;
      } else {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', warnUnload);
    document.addEventListener('click', warnLink, true);
    return () => {
      window.removeEventListener('beforeunload', warnUnload);
      document.removeEventListener('click', warnLink, true);
    };
  }, [dirty]);

  function switchMode(next: 'alle' | 'en') {
    setMode(next);
    router.replace(next === 'en' ? `${pathname}?modus=en` : pathname, { scroll: false });
  }

  return (
    <div className={mode === 'en' ? '' : 'max-w-5xl'}>
      <Link href={`/admin/utsendelser/${props.utsendelseId}`} className="mb-3 inline-block text-sm text-bjerke-blue hover:underline">
        ← {props.utsendelseNavn}
      </Link>
      {props.paused && (
        <p role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
          Utsendelsen står på pause. Trykk «Fortsett» på utsendelsen før du sender.
        </p>
      )}
      {props.pace.providerPausedUntil && !props.paused && <ProviderPauseNote until={props.pace.providerPausedUntil} />}
      {mode === 'en' ? (
        <OneByOne {...props} onBack={() => switchMode('alle')} onDirtyChange={setDirty} />
      ) : (
        <GroupCompose {...props} onOneByOne={() => switchMode('en')} onDirtyChange={setDirty} />
      )}
    </div>
  );
}

function GroupCompose({
  utsendelseId,
  group,
  flow,
  paused,
  pace,
  myEmail,
  testOthers,
  onOneByOne,
  onDirtyChange,
}: Props & { onOneByOne: () => void; onDirtyChange: (dirty: boolean) => void }) {
  const router = useRouter();
  const { run, busy } = useUtsendelseAction(utsendelseId);
  const [active, setActive] = useState(0);
  const [saved, setSaved] = useState(() => Object.fromEntries(flow.steps.map((s) => [s.nodeId, { subject: s.subject, bodyHtml: s.bodyHtml }])));
  const [drafts, setDrafts] = useState(saved);
  const [confirm, setConfirm] = useState(false);
  // En e-post som legges til etter at siden åpnet, har ingen lagret tekst i tilstanden ennå.
  const fromServer = Object.fromEntries(flow.steps.map((s) => [s.nodeId, { subject: s.subject, bodyHtml: s.bodyHtml }]));
  const savedAll = { ...fromServer, ...saved };
  const draftsAll = { ...savedAll, ...drafts };

  const dirtyIds = flow.steps.filter((s) => draftsAll[s.nodeId].subject !== savedAll[s.nodeId].subject || draftsAll[s.nodeId].bodyHtml !== savedAll[s.nodeId].bodyHtml).map((s) => s.nodeId);
  const dirty = dirtyIds.length > 0;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const step = flow.steps[Math.min(active, flow.steps.length - 1)];
  if (!step) return <p className="text-gray-600">Utsendelsen har ingen e-poster ennå.</p>;
  const draft = draftsAll[step.nodeId];
  const canSend = group.remaining > 0 && !paused && flow.status !== 'archived';

  async function saveAll() {
    for (const nodeId of dirtyIds) {
      const ok = await run('PATCH', '/epost', { flowId: flow.flowId, nodeId, ...draftsAll[nodeId] }, 'Teksten er lagret.', { refresh: false });
      if (!ok) return false;
      setSaved((s) => ({ ...s, [nodeId]: draftsAll[nodeId] }));
    }
    return true;
  }

  async function sendAll() {
    const data = await run('POST', '/send', { gruppeId: group.id }, (d) => sendResultMessage(d as unknown as SendResult), { refresh: false });
    if (!data) return;
    setConfirm(false);
    router.push(`/admin/utsendelser/${utsendelseId}`);
    router.refresh();
  }

  const sendLabel = group.sent > 0 ? `Send til ${formatCount(group.remaining)} nye` : `Send til alle ${formatCount(group.remaining)}`;

  return (
    <article className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" aria-labelledby="compose-title">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-5 py-3">
        <h1 id="compose-title" className="font-semibold text-gray-900">Ny e-post til {group.navn}</h1>
        <div className="flex flex-wrap items-center gap-1">
          <StepTabs steps={flow.steps} active={Math.min(active, flow.steps.length - 1)} onSelect={setActive} marked={(s) => dirtyIds.includes(s.nodeId)} />
          {flow.canChangeSteps && (
            <AddEmailButton
              utsendelseId={utsendelseId}
              flowId={flow.flowId}
              after={flow.steps.length}
              onAdded={() => setActive(flow.steps.length)}
            />
          )}
        </div>
      </header>

      <dl className="divide-y divide-gray-100 text-sm">
        <div className="flex items-center gap-3 px-5 py-2.5">
          <dt className="w-12 text-gray-500">Fra</dt>
          <dd>{flow.senderName ?? 'Mangler avsender'}</dd>
        </div>
        <div className="flex flex-wrap items-center gap-3 px-5 py-2.5">
          <dt className="w-12 text-gray-500">Til</dt>
          <dd className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-blue-50 px-3 py-0.5 font-medium text-blue-900 ring-1 ring-blue-200">
              {group.navn} · {group.remaining > 0 ? people(group.remaining) : 'alle har fått den'}
            </span>
            {!dirty && <button type="button" className="font-medium text-bjerke-blue hover:underline" onClick={onOneByOne}>Se hvem</button>}
          </dd>
        </div>
        <div className="flex items-center gap-3 px-5 py-2.5">
          <dt className="w-12 text-gray-500">Når</dt>
          <dd className="text-gray-700">{step.timing}</dd>
        </div>
      </dl>

      <div className="border-t border-gray-200 px-5 py-5">
        <EmailBodyEditor
          key={step.nodeId}
          subject={draft.subject}
          bodyHtml={draft.bodyHtml}
          anchorMode="contact"
          disabled={busy}
          onChange={(patch) => setDrafts((d) => ({ ...d, [step.nodeId]: { ...(d[step.nodeId] ?? draftsAll[step.nodeId]), ...patch } }))}
        />
        <p className="mt-3 text-xs text-gray-500">
          Flettefeltene fylles inn for hver mottaker. Endringer gjelder alle som ikke har fått e-posten ennå. Vil du skrive til én person, bruk «Gå gjennom én og én».
        </p>
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t border-gray-200 bg-gray-50 px-5 py-4">
        {dirty ? (
          <>
            <Button loading={busy} onClick={saveAll}>Lagre teksten</Button>
            <Button variant="secondary" disabled={busy} onClick={() => setDrafts(savedAll)}>Angre endringene</Button>
            <span className="text-sm text-gray-600">Lagre før du sender.</span>
          </>
        ) : (
          <>
            {canSend && <Button onClick={() => setConfirm(true)}>{sendLabel}</Button>}
            <Button variant="secondary" onClick={onOneByOne}>Gå gjennom én og én</Button>
            {myEmail && (
              <TestSendButton
                flowId={flow.flowId}
                nodeId={step.nodeId}
                myEmail={myEmail}
                others={testOthers}
                contactId={flow.sampleContactId}
                ignoreOverride
              />
            )}
            {!canSend && group.remaining === 0 && <span className="text-sm text-gray-600">Alle i gruppen har fått e-posten.</span>}
          </>
        )}
        {flow.sendWindow && <span className="ml-auto text-sm text-gray-500">Går ut {flow.sendWindow}. Resten av e-postene kommer av seg selv.</span>}
      </footer>

      <ConfirmModal
        open={confirm}
        variant="info"
        title={`Sende til ${people(group.remaining)} i «${group.navn}»?`}
        message={`E-post 1 går ut ${flow.sendWindow || 'nå'}. Resten av e-postene kommer automatisk etterpå til dem som ikke har svart eller meldt seg av. Du kan sette utsendelsen på pause når som helst.${paceSentence(group.remaining, pace.perHour)}`}
        confirmLabel="Send"
        loading={busy}
        onConfirm={sendAll}
        onCancel={() => setConfirm(false)}
      />
    </article>
  );
}

export function StepTabs<T extends { nodeId: number; number: number }>({
  steps,
  active,
  onSelect,
  marked,
}: {
  steps: T[];
  active: number;
  onSelect: (i: number) => void;
  marked?: (s: T) => boolean;
}) {
  if (steps.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-1 text-sm" role="tablist" aria-label="E-postene i rekken">
      {steps.map((s, i) => (
        <button
          key={s.nodeId}
          type="button"
          role="tab"
          aria-selected={i === active}
          onClick={() => onSelect(i)}
          className={`rounded-md px-3 py-1 ${i === active ? 'bg-white font-medium text-gray-900 shadow-sm ring-1 ring-gray-200' : 'text-gray-600 hover:bg-white'}`}
        >
          E-post {s.number}
          {marked?.(s) && <span className="ml-1 text-amber-600" aria-label="endret">•</span>}
        </button>
      ))}
    </div>
  );
}

/** «+ Ny e-post» etter den siste: velg hvor mange dager etter, så legges den til sist i rekken. */
function AddEmailButton({ utsendelseId, flowId, after, onAdded }: { utsendelseId: string; flowId: number; after: number; onAdded: () => void }) {
  const { run, busy } = useUtsendelseAction(utsendelseId);
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(7);
  const valid = Number.isInteger(days) && days >= 1 && days <= 60;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-md px-3 py-1 text-sm font-medium text-bjerke-blue hover:bg-white">
        + Ny e-post
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-white px-3 py-1 text-sm text-gray-700 ring-1 ring-gray-200">
      <label htmlFor={`ny-epost-${flowId}`}>Sendes</label>
      <input
        id={`ny-epost-${flowId}`}
        type="number"
        min={1}
        max={60}
        autoFocus
        value={Number.isFinite(days) ? days : ''}
        onChange={(e) => setDays(Number(e.target.value))}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        className="w-14 rounded-md border border-gray-300 px-2 py-0.5 text-sm tabular-nums"
      />
      <span>dager etter e-post {after}</span>
      <Button
        size="sm"
        loading={busy}
        disabled={!valid}
        onClick={async () => {
          if (await run('POST', '/epost', { flowId, days }, 'E-posten er lagt til. Skriv teksten i den nye e-posten.')) {
            setOpen(false);
            onAdded();
          }
        }}
      >
        Legg til
      </Button>
      <Button size="sm" variant="link" disabled={busy} onClick={() => setOpen(false)}>Avbryt</Button>
    </div>
  );
}
