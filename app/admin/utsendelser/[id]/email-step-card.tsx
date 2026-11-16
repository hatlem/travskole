'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/admin/Button';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import type { StepView } from '@/lib/utsendelser/overview';
import { EmailBodyEditor } from '@/app/admin/crm/flyter/[id]/email-body-editor';
import { formatCount, sentRange } from '../status';
import { useUtsendelseAction } from './use-action';
import { TestSendButton } from './test-send-button';
import type { TestRecipient } from '@/lib/utsendelser/staff';

interface Props {
  utsendelseId: string;
  flowId: number;
  step: StepView;
  sampleContactId: number | null;
  myEmail: string;
  testOthers: TestRecipient[];
  canRemove: boolean;
}

const MAX_DAYS = 60;

export function EmailStepCard({ utsendelseId, flowId, step, sampleContactId, myEmail, testOthers, canRemove }: Props) {
  const { run, busy } = useUtsendelseAction(utsendelseId);
  const [editing, setEditing] = useState(false);
  const [editingWait, setEditingWait] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [draft, setDraft] = useState({ subject: step.subject, bodyHtml: step.bodyHtml });
  const [days, setDays] = useState(step.waitDays ?? 7);
  const [focusOn, setFocusOn] = useState<'subject' | 'body'>('body');
  const cardRef = useRef<HTMLElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // Lenkene i forhåndsvisningen skal ikke kunne åpnes eller nås med Tab (teksten skal fortsatt kunne markeres).
  useEffect(() => {
    previewRef.current?.querySelectorAll('a').forEach((a) => a.setAttribute('tabindex', '-1'));
  }, [step.previewHtml, editing]);

  function startEditing(target: 'subject' | 'body') {
    setDraft({ subject: step.subject, bodyHtml: step.bodyHtml });
    setFocusOn(target);
    setEditing(true);
  }

  // Sett markøren der hun klikket: i emnet, eller i teksten når editoren er lastet.
  useEffect(() => {
    if (!editing) return;
    const card = cardRef.current;
    if (focusOn === 'subject') {
      card?.querySelector<HTMLInputElement>('#email-subject')?.focus();
      return;
    }
    let tries = 0;
    const timer = window.setInterval(() => {
      const body = card?.querySelector<HTMLElement>('.ProseMirror');
      if (body || ++tries > 20) {
        body?.focus();
        window.clearInterval(timer);
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [editing, focusOn]);

  async function save() {
    if (await run('PATCH', '/epost', { flowId, nodeId: step.nodeId, ...draft }, `E-post ${step.number} er lagret.`)) setEditing(false);
  }

  async function saveWait() {
    const message = (data: Record<string, unknown>) => {
      const moved = typeof data.moved === 'number' ? data.moved : 0;
      return moved > 0
        ? `Ventetiden er endret. ${formatCount(moved)} som venter på e-post ${step.number}, har fått ny dato.`
        : 'Ventetiden er endret.';
    };
    if (await run('PATCH', '/ventetid', { flowId, nodeId: step.nodeId, days }, message)) setEditingWait(false);
  }

  async function remove() {
    if (await run('DELETE', '/epost', { flowId, nodeId: step.nodeId }, `E-post ${step.number} er fjernet.`)) setConfirmRemove(false);
  }

  const daysValid = Number.isInteger(days) && days >= 1 && days <= MAX_DAYS;

  return (
    <article ref={cardRef} className="rounded-xl border border-gray-200 bg-white" aria-labelledby={`step-${step.nodeId}`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-5 py-3">
        <div>
          <h4 id={`step-${step.nodeId}`} className="font-semibold text-gray-900">E-post {step.number}</h4>
          {editingWait ? (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-700">
              <label htmlFor={`wait-${step.nodeId}`}>Sendes</label>
              <input
                id={`wait-${step.nodeId}`}
                type="number"
                min={1}
                max={MAX_DAYS}
                value={Number.isFinite(days) ? days : ''}
                onChange={(e) => setDays(Number(e.target.value))}
                className="w-16 rounded-md border border-gray-300 px-2 py-1 text-sm tabular-nums"
              />
              <span>dager etter e-post {step.number - 1}</span>
              <Button size="sm" loading={busy} disabled={!daysValid} onClick={saveWait}>Lagre</Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditingWait(false)}>Avbryt</Button>
            </div>
          ) : (
            <p className="text-sm text-gray-600">
              {step.timing}
              {step.waitDays !== null && (
                <>
                  {' · '}
                  <button
                    type="button"
                    className="font-medium text-bjerke-blue hover:underline"
                    onClick={() => {
                      setDays(step.waitDays ?? 7);
                      setEditingWait(true);
                    }}
                  >
                    Endre ventetid
                  </button>
                </>
              )}
            </p>
          )}
        </div>
        {step.sent > 0 && (
          <p className="text-sm text-gray-700">
            Sendt til {formatCount(step.sent)} · {sentRange(step.firstSentAt, step.lastSentAt)} · åpnet {formatCount(step.opened)} · klikket {formatCount(step.clicked)} · svar {formatCount(step.replied)}
          </p>
        )}
      </header>

      {editing ? (
        <div className="space-y-4 px-5 py-4">
          <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900">
            Dette er felles tekst for alle som får e-post {step.number}. Flettefelt som {'{{fornavn}}'} byttes ut med hver mottakers egen verdi.
          </p>
          <EmailBodyEditor
            subject={draft.subject}
            bodyHtml={draft.bodyHtml}
            anchorMode="contact"
            disabled={busy}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
          />
          {step.sent > 0 && <p className="text-sm text-amber-900">De som allerede har fått denne e-posten, får ikke den nye teksten.</p>}
          <div className="flex gap-3">
            <Button loading={busy} onClick={save}>Lagre</Button>
            <Button variant="secondary" disabled={busy} onClick={() => setEditing(false)}>Avbryt</Button>
          </div>
        </div>
      ) : (
        <div className="px-5 py-4">
          <p className="text-sm text-gray-600">Emne</p>
          <button
            type="button"
            title="Klikk for å endre emnet og teksten"
            aria-label={`Endre emne og tekst i e-post ${step.number}: ${step.previewSubject}`}
            onClick={() => startEditing('subject')}
            className="-mx-2 block rounded-md px-2 py-0.5 text-left font-medium text-gray-900 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bjerke-blue"
          >
            {step.previewSubject}
          </button>
          {/* Klikk i teksten åpner redigering (emnet over er knappen for tastatur). Lenkene er døde her. */}
          <div
            title="Klikk for å endre teksten"
            onClick={() => {
              if (window.getSelection()?.toString()) return; // markerer tekst for å kopiere
              startEditing('body');
            }}
            className="-mx-2 mt-2 cursor-text rounded-md px-2 py-1 hover:bg-gray-50"
          >
            <div
              ref={previewRef}
              className="prose prose-sm prose-a:text-bjerke-blue max-w-none text-gray-800 [&_a]:pointer-events-none"
              // Innholdet er sanitert i renderFlowEmailBody (DOMPurify).
              dangerouslySetInnerHTML={{ __html: step.previewHtml }}
            />
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {sampleContactId !== null ? 'Vist slik én mottaker ser den. ' : ''}Klikk på emnet eller teksten for å endre den for alle.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {myEmail && (
              <TestSendButton flowId={flowId} nodeId={step.nodeId} myEmail={myEmail} others={testOthers} contactId={sampleContactId} ignoreOverride />
            )}
            {canRemove && (
              <Button variant="dangerText" size="sm" onClick={() => setConfirmRemove(true)}>
                Fjern e-posten
              </Button>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmRemove}
        title={`Fjerne e-post ${step.number}?`}
        message="E-posten og teksten slettes. De andre e-postene blir som før."
        confirmLabel="Fjern"
        loading={busy}
        onConfirm={remove}
        onCancel={() => setConfirmRemove(false)}
      />
    </article>
  );
}
