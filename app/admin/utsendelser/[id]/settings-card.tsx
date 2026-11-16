'use client';

import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@/components/admin/Button';
import { PencilIcon } from '@/components/admin/InlineText';
import { SendWindowFields } from '@/components/admin/SendWindowFields';
import { windowFromDraft, type SendWindowDraft } from '@/lib/flows/send-window';
import { formatCount } from '../status';
import { PACE_OPTIONS, paceDuration } from '@/lib/utsendelser/pace';
import { useUtsendelseAction } from './use-action';

export interface SenderOption {
  id: number;
  label: string;
}

interface Props {
  utsendelseId: string;
  senderIdentityId: number | null;
  senderName: string | null;
  sendWindow: string;
  sendWindowDraft: SendWindowDraft;
  senderMixed: boolean;
  windowMixed: boolean;
  senders: SenderOption[];
  sent: number;
  total: number;
  remaining: number;
  queued: number;
  perHour: number;
}

type Field = 'sender' | 'window' | 'pace';

const selectCls = 'w-full rounded-md border border-bjerke-blue px-2 py-1 text-sm ring-2 ring-bjerke-blue/20 disabled:opacity-60';

/** Oversikt øverst på siden. Avsender, sendetid og fart endres hver for seg, der de står. */
export function SettingsCard(props: Props) {
  const { run, busy } = useUtsendelseAction(props.utsendelseId);
  const [editing, setEditing] = useState<Field | null>(null);
  const [window, setWindow] = useState<SendWindowDraft>(props.sendWindowDraft);

  function edit(field: Field) {
    if (field === 'window') setWindow(props.sendWindowDraft);
    setEditing(field);
  }

  async function save(changes: Record<string, unknown>, message: string) {
    if (await run('PATCH', '', changes, message)) setEditing(null);
  }

  const windowCheck = windowFromDraft(window);
  const windowChanged = JSON.stringify(window) !== JSON.stringify(props.sendWindowDraft);
  const queuedFor = paceDuration(props.queued, props.perHour);
  const restFor = paceDuration(props.remaining, props.perHour);
  const closeOnEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setEditing(null);
  };

  return (
    <section aria-label="Oversikt" className="mb-10 rounded-xl border border-gray-200 bg-white px-5 py-4">
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-gray-600">Sendt til</dt>
          <dd className="mt-0.5 text-lg font-semibold text-gray-900">
            {formatCount(props.sent)} <span className="text-sm font-normal text-gray-600">av {formatCount(props.total)}</span>
          </dd>
        </div>

        <div>
          <dt className="text-gray-600">Avsender</dt>
          <dd className="mt-0.5 text-gray-900">
            {editing === 'sender' ? (
              <select
                aria-label="Avsender (gjelder alle e-postene)"
                autoFocus
                className={selectCls}
                disabled={busy}
                value={props.senderMixed ? '' : (props.senderIdentityId ?? '')}
                onKeyDown={closeOnEscape}
                onBlur={() => !busy && setEditing(null)}
                onChange={(e) => {
                  const s = props.senders.find((o) => o.id === Number(e.target.value));
                  if (s) void save({ senderIdentityId: s.id }, `Avsender er nå ${s.label}.`);
                }}
              >
                <option value="" disabled>{props.senderMixed ? 'Varierer – velg én for alle' : 'Velg avsender …'}</option>
                {props.senders.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            ) : (
              <Editable label="avsender" onEdit={() => edit('sender')}>
                {props.senderMixed ? 'Varierer' : props.senderName ?? 'Ikke valgt'}
              </Editable>
            )}
          </dd>
        </div>

        <div>
          <dt className="text-gray-600">E-postene går ut</dt>
          <dd className="mt-0.5 text-gray-900">
            <Editable label="når e-postene går ut" active={editing === 'window'} onEdit={() => (editing === 'window' ? setEditing(null) : edit('window'))}>
              {props.windowMixed ? 'Varierer' : props.sendWindow || 'Når som helst'}
            </Editable>
          </dd>
        </div>

        <div>
          <dt className="text-gray-600">Fart</dt>
          <dd className="mt-0.5 text-gray-900">
            {editing === 'pace' ? (
              <>
                <select
                  aria-label="Fart (gjelder alle utsendelser)"
                  autoFocus
                  className={selectCls}
                  disabled={busy}
                  value={props.perHour}
                  onKeyDown={closeOnEscape}
                  onBlur={() => !busy && setEditing(null)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    void save({ fartPerTime: n }, `Farten er nå ca. ${n} i timen.`);
                  }}
                >
                  {!(PACE_OPTIONS as readonly number[]).includes(props.perHour) && (
                    <option value={props.perHour} disabled>{props.perHour > 0 ? `${props.perHour} i timen` : 'Ingen grense'}</option>
                  )}
                  {PACE_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n} i timen{n === 100 ? ' (anbefalt)' : ''}</option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-gray-600">Gjelder alle utsendelser. Litt av litt er tryggere mot spamfiltre.</span>
              </>
            ) : (
              <>
                <Editable label="fart" onEdit={() => edit('pace')}>
                  {props.perHour > 0 ? `Jevnt, ca. ${props.perHour} i timen` : 'Ingen grense'}
                </Editable>
                {queuedFor ? (
                  <span className="block text-gray-600">{formatCount(props.queued)} i kø, ferdig om {queuedFor}</span>
                ) : (
                  restFor && <span className="block text-gray-600">Sender du til resten, tar det {restFor}</span>
                )}
              </>
            )}
          </dd>
        </div>
      </dl>

      {editing === 'window' && (
        <div
          role="group"
          aria-label="Når e-postene kan gå ut"
          className="mt-4 space-y-3 border-t border-gray-100 pt-4"
          onKeyDown={closeOnEscape}
        >
          {props.windowMixed && <p className="text-xs text-gray-600">Sendetiden varierer nå. Lagrer du, gjelder den nye alle e-postene.</p>}
          <SendWindowFields idPrefix="u-sendetid" value={window} onChange={setWindow} disabled={busy} showError />
          <div className="flex gap-3">
            <Button
              size="sm"
              loading={busy}
              disabled={!windowCheck.ok || (!windowChanged && !props.windowMixed)}
              onClick={() => save({ sendetid: window }, 'Sendetiden er lagret.')}
            >
              Lagre
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(null)}>Avbryt</Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Verdien er selve knappen: klikk på den (eller blyanten) for å endre. */
function Editable({ label, active = false, onEdit, children }: { label: string; active?: boolean; onEdit: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-expanded={active || undefined}
      title={`Endre ${label}`}
      className={`group -mx-1.5 inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bjerke-blue ${active ? 'bg-blue-50' : ''}`}
    >
      <span className="min-w-0 break-words">{children}</span>
      <span className="sr-only">, endre {label}</span>
      <PencilIcon className="h-3.5 w-3.5" />
    </button>
  );
}
