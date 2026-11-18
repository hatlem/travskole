'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@/components/admin/Button';
import { Badge } from '@/components/admin/StatusBadge';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { useToast } from '@/components/admin/Toast';
import type { ReplyItem } from '@/lib/replies/list';
import type { NextYearSummary } from '@/lib/replies/neste-aar';
import { MAX_THANKS_TEXT, greetingName, renderThanks, type ThanksMode } from '@/lib/replies/thanks-text';

const when = (iso: string) =>
  new Date(iso).toLocaleString('nb-NO', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' });

const day = (iso: string) => new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' });

interface ThanksInfo { mode: ThanksMode; text: string; venter: number; aiEnabled: boolean }
interface RepliesData { replies: ReplyItem[]; nesteAar: NextYearSummary; takk: ThanksInfo }

async function fetchReplies(query: string): Promise<RepliesData> {
  const res = await fetch(`/api/admin/svar?status=all${query ? `&${query}` : ''}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as RepliesData;
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
  /** Vis oversikten over hvem som er spart til neste år (på «Svar»-siden). */
  showNextYear?: boolean;
  /** Vis valget for takk-svar (på «Svar»-siden). */
  showThanks?: boolean;
}

/** Svar fra kontakter: de som må svares øverst, så de som er behandlet. Svar, «Trenger ikke svar» eller «Besvart i Outlook». */
export function ReplyList({ query = '', showContact = true, showUtsendelse = true, empty = null, showNextYear = false, showThanks = false }: Props) {
  const [data, setData] = useState<RepliesData | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(() => {
    fetchReplies(query).then(
      (d) => { setData(d); setFailed(false); },
      () => setFailed(true),
    );
  }, [query]);

  useEffect(() => {
    let alive = true;
    fetchReplies(query).then(
      (d) => { if (alive) { setData(d); setFailed(false); } },
      () => { if (alive) setFailed(true); },
    );
    return () => { alive = false; };
  }, [query]);
  const replies = data?.replies ?? null;

  const changed = useCallback(() => {
    refresh();
    window.dispatchEvent(new Event(REPLIES_CHANGED));
  }, [refresh]);

  if (failed && !replies) return <p className="text-sm text-red-700">Fikk ikke hentet svarene. Last siden på nytt.</p>;
  if (!replies) return <p className="text-sm text-gray-500">Henter svar …</p>;
  if (replies.length === 0) return <>{showThanks && <ThanksPanel info={data!.takk} onChanged={changed} />}{empty}</>;

  const nesteAar = data!.nesteAar;
  const takk = data!.takk;
  const open = replies.filter((r) => r.status === 'open');
  const handled = replies.filter((r) => r.status !== 'open');
  const card = (r: ReplyItem) => (
    <ReplyCard key={r.id} reply={r} nextYearName={nesteAar.navn} thanks={takk} showContact={showContact} showUtsendelse={showUtsendelse} onChanged={changed} />
  );
  return (
    <div className="space-y-6">
      {showThanks && <ThanksPanel info={takk} onChanged={changed} />}
      {showNextYear && <NextYearPanel summary={nesteAar} />}
      {open.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-red-800">Må svares ({open.length})</h3>
          <ul className="space-y-3">
            {open.map(card)}
          </ul>
        </div>
      )}
      {open.length === 0 && <p className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">Alle svar er behandlet.</p>}
      {handled.length > 0 && (
        <details open={open.length === 0 && handled.length <= 5}>
          <summary className="cursor-pointer text-sm font-semibold text-gray-700">Behandlet ({handled.length})</summary>
          <ul className="mt-2 space-y-3">
            {handled.map(card)}
          </ul>
        </details>
      )}
    </div>
  );
}

const THANKS_CHOICES: { mode: ThanksMode; label: string; help: string }[] = [
  { mode: 'click', label: 'Ett klikk', help: 'Claude finner de vennlige svarene. Du sender takken med én knapp.' },
  { mode: 'auto', label: 'Automatisk', help: 'Claude sender takken selv når et vennlig svar kommer inn, fra den som sendte e-posten de svarte på.' },
  { mode: 'off', label: 'Av', help: 'Ingen takk-knapper.' },
];

/** Takk-svar på vennlige svar: Hilde velger av, ett klikk eller automatisk, og skriver teksten selv. */
function ThanksPanel({ info, onChanged }: { info: ThanksInfo; onChanged: () => void }) {
  const { toast } = useToast();
  const textId = useId();
  const groupName = useId();
  const [mode, setMode] = useState<ThanksMode>(info.mode);
  const [text, setText] = useState(info.text);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const dirty = mode !== info.mode || text.trim() !== info.text.trim();

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/svar/takk', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, text }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error ?? 'Noe gikk galt. Prøv igjen.', 'error'); return; }
      toast('Lagret.', 'success');
      onChanged();
    } catch {
      toast('Fikk ikke kontakt. Sjekk nettet og prøv igjen.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function sendAll() {
    setSending(true);
    try {
      const res = await fetch('/api/admin/svar/takk', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error ?? 'Noe gikk galt. Prøv igjen.', 'error'); return; }
      const parts = [`Takk sendt til ${data.sent}.`];
      if (data.skipped) parts.push(`${data.skipped} hoppet over (besvart eller har et spørsmål).`);
      if (data.failed) parts.push('Sendingen stoppet på grunn av en feil. Prøv igjen om litt.');
      else if (data.remaining) parts.push(`${data.remaining} gjenstår, trykk igjen.`);
      toast(parts.join(' '), data.failed ? 'error' : 'success');
      onChanged();
    } catch {
      toast('Fikk ikke kontakt. Sjekk nettet og prøv igjen.', 'error');
    } finally {
      setSending(false);
      setConfirming(false);
    }
  }

  return (
    <details className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm" open={info.venter > 0}>
      <summary className="cursor-pointer font-semibold text-gray-900">
        Takk-svar på vennlige svar
        <span className="ml-2 font-normal text-gray-600">
          {THANKS_CHOICES.find((c) => c.mode === info.mode)?.label}
          {info.mode !== 'off' && info.venter > 0 ? ` · ${info.venter} venter på takk` : ''}
        </span>
      </summary>

      {!info.aiEnabled && info.mode !== 'off' && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-amber-950">
          Claude er ikke slått på ennå, fordi API-nøkkelen mangler. Når den er på plass, finner Claude de vennlige svarene, og takk-knappene dukker opp.
        </p>
      )}

      {info.mode !== 'off' && info.venter > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-green-50 px-3 py-2 text-green-950">
          <span>{info.venter === 1 ? 'Ett vennlig svar venter' : `${info.venter} vennlige svar venter`} på en takk.</span>
          <Button size="sm" onClick={() => setConfirming(true)}>Send takk til alle ({info.venter})</Button>
        </div>
      )}

      <fieldset className="mt-3">
        <legend className="font-medium text-gray-900">Hvordan skal takken sendes?</legend>
        <div className="mt-1 space-y-1">
          {THANKS_CHOICES.map((c) => (
            <label key={c.mode} className="flex cursor-pointer items-start gap-2">
              <input type="radio" name={groupName} className="mt-1" checked={mode === c.mode} onChange={() => setMode(c.mode)} />
              <span><span className="font-medium">{c.label}</span> <span className="text-gray-600">· {c.help}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      <label htmlFor={textId} className="mt-3 block font-medium text-gray-900">Takketekst</label>
      <textarea
        id={textId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={MAX_THANKS_TEXT}
        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-bjerke-blue focus:ring-2 focus:ring-bjerke-blue/20"
      />
      <p className="mt-1 text-xs text-gray-500">
        {'{fornavn}'} byttes ut med fornavnet til den som svarte. Takken sendes i samme e-posttråd, fra den som sendte e-posten de svarte på.
        Svar med spørsmål, autosvar og de som vil vite mer, får aldri takk automatisk.
      </p>
      <div className="mt-2">
        <Button size="sm" loading={saving} disabled={!dirty || !text.trim()} onClick={() => void save()}>Lagre</Button>
      </div>

      <ConfirmModal
        open={confirming}
        title={`Send takk til ${info.venter}?`}
        message="Hver av dem får dette svaret i samme e-posttråd. Det kan ikke angres."
        confirmLabel="Send takk"
        variant="info"
        loading={sending}
        onConfirm={() => void sendAll()}
        onCancel={() => setConfirming(false)}
      >
        <p className="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-800">{renderThanks(info.text, 'Kari')}</p>
      </ConfirmModal>
    </details>
  );
}

/** Hvem som er spart til neste år, og når Hilde blir minnet på dem. */
function NextYearPanel({ summary }: { summary: NextYearSummary }) {
  if (summary.antall === 0) {
    return (
      <p className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">
        Svarer noen at de allerede har bestilt julebord? Trykk «Spar til {summary.navn}» på svaret. Da får du en påminnelse om dem på e-post {day(summary.paminnelse)}, så du kan sende dem tilbud i september.
      </p>
    );
  }
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
      <p>
        <strong>{summary.navn}:</strong> {summary.antall} {summary.antall === 1 ? 'kontakt er spart' : 'kontakter er spart'} til neste år.
        Du får en påminnelse på e-post {day(summary.paminnelse)}, så du kan sende dem tilbud i september.
      </p>
      {summary.utsendelse && (
        <p className="mt-1">
          Utsendelsen til dem ligger klar som utkast. Den går ikke av seg selv: i august skriver du inn dato og pris og trykker start.
        </p>
      )}
      <p className="mt-1 flex flex-wrap gap-x-4">
        {summary.listId != null && (
          <Link href={`/admin/crm/kontakter?listId=${summary.listId}`} className="text-bjerke-blue hover:underline">Se hvem</Link>
        )}
        {summary.utsendelse && (
          <Link href={`/admin/utsendelser/${summary.utsendelse.id}`} className="text-bjerke-blue hover:underline">Se utkastet</Link>
        )}
      </p>
    </div>
  );
}

/** «Riktig kontaktperson er …»: én knapp for å legge personen inn i CRM i samme bedrift. */
function NewContactBox({ reply: r, onChanged }: { reply: ReplyItem; onChanged: () => void }) {
  const { toast } = useToast();
  const suggestion = r.newContact!;
  const nameId = useId();
  const emailId = useId();
  const [name, setName] = useState(suggestion.name);
  const [email, setEmail] = useState(suggestion.email ?? '');
  const [busy, setBusy] = useState(false);

  if (suggestion.contactId != null) {
    return (
      <p className="mt-3 text-sm text-gray-700">
        Ny kontaktperson lagt til i CRM:{' '}
        <Link href={`/admin/crm/kontakter/${suggestion.contactId}`} className="text-bjerke-blue hover:underline">{suggestion.name}</Link>
      </p>
    );
  }

  async function add() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/svar/${r.id}/ny-kontakt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error ?? 'Noe gikk galt. Prøv igjen.', 'error');
        return;
      }
      toast(data.existed ? `${name} fantes allerede i CRM.` : `${name} er lagt til i CRM.`, 'success');
      onChanged();
    } catch {
      toast('Fikk ikke kontakt. Sjekk nettet og prøv igjen.', 'error');
    } finally {
      setBusy(false);
    }
  }

  const inputCls = 'mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-bjerke-blue focus:ring-2 focus:ring-bjerke-blue/20';
  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-sm text-amber-950">
        <strong>Ny kontaktperson?</strong> Svaret sier at {suggestion.name} er riktig person{r.organization ? ` i ${r.organization}` : ''}.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor={nameId} className="text-xs font-medium text-gray-700">Navn</label>
          <input id={nameId} className={inputCls} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor={emailId} className="text-xs font-medium text-gray-700">E-post (hvis du vet den)</label>
          <input id={emailId} type="email" className={inputCls} value={email} maxLength={254} placeholder="navn@bedrift.no" onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>
      <div className="mt-2">
        <Button size="sm" loading={busy} disabled={!name.trim()} onClick={() => void add()}>Legg til i CRM</Button>
      </div>
    </div>
  );
}

const LONG = 700;

function ReplyCard({ reply: r, nextYearName, thanks, showContact, showUtsendelse, onChanged }: { reply: ReplyItem; nextYearName: string; thanks: ThanksInfo; showContact: boolean; showUtsendelse: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const textId = useId();
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(r.bodyText.length <= LONG);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const firstName = (r.fromName ?? r.contactName).split(/\s+/)[0] || r.fromEmail;
  const canThank = thanks.mode !== 'off' && r.thanksFits;
  const thanksText = renderThanks(thanks.text, greetingName(r.fromName, r.contactName));

  useEffect(() => {
    if (writing) areaRef.current?.focus();
  }, [writing]);

  async function call(method: 'POST' | 'PATCH' | 'DELETE', body: unknown, success: string, path = ''): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/svar/${r.id}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
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

      {r.ai && (
        <p className="mt-2 text-xs text-gray-500">
          <span className="font-medium text-gray-700">Claude: {r.ai.label}</span>
          {r.ai.reason ? ` · ${r.ai.reason}` : ''}
          {canThank ? ' · En kort takk passer' : ''}
        </p>
      )}

      {r.newContact && <NewContactBox reply={r} onChanged={onChanged} />}

      {r.answer && (
        <div className="mt-3 border-l-2 border-bjerke-blue/40 pl-4">
          <p className="text-xs text-gray-500">Svar fra {r.answer.from || 'oss'} · {when(r.answer.sentAt)}</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-gray-800">{r.answer.text}</p>
        </div>
      )}
      {!r.answer && r.status !== 'open' && r.handledBy && !r.saved && (
        <p className="mt-2 text-xs text-gray-500">
          {r.status === 'answered' ? 'Merket som besvart' : 'Merket «trenger ikke svar»'} av {r.handledBy}
        </p>
      )}
      {r.saved && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 text-sm text-blue-900">
          <span>Spart til {r.saved.navn}{r.saved.by ? ` av ${r.saved.by}` : ''}. Du får en påminnelse i august.</span>
          <Button variant="link" disabled={busy} onClick={() => void call('DELETE', undefined, `Fjernet fra ${r.saved!.navn}.`, '/neste-aar')}>Angre</Button>
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
          {canThank && (
            <Button
              disabled={busy}
              title={`Sender: ${thanksText}`}
              onClick={() => void call('POST', undefined, `Takk sendt til ${firstName}.`, '/takk')}
            >
              Send takk
            </Button>
          )}
          {r.status === 'open' && (
            <>
              <Button variant={canThank ? 'secondary' : 'primary'} onClick={() => setWriting(true)}>Svar</Button>
              <Button variant="secondary" disabled={busy} onClick={() => void call('PATCH', { status: 'no_reply' }, 'Merket «trenger ikke svar».')}>Trenger ikke svar</Button>
            </>
          )}
          {!r.saved && (
            <Button variant="secondary" disabled={busy} onClick={() => void call('POST', undefined, `Spart til ${nextYearName}. Du får en påminnelse i august.`, '/neste-aar')}>
              Spar til {nextYearName}
            </Button>
          )}
          {r.status === 'open' && (
            <Button variant="link" disabled={busy} onClick={() => void call('PATCH', { status: 'answered' }, 'Merket som besvart.')}>Har svart i Outlook</Button>
          )}
          {r.status !== 'open' && !r.answer && (
            <>
              <Button variant="link" disabled={busy} onClick={() => setWriting(true)}>Svar likevel</Button>
              {!r.saved && (
                <Button variant="link" disabled={busy} onClick={() => void call('PATCH', { status: 'open' }, 'Flyttet tilbake til «Må svares».')}>Angre</Button>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}
