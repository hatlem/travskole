'use client';

import { useState } from 'react';
import { Button } from '@/components/admin/Button';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { useToast } from '@/components/admin/Toast';
import type { StepView } from '@/lib/utsendelser/overview';
import { EmailBodyEditor } from '@/app/admin/crm/flyter/[id]/email-body-editor';
import { formatCount } from '../status';
import { useUtsendelseAction } from './use-action';

interface Props {
  utsendelseId: string;
  flowId: number;
  step: StepView;
  sampleContactId: number | null;
  myEmail: string;
  canRemove: boolean;
}

const MAX_DAYS = 60;

export function EmailStepCard({ utsendelseId, flowId, step, sampleContactId, myEmail, canRemove }: Props) {
  const { toast } = useToast();
  const { run, busy } = useUtsendelseAction(utsendelseId);
  const [editing, setEditing] = useState(false);
  const [editingWait, setEditingWait] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [expanded, setExpanded] = useState(step.number === 1);
  const [draft, setDraft] = useState({ subject: step.subject, bodyHtml: step.bodyHtml });
  const [days, setDays] = useState(step.waitDays ?? 7);
  const [testing, setTesting] = useState(false);

  async function save() {
    if (await run('PATCH', '/epost', { flowId, nodeId: step.nodeId, ...draft }, `E-post ${step.number} er lagret.`)) setEditing(false);
  }

  async function saveWait() {
    if (await run('PATCH', '/ventetid', { flowId, nodeId: step.nodeId, days }, 'Ventetiden er endret.')) setEditingWait(false);
  }

  async function remove() {
    if (await run('DELETE', '/epost', { flowId, nodeId: step.nodeId }, `E-post ${step.number} er fjernet.`)) setConfirmRemove(false);
  }

  async function sendTest() {
    if (!myEmail) return;
    setTesting(true);
    try {
      const res = await fetch(`/api/admin/crm/flows/${flowId}/test-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: step.nodeId, toEmail: myEmail, ...(sampleContactId && { contactId: sampleContactId }) }),
      });
      const data = await res.json().catch(() => ({}));
      toast(res.ok ? `Test sendt til ${myEmail}.` : data.error ?? 'Kunne ikke sende test.', res.ok ? 'success' : 'error');
    } finally {
      setTesting(false);
    }
  }

  const daysValid = Number.isInteger(days) && days >= 1 && days <= MAX_DAYS;

  return (
    <article className="rounded-xl border border-gray-200 bg-white" aria-labelledby={`step-${step.nodeId}`}>
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
            Sendt {formatCount(step.sent)} · åpnet {formatCount(step.opened)} · klikket {formatCount(step.clicked)} · svar {formatCount(step.replied)}
          </p>
        )}
      </header>

      {editing ? (
        <div className="space-y-4 px-5 py-4">
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
          <p className="font-medium text-gray-900">{step.previewSubject}</p>
          <div className="relative mt-3">
            <div
              className={`prose prose-sm prose-a:text-bjerke-blue max-w-none text-gray-800 ${expanded ? '' : 'max-h-28 overflow-hidden'}`}
              // Innholdet er sanitert i renderFlowEmailBody (DOMPurify).
              dangerouslySetInnerHTML={{ __html: step.previewHtml }}
            />
            {!expanded && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-white" />}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button variant="secondary" size="sm" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Vis mindre' : 'Vis hele e-posten'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setDraft({ subject: step.subject, bodyHtml: step.bodyHtml });
                setEditing(true);
              }}
            >
              Endre teksten
            </Button>
            {myEmail && (
              <Button variant="secondary" size="sm" loading={testing} onClick={sendTest}>
                Send test til meg
              </Button>
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
