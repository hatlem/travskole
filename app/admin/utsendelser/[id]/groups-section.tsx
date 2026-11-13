'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/admin/Button';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import type { GroupView } from '@/lib/utsendelser/overview';
import { formatCount } from '../status';
import { useUtsendelseAction } from './use-action';

export type SerializedGroup = Omit<GroupView, 'firstSentAt' | 'lastSentAt'> & { firstSentAt: string | null; lastSentAt: string | null };

export interface SourceOption {
  id: number;
  name: string;
}

interface Props {
  utsendelseId: string;
  groups: SerializedGroup[];
  flows: { flowId: number; navn: string }[];
  lists: SourceOption[];
  segments: SourceOption[];
  paused: boolean;
  sendWindow: string;
}

interface SendResult {
  sent: number;
  skippedSuppressed: number;
  skippedNoConsent: number;
  skippedMissing: number;
}

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('nb-NO', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' });

function sendMessage(r: SendResult): string {
  const skipped = r.skippedSuppressed + r.skippedNoConsent + r.skippedMissing;
  const base = r.sent === 0 ? 'Ingen nye å sende til.' : `Sendt til ${formatCount(r.sent)}. E-post 1 går ut innenfor sendetiden.`;
  return skipped > 0 ? `${base} ${formatCount(skipped)} hoppet over (meldt av eller mangler adresse).` : base;
}

const inputCls = 'w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm';
const labelCls = 'mb-1 block text-xs font-medium text-gray-600';

export function GroupsSection({ utsendelseId, groups, flows, lists, segments, paused, sendWindow }: Props) {
  const { run, busy } = useUtsendelseAction(utsendelseId);
  const [confirmSend, setConfirmSend] = useState<SerializedGroup | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<SerializedGroup | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; navn: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [newGroup, setNewGroup] = useState({ navn: '', kilde: '', flowId: flows[0]?.flowId ?? 0 });

  async function confirmAndSend() {
    if (!confirmSend) return;
    const ok = await run('POST', '/send', { gruppeId: confirmSend.id }, (data) => sendMessage(data as unknown as SendResult));
    if (ok) setConfirmSend(null);
  }

  async function addGroup() {
    const [type, id] = newGroup.kilde.split(':');
    const body = {
      navn: newGroup.navn,
      ...(type === 'liste' ? { listId: Number(id) } : { segmentId: Number(id) }),
      ...(flows.length > 1 && { flowId: newGroup.flowId }),
    };
    if (await run('POST', '/grupper', body, 'Gruppen er lagt til.')) {
      setAdding(false);
      setNewGroup({ navn: '', kilde: '', flowId: flows[0]?.flowId ?? 0 });
    }
  }

  function pickSource(value: string) {
    const [type, id] = value.split(':');
    const name = (type === 'liste' ? lists : segments).find((o) => o.id === Number(id))?.name ?? '';
    setNewGroup((g) => ({ ...g, kilde: value, navn: g.navn || name }));
  }

  return (
    <section aria-labelledby="send-title" className="mb-12">
      <h2 id="send-title" className="text-lg font-semibold text-gray-900">Mottakere og sending</h2>
      <p className="mt-1 mb-4 text-sm text-gray-600">
        Trykk «Send nå» på gruppen som skal få e-post 1. Resten av e-postene kommer automatisk. Ingen får samme e-post to ganger.
      </p>

      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white px-5 py-6 text-center text-sm text-gray-600">
          Ingen mottakere ennå. Legg til en liste eller et segment under.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {groups.map((g) => {
            const people = g.sent + g.remaining;
            const sendable = !paused && (g.flowStatus === 'draft' || g.flowStatus === 'active');
            return (
              <li key={g.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  {renaming?.id === g.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor={`rename-${g.id}`} className="sr-only">Nytt navn</label>
                      <input
                        id={`rename-${g.id}`}
                        className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                        value={renaming.navn}
                        maxLength={120}
                        onChange={(e) => setRenaming({ id: g.id, navn: e.target.value })}
                      />
                      <Button
                        size="sm"
                        loading={busy}
                        disabled={!renaming.navn.trim()}
                        onClick={async () => {
                          if (await run('PATCH', '/grupper', { gruppeId: g.id, navn: renaming.navn }, 'Navnet er endret.')) setRenaming(null);
                        }}
                      >
                        Lagre
                      </Button>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRenaming(null)}>Avbryt</Button>
                    </div>
                  ) : (
                    <p className="font-medium text-gray-900">{g.navn}</p>
                  )}
                  <p className="mt-0.5 text-sm text-gray-600">
                    {formatCount(people)} {people === 1 ? 'person' : 'personer'}
                    {g.beskrivelse ? ` · ${g.beskrivelse}` : ''}
                    {flows.length > 1 && g.flowNavn ? ` · ${g.flowNavn.toLowerCase()}` : ''}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {g.kilde}
                    {!g.missingSegment && (
                      <>
                        {' · '}
                        <Link href={g.peopleHref} className="font-medium text-blue-700 underline-offset-2 hover:underline">
                          Se hvem som er med
                        </Link>
                      </>
                    )}
                  </p>
                  {g.unreachable > 0 && (
                    <p className="mt-0.5 text-xs text-gray-500">
                      {formatCount(g.unreachable)} til kan ikke få e-post (har meldt seg av eller mangler adresse).
                    </p>
                  )}
                  {g.missingSegment && <p className="mt-0.5 text-sm text-red-700">Lista eller segmentet finnes ikke lenger.</p>}
                  {renaming?.id !== g.id && (
                    <div className="mt-1 flex gap-3 text-xs">
                      <button type="button" className="text-bjerke-blue hover:underline" onClick={() => setRenaming({ id: g.id, navn: g.navn })}>
                        Gi nytt navn
                      </button>
                      <button type="button" className="text-red-700 hover:underline" onClick={() => setConfirmRemove(g)}>
                        Fjern gruppen
                      </button>
                    </div>
                  )}
                </div>
                <div className="shrink-0 sm:text-right">
                  {g.sent > 0 && g.lastSentAt && (
                    <p className="text-sm text-green-800">
                      <span aria-hidden="true">✓ </span>Sendt til {formatCount(g.sent)} · {dateTime(g.lastSentAt)}
                    </p>
                  )}
                  {g.remaining > 0 ? (
                    <Button className="mt-1" variant={g.sent > 0 ? 'secondary' : 'primary'} disabled={!sendable} onClick={() => setConfirmSend(g)}>
                      {g.sent > 0 ? `Send til ${formatCount(g.remaining)} nye` : 'Send nå'}
                    </Button>
                  ) : (
                    g.sent === 0 && !g.missingSegment && <p className="text-sm text-gray-500">Ingen å sende til</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {adding ? (
        <div className="mt-4 space-y-3 rounded-xl border border-gray-200 bg-white px-5 py-4">
          <div>
            <label htmlFor="ny-kilde" className={labelCls}>Hvem skal få e-postene?</label>
            <select id="ny-kilde" className={inputCls} value={newGroup.kilde} onChange={(e) => pickSource(e.target.value)}>
              <option value="">Velg en liste eller et segment …</option>
              {lists.length > 0 && (
                <optgroup label="Lister">
                  {lists.map((l) => <option key={`l${l.id}`} value={`liste:${l.id}`}>{l.name}</option>)}
                </optgroup>
              )}
              {segments.length > 0 && (
                <optgroup label="Segmenter">
                  {segments.map((s) => <option key={`s${s.id}`} value={`segment:${s.id}`}>{s.name}</option>)}
                </optgroup>
              )}
            </select>
          </div>
          <div>
            <label htmlFor="ny-navn" className={labelCls}>Navn på gruppen</label>
            <input id="ny-navn" className={inputCls} value={newGroup.navn} maxLength={120} onChange={(e) => setNewGroup((g) => ({ ...g, navn: e.target.value }))} />
          </div>
          {flows.length > 1 && (
            <div>
              <label htmlFor="ny-flyt" className={labelCls}>Hvilke e-poster skal de få?</label>
              <select id="ny-flyt" className={inputCls} value={newGroup.flowId} onChange={(e) => setNewGroup((g) => ({ ...g, flowId: Number(e.target.value) }))}>
                {flows.map((f) => <option key={f.flowId} value={f.flowId}>{f.navn}</option>)}
              </select>
            </div>
          )}
          <div className="flex gap-3">
            <Button loading={busy} disabled={!newGroup.kilde || !newGroup.navn.trim()} onClick={addGroup}>Legg til</Button>
            <Button variant="secondary" disabled={busy} onClick={() => setAdding(false)}>Avbryt</Button>
          </div>
        </div>
      ) : (
        <Button className="mt-4" variant="secondary" onClick={() => setAdding(true)}>+ Legg til mottakere</Button>
      )}

      <ConfirmModal
        open={confirmSend !== null}
        variant="info"
        title={confirmSend ? `Sende til «${confirmSend.navn}»?` : ''}
        message={
          confirmSend && (
            <>
              <strong>{formatCount(confirmSend.remaining)}</strong> {confirmSend.remaining === 1 ? 'person får' : 'personer får'} e-post 1.
              {sendWindow ? ` E-postene går ut ${sendWindow}.` : ''} Resten av e-postene kommer automatisk etterpå. Du kan sette utsendelsen på pause når som helst.
            </>
          )
        }
        confirmLabel="Send nå"
        loading={busy}
        onConfirm={confirmAndSend}
        onCancel={() => setConfirmSend(null)}
      />
      <ConfirmModal
        open={confirmRemove !== null}
        title={confirmRemove ? `Fjerne «${confirmRemove.navn}»?` : ''}
        message="Gruppen tas ut av utsendelsen. Lista eller segmentet slettes ikke, og de som allerede har fått e-post, får resten av e-postene som planlagt."
        confirmLabel="Fjern"
        loading={busy}
        onConfirm={async () => {
          if (confirmRemove && (await run('DELETE', '/grupper', { gruppeId: confirmRemove.id }, 'Gruppen er fjernet.'))) setConfirmRemove(null);
        }}
        onCancel={() => setConfirmRemove(null)}
      />
    </section>
  );
}
