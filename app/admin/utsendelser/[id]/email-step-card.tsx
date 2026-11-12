'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/admin/Button';
import { useToast } from '@/components/admin/Toast';
import type { StepView } from '@/lib/utsendelser/overview';
import { EmailBodyEditor } from '@/app/admin/crm/flyter/[id]/email-body-editor';
import { formatCount } from '../status';

interface Props {
  utsendelseId: string;
  flowId: number;
  step: StepView;
  sampleContactId: number | null;
  myEmail: string;
}

export function EmailStepCard({ utsendelseId, flowId, step, sampleContactId, myEmail }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(step.number === 1);
  const [draft, setDraft] = useState({ subject: step.subject, bodyHtml: step.bodyHtml });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  function startEditing() {
    setDraft({ subject: step.subject, bodyHtml: step.bodyHtml });
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/utsendelser/${utsendelseId}/epost`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flowId, nodeId: step.nodeId, ...draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error ?? 'Kunne ikke lagre. Prøv igjen.', 'error');
        return;
      }
      toast(`E-post ${step.number} er lagret.`, 'success');
      setEditing(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
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

  return (
    <article className="rounded-xl border border-gray-200 bg-white" aria-labelledby={`step-${step.nodeId}`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-5 py-3">
        <div>
          <h4 id={`step-${step.nodeId}`} className="font-semibold text-gray-900">E-post {step.number}</h4>
          <p className="text-sm text-gray-600">{step.timing}</p>
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
            disabled={saving}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
          />
          {step.sent > 0 && (
            <p className="text-sm text-amber-900">De som allerede har fått denne e-posten, får ikke den nye teksten.</p>
          )}
          <div className="flex gap-3">
            <Button loading={saving} onClick={save}>Lagre</Button>
            <Button variant="secondary" disabled={saving} onClick={() => setEditing(false)}>Avbryt</Button>
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
            <Button variant="secondary" size="sm" onClick={startEditing}>Endre</Button>
            {myEmail && (
              <Button variant="secondary" size="sm" loading={testing} onClick={sendTest}>
                Send test til meg
              </Button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
