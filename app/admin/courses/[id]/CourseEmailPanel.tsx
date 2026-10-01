'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/admin/Button';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { useToast } from '@/components/admin/Toast';
import { recipientNoun, type CourseEmailFilter } from '@/lib/course-email';

const inputClass =
  'w-full rounded-lg border px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-bjerke-blue';

interface Preview {
  html: string;
  subject: string;
  recipientCount: number;
}

type Errors = Partial<Record<'subject' | 'message', string>>;

function validate(subject: string, message: string): Errors {
  const errors: Errors = {};
  if (!subject.trim()) errors.subject = 'Skriv et emne, f.eks. «Oppmøte lørdag».';
  if (!message.trim()) errors.message = 'Skriv meldingen som skal sendes.';
  return errors;
}

/** Fellese-post til deltakerne: forhåndsvisning, test til seg selv, og bekreftelse med antall mottakere før noe sendes. */
export function CourseEmailPanel({ courseId, courseName, audience }: { courseId: number; courseName: string; audience: string }) {
  const { data: session } = useSession();
  const { toast } = useToast();
  const isAdult = audience === 'voksen';
  const filterLabels: Record<CourseEmailFilter, string> = {
    all: isAdult ? 'Alle deltakere' : 'Alle foresatte',
    confirmed: 'Bare bekreftede',
    pending: 'Bare de som venter på svar',
    waitlist: 'Bare de på venteliste',
  };

  const [recipientFilter, setRecipientFilter] = useState<CourseEmailFilter>('all');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'test' | 'send' | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const successRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sent) successRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [sent]);

  async function call(mode: 'preview' | 'test' | 'send') {
    const res = await fetch('/api/admin/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId, subject, message, recipientFilter, mode }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? 'E-posten ble ikke sendt. Prøv igjen om litt.');
    return data;
  }

  function checkForm(): boolean {
    const next = validate(subject, message);
    setErrors(next);
    const first = (['subject', 'message'] as const).find((k) => next[k]);
    if (first) document.getElementById(`course-email-${first}`)?.focus();
    return !first;
  }

  async function openPreview(e: React.FormEvent) {
    e.preventDefault();
    setSent(null);
    if (!checkForm()) return;
    setBusy('preview');
    try {
      setPreview(await call('preview'));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Kunne ikke lage forhåndsvisning.', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    if (!checkForm()) return;
    setBusy('test');
    try {
      const data = await call('test');
      toast(`Testen er sendt til ${data.sentTo}. Sjekk innboksen din.`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Testen ble ikke sendt.', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function sendForReal() {
    setBusy('send');
    try {
      const data = await call('send');
      const noun = recipientNoun(audience, data.sentCount);
      const text =
        data.sentCount === data.totalRecipients
          ? `E-posten «${subject.trim()}» er sendt til ${data.sentCount} ${noun}.`
          : `E-posten ble sendt til ${data.sentCount} av ${data.totalRecipients} ${recipientNoun(audience, data.totalRecipients)}. Noen adresser feilet — se aktivitetsloggen.`;
      setSent(text);
      toast(text, data.sentCount === data.totalRecipients ? 'success' : 'error');
      setPreview(null);
      setSubject('');
      setMessage('');
      setRecipientFilter('all');
      setErrors({});
    } catch (err) {
      toast(err instanceof Error ? err.message : 'E-posten ble ikke sendt. Prøv igjen om litt.', 'error');
    } finally {
      setBusy(null);
    }
  }

  const count = preview?.recipientCount ?? 0;
  const noun = recipientNoun(audience, count);

  return (
    <div className="max-w-3xl space-y-4">
      {sent && (
        <div
          ref={successRef}
          role="status"
          tabIndex={-1}
          className="flex items-start justify-between gap-4 rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900 focus:outline-none"
        >
          <p>
            <span className="font-semibold">Sendt.</span> {sent}
          </p>
          <button type="button" onClick={() => setSent(null)} className="shrink-0 font-medium underline underline-offset-2">
            Lukk
          </button>
        </div>
      )}

      <form onSubmit={openPreview} noValidate className="space-y-5 rounded-xl border border-gray-200 bg-white p-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Send e-post til {isAdult ? 'deltakerne' : 'foresatte'}</h2>
          <p className="mt-1 text-sm text-gray-600">
            Du ser e-posten og hvor mange som får den før noe sendes. Avlyste får den aldri.
          </p>
        </div>

        <fieldset>
          <legend className="mb-2 block text-sm font-medium text-gray-700">Hvem skal få e-posten?</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {(Object.keys(filterLabels) as CourseEmailFilter[]).map((filter) => (
              <label key={filter} className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-sm text-gray-800">
                <input
                  type="radio"
                  name="recipientFilter"
                  value={filter}
                  checked={recipientFilter === filter}
                  onChange={() => setRecipientFilter(filter)}
                  className="h-4 w-4 text-bjerke-blue focus:ring-bjerke-blue"
                />
                {filterLabels[filter]}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="course-email-subject" className="mb-1 block text-sm font-medium text-gray-700">Emne</label>
          <input
            id="course-email-subject"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onBlur={() => errors.subject && setErrors((p) => ({ ...p, subject: validate(subject, message).subject }))}
            placeholder={`Informasjon om ${courseName}`}
            aria-invalid={!!errors.subject}
            aria-describedby={errors.subject ? 'course-email-subject-error' : undefined}
            className={`${inputClass} ${errors.subject ? 'border-red-500' : 'border-gray-300'}`}
          />
          {errors.subject && <p id="course-email-subject-error" className="mt-1 text-sm text-red-700">{errors.subject}</p>}
        </div>

        <div>
          <label htmlFor="course-email-message" className="mb-1 block text-sm font-medium text-gray-700">Melding</label>
          <textarea
            id="course-email-message"
            rows={8}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onBlur={() => errors.message && setErrors((p) => ({ ...p, message: validate(subject, message).message }))}
            placeholder="Skriv meldingen her …"
            aria-invalid={!!errors.message}
            aria-describedby={errors.message ? 'course-email-message-error' : undefined}
            className={`${inputClass} resize-y ${errors.message ? 'border-red-500' : 'border-gray-300'}`}
          />
          {errors.message && <p id="course-email-message-error" className="mt-1 text-sm text-red-700">{errors.message}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
          <Button type="submit" loading={busy === 'preview'} loadingLabel="Henter mottakere …" disabled={busy !== null}>
            Forhåndsvis og send
          </Button>
          <Button variant="secondary" onClick={sendTest} loading={busy === 'test'} loadingLabel="Sender test …" disabled={busy !== null}>
            Send test til meg
          </Button>
          {session?.user?.email && <span className="text-sm text-gray-500">Testen går til {session.user.email}</span>}
        </div>
      </form>

      <ConfirmModal
        open={preview !== null}
        size="lg"
        variant="info"
        title={count === 0 ? 'Ingen mottakere' : `Sendes til ${count} ${noun} – bekreft`}
        message={
          count === 0
            ? 'Ingen påmeldte passer med valget. Velg en annen mottakergruppe.'
            : 'Slik ser e-posten ut. Den går ut med en gang og kan ikke kalles tilbake.'
        }
        confirmLabel={count === 0 ? 'Lukk' : `Send til ${count} ${noun}`}
        loading={busy === 'send'}
        onConfirm={count === 0 ? () => setPreview(null) : sendForReal}
        onCancel={() => setPreview(null)}
      >
        {preview && (
          <div className="overflow-hidden rounded-lg border border-gray-200 text-left">
            <p className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-sm">
              <span className="text-gray-500">Emne:</span> <span className="font-medium text-gray-900">{preview.subject}</span>
            </p>
            <iframe
              title="Forhåndsvisning av e-posten"
              sandbox=""
              srcDoc={`<!doctype html><meta charset="utf-8"><body style="margin:16px">${preview.html}</body>`}
              className="h-72 w-full bg-white"
            />
          </div>
        )}
      </ConfirmModal>
    </div>
  );
}
