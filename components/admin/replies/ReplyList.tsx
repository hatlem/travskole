'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@/components/admin/Button';
import { Badge } from '@/components/admin/StatusBadge';
import { useToast } from '@/components/admin/Toast';
import type { ReplyItem } from '@/lib/replies/list';

const when = (iso: string) =>
  new Date(iso).toLocaleString('nb-NO', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' });

async function fetchReplies(query: string): Promise<ReplyItem[]> {
  const res = await fetch(`/api/admin/svar?status=all${query ? `&${query}` : ''}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(String(res.status));
  return ((await res.json()) as { replies: ReplyItem[] }).replies;
}

/** Varsler menyen og dashbordet om at antallet som må svares, er endret. */
export const REPLIES_CHANGED = 'svar-endret';

interface Props {
  /** F.eks. `utsendelse=juletrav-2026` eller `kontakt=12`. Tom = alle. */
  query?: string;
  /** Vis hvem svaret er fra (av når lista står på kontakten selv). */
  showContact?: boolean;
  /** Vis utsendelsen svaret hører til (av når lista står på utsendelsen). */
  showUtsendelse?: boolean;
  /** Vises når det ikke finnes noen svar. null = vis ingenting. */
  empty?: ReactNode;
}

/** Svar fra kontakter: de som må svares øverst, så de som er behandlet. Svar, «Trenger ikke svar» eller «Besvart i Outlook». */
export function ReplyList({ query = '', showContact = true, showUtsendelse = true, empty = null }: Props) {
  const [replies, setReplies] = useState<ReplyItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(() => {
    fetchReplies(query).then(
      (items) => { setReplies(items); setFailed(false); },
      () => setFailed(true),
    );
  }, [query]);

  useEffect(() => {
    let alive = true;
    fetchReplies(query).then(
      (items) => { if (alive) { setReplies(items); setFailed(false); } },
      () => { if (alive) setFailed(true); },
    );
    return () => { alive = false; };
  }, [query]);

  const changed = useCallback(() => {
    refresh();
    window.dispatchEvent(new Event(REPLIES_CHANGED));
  }, [refresh]);

  if (failed && !replies) return <p className="text-sm text-red-700">Fikk ikke hentet svarene. Last siden på nytt.</p>;
  if (!replies) return <p className="text-sm text-gray-500">Henter svar …</p>;
  if (replies.length === 0) return <>{empty}</>;

  const open = replies.filter((r) => r.status === 'open');
  const handled = replies.filter((r) => r.status !== 'open');
  return (
    <div className="space-y-6">
      {open.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-red-800">Må svares ({open.length})</h3>
          <ul className="space-y-3">
            {open.map((r) => <ReplyCard key={r.id} reply={r} showContact={showContact} showUtsendelse={showUtsendelse} onChanged={changed} />)}
          </ul>
        </div>
      )}
      {open.length === 0 && <p className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">Alle svar er behandlet.</p>}
      {handled.length > 0 && (
        <details open={open.length === 0 && handled.length <= 5}>
          <summary className="cursor-pointer text-sm font-semibold text-gray-700">Behandlet ({handled.length})</summary>
          <ul className="mt-2 space-y-3">
            {handled.map((r) => <ReplyCard key={r.id} reply={r} showContact={showContact} showUtsendelse={showUtsendelse} onChanged={changed} />)}
          </ul>
        </details>
      )}
    </div>
  );
}

const LONG = 700;

function ReplyCard({ reply: r, showContact, showUtsendelse, onChanged }: { reply: ReplyItem; showContact: boolean; showUtsendelse: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const textId = useId();
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(r.bodyText.length <= LONG);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const firstName = (r.fromName ?? r.contactName).split(/\s+/)[0] || r.fromEmail;

  useEffect(() => {
    if (writing) areaRef.current?.focus();
  }, [writing]);

  async function call(method: 'POST' | 'PATCH', body: unknown, success: string): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/svar/${r.id}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error ?? 'Noe gikk galt. Prøv igjen.', 'error');
        return false;
      }
      toast(success, 'success');
      onChanged();
      return true;
    } catch {
      toast('Fikk ikke kontakt. Sjekk nettet og prøv igjen.', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const status =
    r.status === 'open' ? <Badge className="bg-red-100 text-red-800">Må svares</Badge>
      : r.status === 'answered' ? <Badge className="bg-green-100 text-green-800">Besvart{r.handledAt ? ` ${when(r.handledAt)}` : ''}</Badge>
        : <Badge className="bg-gray-100 text-gray-700">Trenger ikke svar</Badge>;

  return (
    <li className={`rounded-xl border bg-white px-5 py-4 text-sm ${r.status === 'open' ? 'border-red-200' : 'border-gray-200'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {showContact && (
            <p className="font-medium text-gray-900">
              <Link href={`/admin/crm/kontakter/${r.contactId}`} className="hover:underline">{r.contactName}</Link>
              {r.organization ? <span className="font-normal text-gray-600"> · {r.organization}</span> : null}
            </p>
          )}
          <p className="text-gray-600">
            {r.fromName && r.fromName !== r.contactName ? `${r.fromName} · ` : ''}{r.fromEmail} · {when(r.receivedAt)}
          </p>
          {(r.inReplyToSubject || (showUtsendelse && r.utsendelse)) && (
            <p className="text-xs text-gray-500">
              {r.inReplyToSubject ? `Svar på «${r.inReplyToSubject}»` : ''}
              {showUtsendelse && r.utsendelse ? (
                <>{r.inReplyToSubject ? ' · ' : ''}<Link href={`/admin/utsendelser/${r.utsendelse.id}`} className="hover:underline">{r.utsendelse.navn}</Link></>
              ) : null}
            </p>
          )}
        </div>
        {status}
      </div>

      <div className="mt-3 rounded-lg bg-gray-50 px-4 py-3 text-gray-900">
        {r.bodyText ? (
          <>
            <p className="whitespace-pre-wrap break-words">{expanded ? r.bodyText : `${r.bodyText.slice(0, LONG).trimEnd()} …`}</p>
            {r.bodyText.length > LONG && (
              <button type="button" onClick={() => setExpanded((e) => !e)} className="mt-1 text-xs text-bjerke-blue hover:underline">
                {expanded ? 'Vis mindre' : 'Vis hele'}
              </button>
            )}
          </>
        ) : (
          <p className="text-gray-500">Svaret har ingen tekst (kanskje bare et vedlegg). Se e-posten i registrering@bjerke.no.</p>
        )}
      </div>

      {r.answer && (
        <div className="mt-3 border-l-2 border-bjerke-blue/40 pl-4">
          <p className="text-xs text-gray-500">Svar fra {r.answer.from || 'oss'} · {when(r.answer.sentAt)}</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-gray-800">{r.answer.text}</p>
        </div>
      )}
      {!r.answer && r.status !== 'open' && r.handledBy && (
        <p className="mt-2 text-xs text-gray-500">
          {r.status === 'answered' ? 'Merket som besvart' : 'Merket «trenger ikke svar»'} av {r.handledBy}
        </p>
      )}

      {writing ? (
        <div className="mt-4">
          <label htmlFor={textId} className="block font-medium text-gray-900">Svar til {firstName}</label>
          <textarea
            id={textId}
            ref={areaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            maxLength={20_000}
            placeholder={`Hei ${firstName}, …`}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-bjerke-blue focus:ring-2 focus:ring-bjerke-blue/20"
          />
          <p className="mt-1 text-xs text-gray-500">
            Sendes {r.replyFrom ? `fra ${r.replyFrom.name} (${r.replyFrom.email}) ` : ''}til {r.fromEmail}, i samme e-posttråd. Svarer {firstName} igjen, dukker det opp her.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              loading={busy}
              disabled={!text.trim()}
              onClick={async () => { if (await call('POST', { text }, `Svaret er sendt til ${firstName}.`)) setWriting(false); }}
            >
              Send svar til {firstName}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setWriting(false)}>Avbryt</Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          {r.status === 'open' && (
            <>
              <Button onClick={() => setWriting(true)}>Svar</Button>
              <Button variant="secondary" disabled={busy} onClick={() => void call('PATCH', { status: 'no_reply' }, 'Merket «trenger ikke svar».')}>Trenger ikke svar</Button>
              <Button variant="link" disabled={busy} onClick={() => void call('PATCH', { status: 'answered' }, 'Merket som besvart.')}>Har svart i Outlook</Button>
            </>
          )}
          {r.status !== 'open' && !r.answer && (
            <Button variant="link" disabled={busy} onClick={() => void call('PATCH', { status: 'open' }, 'Flyttet tilbake til «Må svares».')}>Angre</Button>
          )}
        </div>
      )}
    </li>
  );
}
