'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/admin/Button';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { useToast } from '@/components/admin/Toast';
import { EmailBodyEditor } from '@/app/admin/crm/flyter/[id]/email-body-editor';
import type { RecipientDetail, RecipientRow, RecipientStatus } from '@/lib/utsendelser/one-by-one';
import { formatCount } from '../../status';
import { useUtsendelseAction } from '../use-action';
import { people, sendResultMessage, StepTabs, type SendFlow, type SendGroup } from './send-view';

interface Props {
  utsendelseId: string;
  group: SendGroup;
  otherGroups: { id: string; navn: string }[];
  flow: SendFlow;
  paused: boolean;
  rows: RecipientRow[];
  myEmail: string;
  onBack: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

type Filter = 'ikke' | 'alle' | 'sendt' | 'ut';
type Draft = { subject: string; bodyHtml: string };

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'ikke', label: 'Ikke sendt' },
  { id: 'alle', label: 'Alle' },
  { id: 'sendt', label: 'Sendt' },
  { id: 'ut', label: 'Tatt ut' },
];

const STATUS_PILL: Record<RecipientStatus, { label: string; cls: string } | null> = {
  ikke: null,
  sendt: { label: 'Sendt', cls: 'bg-green-100 text-green-800' },
  ut: { label: 'Tatt ut', cls: 'bg-gray-200 text-gray-700' },
  'kan-ikke': { label: 'Kan ikke få e-post', cls: 'bg-gray-100 text-gray-600' },
};

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', timeZone: 'Europe/Oslo' });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Oslo' });

const JOURNEY_NOTE: Partial<Record<RecipientDetail['journey']['state'], (at: string | null) => string>> = {
  svarte: (at) => `Svarte${at ? ` ${dateLabel(at)}` : ''} og får ikke flere e-poster.`,
  'meldt-av': () => 'Har meldt seg av og får ikke flere e-poster.',
  stoppet: (at) => `E-postene ble stoppet${at ? ` ${dateLabel(at)}` : ''}.`,
  ferdig: () => 'Har fått alle e-postene.',
  feilet: () => 'Sendingen feilet. Sjekk at e-postadressen er riktig.',
};

/** Hele løpet for personen: hva som er sendt, åpnet og besvart, og når resten kommer. */
function Journey({ detail }: { detail: RecipientDetail }) {
  const { state, at } = detail.journey;
  const note = JOURNEY_NOTE[state]?.(at);
  return (
    <div className="flex flex-wrap items-start gap-3 px-5 py-2.5">
      <dt className="w-12 shrink-0 pt-1 text-gray-500">Løpet</dt>
      <dd className="min-w-0 flex-1">
        <ol className="flex flex-wrap gap-1.5">
          {detail.emails.map((e) => {
            const label = e.sentAt
              ? `sendt ${dateLabel(e.sentAt)}${e.repliedAt ? ', svarte' : e.openedAt ? ', åpnet' : ''}`
              : e.expectedAt
                ? `kommer ca. ${dayLabel(e.expectedAt)}`
                : state === 'ikke-startet'
                  ? e.timing.toLowerCase()
                  : 'sendes ikke';
            const cls = e.sentAt
              ? 'bg-green-50 text-green-900 ring-green-200'
              : e.expectedAt || state === 'ikke-startet'
                ? 'bg-white text-gray-800 ring-gray-200'
                : 'bg-gray-50 text-gray-500 ring-gray-200 line-through';
            return (
              <li key={e.nodeId} className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ${cls}`}>
                {e.sentAt && <span aria-hidden="true">✓ </span>}
                <span className="font-medium">E-post {e.number}</span> · {label}
              </li>
            );
          })}
        </ol>
        {note && <p className="mt-1.5 text-xs text-gray-600">{note}</p>}
      </dd>
    </div>
  );
}

function matchesFilter(row: RecipientRow, filter: Filter) {
  if (filter === 'alle') return true;
  if (filter === 'ikke') return row.status === 'ikke';
  return row.status === filter;
}

export function OneByOne({ utsendelseId, group, otherGroups, flow, paused, rows: initialRows, myEmail, onBack, onDirtyChange }: Props) {
  const { toast } = useToast();
  const { run, busy } = useUtsendelseAction(utsendelseId);
  const [rows, setRows] = useState(initialRows);
  const [filter, setFilter] = useState<Filter>(() => (initialRows.some((r) => r.status === 'ikke') ? 'ikke' : 'alle'));
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(() => (initialRows.find((r) => r.status === 'ikke') ?? initialRows[0])?.id ?? null);
  const [detail, setDetail] = useState<RecipientDetail | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saved, setSaved] = useState<Record<number, Draft>>({});
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [active, setActive] = useState(0);
  const [moveFor, setMoveFor] = useState<number | null>(null);
  const [confirmStop, setConfirmStop] = useState<RecipientRow | null>(null);
  const [confirmRest, setConfirmRest] = useState(false);
  const [adding, setAdding] = useState(false);
  const [testing, setTesting] = useState(false);
  const requestId = useRef(0);

  // Nye rader fra serveren (etter oppdatering) erstatter de lokale.
  const [serverRows, setServerRows] = useState(initialRows);
  if (serverRows !== initialRows) {
    setServerRows(initialRows);
    setRows(initialRows);
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => matchesFilter(r, filter) && (!q || `${r.name} ${r.org ?? ''} ${r.email ?? ''}`.toLowerCase().includes(q)));
  }, [rows, filter, query]);

  const counts = useMemo(() => ({
    sent: rows.filter((r) => r.status === 'sendt').length,
    out: rows.filter((r) => r.status === 'ut').length,
    left: rows.filter((r) => r.status === 'ikke').length,
  }), [rows]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  /** Henter e-postene til én person. Bare det siste svaret brukes, så rask klikking ikke blander personer. */
  const fetchDetail = useCallback(async (contactId: number) => {
    const res = await fetch(`/api/admin/utsendelser/${utsendelseId}/mottaker?gruppe=${encodeURIComponent(group.id)}&kontakt=${contactId}`);
    if (!res.ok) throw new Error();
    return (await res.json()) as RecipientDetail;
  }, [utsendelseId, group.id]);

  const load = useCallback((contactId: number) => {
    const id = ++requestId.current;
    fetchDetail(contactId)
      .then((data) => {
        if (id !== requestId.current) return;
        const base = Object.fromEntries(data.emails.map((e) => [e.nodeId, { subject: e.subject, bodyHtml: e.bodyHtml }]));
        setLoadError(false);
        setDetail(data);
        setSaved(base);
        setDrafts(base);
      })
      .catch(() => {
        if (id === requestId.current) setLoadError(true);
      });
  }, [fetchDetail]);

  const [firstId] = useState(selectedId);
  useEffect(() => {
    if (firstId !== null) load(firstId);
  }, [firstId, load]);

  function open(id: number) {
    setSelectedId(id);
    setDetail(null);
    setLoadError(false);
    setActive(0);
    load(id);
  }

  const isDirty = (nodeId: number) =>
    !!drafts[nodeId] && (drafts[nodeId].subject !== saved[nodeId]?.subject || drafts[nodeId].bodyHtml !== saved[nodeId]?.bodyHtml);
  const anyDirty = !!detail?.emails.some((e) => !e.sentAt && isDirty(e.nodeId));
  useEffect(() => onDirtyChange(anyDirty), [anyDirty, onDirtyChange]);

  /** Lagrer egen tekst for e-postene som er endret. Kalles før alt som flytter bort fra personen. */
  async function flush(): Promise<boolean> {
    if (!detail) return true;
    for (const email of detail.emails) {
      if (email.sentAt || !isDirty(email.nodeId)) continue;
      const ok = await run('PUT', '/mottaker/epost', { contactId: detail.id, nodeId: email.nodeId, ...drafts[email.nodeId] }, `Egen tekst lagret for ${detail.name}.`, { refresh: false });
      if (!ok) return false;
      setSaved((s) => ({ ...s, [email.nodeId]: drafts[email.nodeId] }));
      setDetail((d) => d && { ...d, emails: d.emails.map((e) => (e.nodeId === email.nodeId ? { ...e, edited: true } : e)) });
      setRows((rs) => rs.map((r) => (r.id === detail.id ? { ...r, edited: true } : r)));
    }
    return true;
  }

  function updateRow(id: number, patch: Partial<RecipientRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  /** Neste person som ikke er sendt til, etter den valgte i listen. */
  function goNextOpen(fromId: number) {
    const index = rows.findIndex((r) => r.id === fromId);
    const next = rows.slice(index + 1).find((r) => r.status === 'ikke' && r.id !== fromId) ?? rows.find((r) => r.status === 'ikke' && r.id !== fromId);
    if (next) open(next.id);
    else load(fromId);
  }

  async function select(id: number) {
    if (id === selectedId || !(await flush())) return;
    open(id);
  }

  async function step(delta: number) {
    const index = visible.findIndex((r) => r.id === selectedId);
    const target = visible[index + delta];
    if (target) await select(target.id);
  }

  async function sendToSelected() {
    if (!selected || !(await flush())) return;
    const ok = await run('POST', '/send-en', { gruppeId: group.id, contactId: selected.id }, `Sendt til ${selected.name}.`, { refresh: false });
    if (!ok) return;
    updateRow(selected.id, { status: 'sendt' });
    goNextOpen(selected.id);
  }

  async function exclude(row: RecipientRow) {
    const ok = await run('PATCH', '/mottaker', { action: 'exclude', contactId: row.id }, `${row.name} får ikke ${row.status === 'sendt' ? 'flere ' : ''}e-poster.`, { refresh: false });
    if (!ok) return;
    setConfirmStop(null);
    updateRow(row.id, { status: 'ut' });
    if (row.id === selectedId) goNextOpen(row.id);
  }

  async function include(row: RecipientRow) {
    const ok = await run('PATCH', '/mottaker', { action: 'include', contactId: row.id }, `${row.name} er med igjen.`);
    if (ok) updateRow(row.id, { status: 'ikke' });
  }

  async function move(row: RecipientRow, gruppeId: string) {
    const target = otherGroups.find((g) => g.id === gruppeId);
    if (!target) return;
    const ok = await run('PATCH', '/mottaker', { action: 'move', contactId: row.id, gruppeId }, `${row.name} er flyttet til ${target.navn}.`, { refresh: false });
    setMoveFor(null);
    if (!ok) return;
    if (row.id === selectedId) goNextOpen(row.id);
    setRows((rs) => rs.filter((r) => r.id !== row.id));
  }

  async function resetEmail(nodeId: number) {
    if (!detail) return;
    const ok = await run('DELETE', '/mottaker/epost', { contactId: detail.id, nodeId }, 'Personen får fellesteksten igjen.', { refresh: false });
    if (!ok) return;
    const stillEdited = detail.emails.some((e) => e.nodeId !== nodeId && e.edited);
    updateRow(detail.id, { edited: stillEdited });
    // Bare denne e-posten byttes; ulagrede endringer i de andre beholdes.
    const fresh = (await fetchDetail(detail.id).catch(() => null))?.emails.find((e) => e.nodeId === nodeId);
    if (!fresh) return load(detail.id);
    const text = { subject: fresh.subject, bodyHtml: fresh.bodyHtml };
    setDetail((d) => d && { ...d, emails: d.emails.map((e) => (e.nodeId === nodeId ? fresh : e)) });
    setSaved((sv) => ({ ...sv, [nodeId]: text }));
    setDrafts((dr) => ({ ...dr, [nodeId]: text }));
  }

  async function sendRest() {
    if (!(await flush())) return;
    const data = await run('POST', '/send', { gruppeId: group.id }, (d) => sendResultMessage(d as never));
    setConfirmRest(false);
    if (data) setRows((rs) => rs.map((r) => (r.status === 'ikke' ? { ...r, status: 'sendt' } : r)));
  }

  async function sendTest(nodeId: number) {
    if (!detail || !myEmail || !(await flush())) return;
    setTesting(true);
    try {
      const res = await fetch(`/api/admin/crm/flows/${flow.flowId}/test-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, toEmail: myEmail, contactId: detail.id }),
      });
      const data = await res.json().catch(() => ({}));
      toast(res.ok ? `Test sendt til ${myEmail}, slik ${detail.name} får den.` : data.error ?? 'Kunne ikke sende test.', res.ok ? 'success' : 'error');
    } finally {
      setTesting(false);
    }
  }

  const email = detail?.emails[active];
  const canSendNow = !paused && flow.status !== 'archived';

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={async () => { if (await flush()) onBack(); }} className="text-sm text-bjerke-blue hover:underline">← Tilbake til e-posten</button>
        <h1 className="text-xl font-bold text-gray-900">{group.navn}: én og én</h1>
        <span className="rounded-full bg-gray-100 px-3 py-0.5 text-sm text-gray-700 tabular-nums">
          {formatCount(counts.sent)} sendt · {formatCount(counts.out)} tatt ut · {formatCount(counts.left)} igjen
        </span>
        {counts.left > 0 && canSendNow && (
          <Button className="ml-auto" variant="secondary" onClick={() => setConfirmRest(true)}>
            Send til resten ({formatCount(counts.left)})
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <section aria-label="Mottakere" className="flex max-h-[78vh] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 p-3">
            <label htmlFor="mottaker-sok" className="sr-only">Søk etter mottaker</label>
            <input
              id="mottaker-sok"
              type="search"
              placeholder="Søk etter navn eller firma"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            />
            <div className="mt-2 flex flex-wrap gap-1 text-xs" role="group" aria-label="Vis">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={`rounded-full px-2.5 py-1 ${filter === f.id ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <ul className="flex-1 divide-y divide-gray-100 overflow-y-auto text-sm">
            {visible.length === 0 && <li className="px-4 py-8 text-center text-gray-500">Ingen her.</li>}
            {visible.map((row) => {
              const isSelected = row.id === selectedId;
              const pill = STATUS_PILL[row.status];
              return (
                <li key={row.id} className={`group relative ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                  <button type="button" onClick={() => select(row.id)} aria-current={isSelected} className="block w-full px-4 py-2.5 pr-20 text-left">
                    <span className="block truncate font-medium text-gray-900">{row.name}</span>
                    <span className="block truncate text-xs text-gray-500">{row.org ?? row.email}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {pill && <span className={`rounded-full px-2 py-0.5 text-[11px] ${pill.cls}`}>{pill.label}</span>}
                      {row.edited && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-900">Egen tekst</span>}
                      {row.movedIn && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] text-blue-900">Flyttet hit</span>}
                    </span>
                  </button>
                  <RowActions
                    row={row}
                    visible={isSelected || moveFor === row.id}
                    canMove={row.status === 'ikke' && otherGroups.length > 0}
                    busy={busy}
                    onMove={() => setMoveFor(moveFor === row.id ? null : row.id)}
                    onExclude={() => (row.status === 'sendt' ? setConfirmStop(row) : exclude(row))}
                    onInclude={() => include(row)}
                  />
                  {moveFor === row.id && (
                    <div className="border-t border-gray-100 bg-white px-4 py-2">
                      <label htmlFor={`flytt-${row.id}`} className="mb-1 block text-xs font-medium text-gray-600">Flytt {row.name} til</label>
                      <select
                        id={`flytt-${row.id}`}
                        autoFocus
                        defaultValue=""
                        disabled={busy}
                        onChange={(e) => e.target.value && move(row, e.target.value)}
                        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                      >
                        <option value="">Velg gruppe …</option>
                        {otherGroups.map((g) => <option key={g.id} value={g.id}>{g.navn}</option>)}
                      </select>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <button type="button" onClick={() => setAdding(true)} className="border-t border-gray-100 px-4 py-3 text-left text-sm font-medium text-bjerke-blue hover:bg-gray-50">
            + Legg til en person
          </button>
        </section>

        <article className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" aria-live="polite">
          {!selected ? (
            <p className="px-5 py-10 text-center text-gray-600">Velg en person i listen.</p>
          ) : loadError ? (
            <div className="px-5 py-10 text-center text-gray-700">
              <p>Kunne ikke hente e-postene til {selected.name}.</p>
              <Button className="mt-3" variant="secondary" onClick={() => open(selected.id)}>Prøv igjen</Button>
            </div>
          ) : !detail || !email ? (
            <p className="px-5 py-10 text-center text-gray-500">Henter e-postene …</p>
          ) : (
            <>
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-5 py-3">
                <StepTabs steps={detail.emails} active={active} onSelect={setActive} marked={(e) => e.edited || isDirty(e.nodeId)} />
                <span className="text-sm text-gray-500">
                  {email.sentAt ? `Sendt ${dateLabel(email.sentAt)}` : email.expectedAt ? `Kommer ca. ${dayLabel(email.expectedAt)}` : email.timing}
                </span>
              </header>
              <dl className="divide-y divide-gray-100 text-sm">
                <div className="flex items-center gap-3 px-5 py-2.5">
                  <dt className="w-12 text-gray-500">Fra</dt>
                  <dd>{flow.senderName ?? 'Mangler avsender'}</dd>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
                  <dt className="w-12 text-gray-500">Til</dt>
                  <dd className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium text-gray-900">{detail.name}{detail.email ? ` <${detail.email}>` : ''}</span>
                    {(detail.roleTitle || detail.org) && <span className="text-gray-500">{[detail.roleTitle, detail.org].filter(Boolean).join(', ')}</span>}
                  </dd>
                </div>
                <Journey detail={detail} />
              </dl>

              <div className="border-t border-gray-200 px-5 py-5">
                {email.sentAt ? (
                  <>
                    <p className="text-sm text-gray-600">Emne</p>
                    <p className="font-medium text-gray-900">{email.subject}</p>
                    <div
                      className="prose prose-sm prose-a:text-bjerke-blue mt-3 max-w-none text-gray-700"
                      // Sanert i renderFlowEmailBody (DOMPurify).
                      dangerouslySetInnerHTML={{ __html: email.bodyHtml }}
                    />
                  </>
                ) : (
                  <EmailBodyEditor
                    key={`${detail.id}-${email.nodeId}`}
                    subject={drafts[email.nodeId]?.subject ?? ''}
                    bodyHtml={drafts[email.nodeId]?.bodyHtml ?? ''}
                    anchorMode="contact"
                    disabled={busy}
                    onChange={(patch) => setDrafts((d) => ({ ...d, [email.nodeId]: { ...d[email.nodeId], ...patch } }))}
                  />
                )}
              </div>

              <p className={`border-t px-5 py-2 text-xs ${email.edited ? 'border-amber-100 bg-amber-50 text-amber-900' : 'border-gray-100 text-gray-500'}`}>
                {email.sentAt
                  ? 'Denne e-posten er sendt og kan ikke endres.'
                  : email.edited
                    ? <>Egen tekst for {detail.name}. <button type="button" className="font-semibold underline" disabled={busy} onClick={() => resetEmail(email.nodeId)}>Bruk fellesteksten igjen</button></>
                    : `Skriv rett i teksten. Endringen gjelder bare ${detail.name}.`}
              </p>

              <footer className="flex flex-wrap items-center gap-3 border-t border-gray-200 bg-gray-50 px-5 py-4">
                {selected.status === 'ikke' && (
                  <>
                    {canSendNow && <Button loading={busy} onClick={sendToSelected}>Send til {detail.name.split(' ')[0]} →</Button>}
                    <Button variant="secondary" disabled={busy} onClick={async () => { if (await flush()) goNextOpen(selected.id); }}>Hopp over</Button>
                  </>
                )}
                {selected.status === 'sendt' && (
                  <>
                    <span className="text-sm text-gray-600">E-post 1 er sendt. De neste kommer av seg selv.</span>
                    {detail.emails.some((e) => !e.sentAt && isDirty(e.nodeId)) && <Button loading={busy} onClick={flush}>Lagre endringen</Button>}
                  </>
                )}
                {selected.status === 'ut' && <span className="text-sm text-gray-600">Tatt ut av utsendelsen.</span>}
                {selected.status === 'kan-ikke' && <span className="text-sm text-gray-600">Har meldt seg av eller mangler adresse, så personen kan ikke få e-post.</span>}
                {myEmail && !email.sentAt && (
                  <Button variant="secondary" size="sm" loading={testing} onClick={() => sendTest(email.nodeId)}>Send test til meg</Button>
                )}
                <span className="ml-auto flex gap-2">
                  <Button variant="secondary" size="sm" disabled={busy || visible[0]?.id === selectedId} onClick={() => step(-1)}>← Forrige</Button>
                  <Button variant="secondary" size="sm" disabled={busy || visible[visible.length - 1]?.id === selectedId} onClick={() => step(1)}>Neste →</Button>
                </span>
              </footer>
            </>
          )}
        </article>
      </div>

      {adding && (
        <AddPerson
          groupNavn={group.navn}
          existing={new Set(rows.map((r) => r.id))}
          busy={busy}
          onCancel={() => setAdding(false)}
          onAdd={async (contact) => {
            if (!(await flush())) return;
            const ok = await run('PATCH', '/mottaker', { action: 'move', contactId: contact.id, gruppeId: group.id }, `${contact.name} er lagt til i ${group.navn}.`);
            if (!ok) return;
            setAdding(false);
            setFilter('alle');
            setRows((rs) => [...rs, { id: contact.id, name: contact.name, email: contact.email, org: contact.org, status: 'ikke', edited: false, movedIn: true }]);
            open(contact.id);
          }}
        />
      )}

      <ConfirmModal
        open={confirmStop !== null}
        title={confirmStop ? `Stoppe e-postene til ${confirmStop.name}?` : ''}
        message="Personen har allerede fått e-post 1. Resten av e-postene blir ikke sendt. Dette kan ikke angres."
        confirmLabel="Stopp e-postene"
        loading={busy}
        onConfirm={() => confirmStop && exclude(confirmStop)}
        onCancel={() => setConfirmStop(null)}
      />
      <ConfirmModal
        open={confirmRest}
        variant="info"
        title={`Sende til de ${people(counts.left)} som er igjen?`}
        message={`Alle i «${group.navn}» som ikke har fått e-posten og ikke er tatt ut, får den nå${flow.sendWindow ? ` (${flow.sendWindow})` : ''}. Egne tekster blir brukt.`}
        confirmLabel="Send"
        loading={busy}
        onConfirm={sendRest}
        onCancel={() => setConfirmRest(false)}
      />
    </div>
  );
}

function RowActions({
  row,
  visible,
  canMove,
  busy,
  onMove,
  onExclude,
  onInclude,
}: {
  row: RecipientRow;
  visible: boolean;
  canMove: boolean;
  busy: boolean;
  onMove: () => void;
  onExclude: () => void;
  onInclude: () => void;
}) {
  const base = 'rounded-md p-1.5 text-gray-500 hover:bg-white hover:text-gray-900 focus-visible:opacity-100 disabled:opacity-40';
  return (
    <div className={`absolute right-2 top-2.5 flex gap-0.5 transition-opacity ${visible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}>
      {canMove && (
        <button type="button" className={base} disabled={busy} onClick={onMove} aria-label={`Flytt ${row.name} til en annen gruppe`} title="Flytt til en annen gruppe">
          <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </button>
      )}
      {row.status === 'ut' ? (
        <button type="button" className={base} disabled={busy} onClick={onInclude} aria-label={`Ta med ${row.name} igjen`} title="Ta med igjen">
          <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          className={`${base} hover:text-red-700`}
          disabled={busy}
          onClick={onExclude}
          aria-label={row.status === 'sendt' ? `Stopp e-postene til ${row.name}` : `Ikke send til ${row.name}`}
          title={row.status === 'sendt' ? 'Stopp resten av e-postene' : 'Ikke send til denne'}
        >
          <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      )}
    </div>
  );
}

interface FoundContact {
  id: number;
  name: string;
  email: string | null;
  org: string | null;
}

function AddPerson({
  groupNavn,
  existing,
  busy,
  onCancel,
  onAdd,
}: {
  groupNavn: string;
  existing: Set<number>;
  busy: boolean;
  onCancel: () => void;
  onAdd: (c: FoundContact) => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<FoundContact[] | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/crm/contacts?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        const data = await res.json();
        const list: { id: number; name: string; email: string | null; organization?: { name: string } | null }[] = data.contacts ?? [];
        setResults(list.slice(0, 8).map((c) => ({ id: c.id, name: c.name, email: c.email, org: c.organization?.name ?? null })));
      } catch {
        if (!controller.signal.aborted) setResults([]);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [q]);

  const shown = q.trim().length >= 2 ? results : null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24" role="dialog" aria-modal="true" aria-labelledby="legg-til-tittel">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h2 id="legg-til-tittel" className="text-lg font-semibold text-gray-900">Legg til i {groupNavn}</h2>
        <p className="mt-1 text-sm text-gray-600">Søk opp en kontakt i CRM. Finnes ikke personen, legg den inn under CRM → Kontakter først.</p>
        <input
          autoFocus
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Navn eller e-post"
          aria-label="Søk etter kontakt"
          className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <ul className="mt-2 max-h-72 divide-y divide-gray-100 overflow-y-auto text-sm">
          {shown?.length === 0 && <li className="py-4 text-center text-gray-500">Fant ingen.</li>}
          {shown?.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate font-medium text-gray-900">{c.name}</span>
                <span className="block truncate text-xs text-gray-500">{[c.org, c.email].filter(Boolean).join(' · ')}</span>
              </span>
              {existing.has(c.id) ? (
                <span className="shrink-0 text-xs text-gray-500">Er med</span>
              ) : (
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => onAdd(c)}>Legg til</Button>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={onCancel}>Lukk</Button>
        </div>
      </div>
    </div>
  );
}
