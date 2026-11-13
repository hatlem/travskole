'use client';

import { useCallback, useState } from 'react';
import { buttonClass, Spinner } from '@/components/admin/Button';
import { useToast } from '@/components/admin/Toast';
import { usePopoverDismiss } from '@/components/admin/crm/usePopover';
import type { TestRecipient } from '@/lib/utsendelser/staff';

interface Props {
  flowId: number;
  nodeId: number;
  myEmail: string;
  /** Andre ansatte å velge mellom. */
  others: TestRecipient[];
  /** Flettedata (og egen tekst) fra denne kontakten. */
  contactId?: number | null;
  /** Send fellesteksten selv om kontakten har egen tekst. */
  ignoreOverride?: boolean;
  /** Kjøres før sending (f.eks. lagre ulagret tekst); false stopper. */
  before?: () => Promise<boolean>;
  /** Hvem testen viser e-posten for, til meldingen («slik Kari får den»). */
  forName?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** «Send test til meg», med en pil som lar deg sende testen til en kollega eller en annen adresse. */
export function TestSendButton({ flowId, nodeId, myEmail, others, contactId, ignoreOverride, before, forName }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [other, setOther] = useState('');
  const close = useCallback(() => setOpen(false), []);
  const { containerRef, triggerRef } = usePopoverDismiss<HTMLDivElement>(open, close);

  async function send(toEmail: string) {
    if (before && !(await before())) return;
    setSending(true);
    try {
      const res = await fetch(`/api/admin/crm/flows/${flowId}/test-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, toEmail, ...(contactId && { contactId }), ...(ignoreOverride && { ignoreOverride: true }) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error ?? 'Kunne ikke sende test.', 'error');
        return;
      }
      toast(`Test sendt til ${toEmail}${forName ? `, slik ${forName} får den` : ''}.`, 'success');
      setOpen(false);
      setOther('');
    } finally {
      setSending(false);
    }
  }

  const otherValid = EMAIL.test(other.trim());

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        disabled={sending || !myEmail}
        onClick={() => send(myEmail)}
        className={buttonClass('secondary', 'sm', 'rounded-r-none')}
      >
        {sending && <Spinner />}
        Send test til meg
      </button>
      <button
        ref={triggerRef}
        type="button"
        disabled={sending}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Send test til en annen e-postadresse"
        title="Send test til en annen"
        onClick={() => setOpen((v) => !v)}
        className={buttonClass('secondary', 'sm', '-ml-px rounded-l-none')}
      >
        <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          ref={containerRef}
          role="dialog"
          aria-label="Send test til"
          className="absolute bottom-full left-0 z-30 mb-2 w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-lg"
        >
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Send test til</p>
          {others.length > 0 && (
            <ul className="mb-2 max-h-48 overflow-y-auto">
              {others.map((o) => (
                <li key={o.email}>
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => send(o.email)}
                    className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-50 disabled:opacity-50"
                  >
                    <span className="block font-medium text-gray-900">{o.label}</span>
                    {o.label !== o.email && <span className="block text-xs text-gray-500">{o.email}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex gap-2 border-t border-gray-100 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (otherValid) send(other.trim());
            }}
          >
            <label htmlFor={`test-${nodeId}`} className="sr-only">Annen e-postadresse</label>
            <input
              id={`test-${nodeId}`}
              type="email"
              autoFocus={others.length === 0}
              placeholder="Annen e-post"
              value={other}
              onChange={(e) => setOther(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
            <button type="submit" disabled={!otherValid || sending} className={buttonClass('primary', 'sm')}>
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
