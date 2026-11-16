'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, ButtonLink } from '@/components/admin/Button';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { InlineText } from '@/components/admin/InlineText';
import { RowMenu } from '@/components/admin/crm/RowMenu';
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
}

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('nb-NO', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' });

const inputCls = 'w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm';
const labelCls = 'mb-1 block text-xs font-medium text-gray-600';

export function GroupsSection({ utsendelseId, groups, flows, lists, segments }: Props) {
  const { run, busy } = useUtsendelseAction(utsendelseId);
  const [confirmRemove, setConfirmRemove] = useState<SerializedGroup | null>(null);
  const [editing, setEditing] = useState<{ id: string; field: 'navn' | 'beskrivelse' } | null>(null);
  const [adding, setAdding] = useState(false);
  const [newGroup, setNewGroup] = useState({ navn: '', kilde: '', flowId: flows[0]?.flowId ?? 0 });

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
        Trykk på en gruppe eller «Åpne» for å se hvem som er med. Ingenting sendes før du velger å sende og bekrefter der. Resten av e-postene kommer automatisk, og ingen får samme e-post to ganger.
      </p>

      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white px-5 py-6 text-center text-sm text-gray-600">
          Ingen mottakere ennå. Legg til en liste eller et segment under.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {groups.map((g) => {
            const people = g.sent + g.remaining;
            const href = `/admin/utsendelser/${utsendelseId}/${g.id}`;
            const editingName = editing?.id === g.id && editing.field === 'navn';
            const editingDesc = editing?.id === g.id && editing.field === 'beskrivelse';
            const saveGroup = async (changes: { navn?: string; beskrivelse?: string }, message: string) =>
              !!(await run('PATCH', '/grupper', { gruppeId: g.id, ...changes }, message));
            return (
              <li key={g.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">
                    {editingName ? (
                      <InlineText
                        label={`Navn på gruppen ${g.navn}`}
                        value={g.navn}
                        initiallyEditing
                        onClose={() => setEditing(null)}
                        onSave={(navn) => saveGroup({ navn }, 'Navnet er endret.')}
                      />
                    ) : g.missingSegment ? (
                      g.navn
                    ) : (
                      <Link href={`${href}?modus=en`} title="Se hvem som er med" className="underline-offset-2 hover:text-bjerke-blue hover:underline">
                        {g.navn}
                      </Link>
                    )}
                  </p>
                  {(g.beskrivelse || editingDesc) && (
                    <p className="mt-0.5 text-sm text-gray-700">
                      <InlineText
                        label={`Beskrivelse av gruppen ${g.navn}`}
                        value={g.beskrivelse ?? ''}
                        placeholder="Kort beskrivelse"
                        maxLength={300}
                        required={false}
                        initiallyEditing={editingDesc}
                        onClose={() => setEditing(null)}
                        onSave={(beskrivelse) => saveGroup({ beskrivelse }, 'Beskrivelsen er lagret.')}
                      />
                    </p>
                  )}
                  <p className="mt-0.5 text-sm text-gray-600">
                    {formatCount(people)} {people === 1 ? 'person' : 'personer'}
                    {flows.length > 1 && g.flowNavn && <> · får e-postene «{g.flowNavn}»</>}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">{g.kilde}</p>
                  {g.unreachable > 0 && (
                    <p className="mt-0.5 text-xs text-gray-500">
                      {formatCount(g.unreachable)} til kan ikke få e-post (har meldt seg av eller mangler adresse).
                    </p>
                  )}
                  {g.missingSegment && <p className="mt-0.5 text-sm text-red-700">Lista eller segmentet finnes ikke lenger.</p>}
                </div>
                <div className="shrink-0 sm:text-right">
                  {g.sent > 0 && g.lastSentAt && (
                    <p className="text-sm text-green-800">
                      <span aria-hidden="true">✓ </span>Sendt til {formatCount(g.sent)} · {dateTime(g.lastSentAt)}
                    </p>
                  )}
                  {g.sent > 0 && g.remaining > 0 && (
                    <p className="text-sm text-gray-600">{formatCount(g.remaining)} har ikke fått den ennå</p>
                  )}
                  <div className="mt-1 flex items-center gap-2 sm:justify-end">
                    {g.missingSegment ? (
                      <Button variant="secondary" disabled>Åpne</Button>
                    ) : (
                      <ButtonLink variant="secondary" href={g.remaining > 0 ? href : `${href}?modus=en`}>Åpne</ButtonLink>
                    )}
                    <RowMenu
                      compact
                      label={`Flere valg for ${g.navn}`}
                      items={[
                        { label: 'Endre navn', onSelect: () => setEditing({ id: g.id, field: 'navn' }) },
                        { label: g.beskrivelse ? 'Endre beskrivelse' : 'Legg til beskrivelse', onSelect: () => setEditing({ id: g.id, field: 'beskrivelse' }) },
                        { label: 'Fjern gruppen', danger: true, onSelect: () => setConfirmRemove(g) },
                      ]}
                    />
                  </div>
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
