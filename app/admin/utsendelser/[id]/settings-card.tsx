'use client';

import { useState } from 'react';
import { Button } from '@/components/admin/Button';
import { SendWindowFields } from '@/components/admin/SendWindowFields';
import { windowFromDraft, type SendWindowDraft } from '@/lib/flows/send-window';
import { formatCount } from '../status';
import { useUtsendelseAction } from './use-action';

export interface SenderOption {
  id: number;
  label: string;
}

interface Props {
  utsendelseId: string;
  navn: string;
  beskrivelse?: string;
  senderIdentityId: number | null;
  senderName: string | null;
  sendWindow: string;
  sendWindowDraft: SendWindowDraft;
  senderMixed: boolean;
  windowMixed: boolean;
  senders: SenderOption[];
  sent: number;
  total: number;
}

const inputCls = 'w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm';
const labelCls = 'mb-1 block text-xs font-medium text-gray-600';

/** Oversikt øverst på siden, med «Endre» for navn, avsender og når e-postene går ut. */
export function SettingsCard(props: Props) {
  const { run, busy } = useUtsendelseAction(props.utsendelseId);
  const [editing, setEditing] = useState(false);
  const [navn, setNavn] = useState(props.navn);
  const [beskrivelse, setBeskrivelse] = useState(props.beskrivelse ?? '');
  const initialSender = props.senderMixed ? '' : (props.senderIdentityId ?? '');
  const [sender, setSender] = useState<number | ''>(initialSender);
  const [window, setWindow] = useState<SendWindowDraft>(props.sendWindowDraft);
  const [windowTouched, setWindowTouched] = useState(false);

  function open() {
    setNavn(props.navn);
    setBeskrivelse(props.beskrivelse ?? '');
    setSender(initialSender);
    setWindow(props.sendWindowDraft);
    setWindowTouched(false);
    setEditing(true);
  }

  // Bare det brukeren faktisk har endret sendes, så et nytt navn aldri overskriver avsender eller sendetid.
  const changes = {
    ...(navn.trim() !== props.navn && { navn }),
    ...(beskrivelse.trim() !== (props.beskrivelse ?? '') && { beskrivelse }),
    ...(sender !== '' && sender !== initialSender && { senderIdentityId: sender }),
    ...(windowTouched && JSON.stringify(window) !== JSON.stringify(props.sendWindowDraft) && { sendetid: window }),
  };

  async function save() {
    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }
    if (await run('PATCH', '', changes, 'Endringene er lagret.')) setEditing(false);
  }

  const windowError = windowFromDraft(window);

  if (editing) {
    return (
      <section aria-label="Innstillinger" className="mb-10 space-y-4 rounded-xl border border-gray-200 bg-white px-5 py-4">
        <div>
          <label htmlFor="u-navn" className={labelCls}>Navn</label>
          <input id="u-navn" className={inputCls} value={navn} maxLength={120} onChange={(e) => setNavn(e.target.value)} />
        </div>
        <div>
          <label htmlFor="u-beskrivelse" className={labelCls}>Kort beskrivelse (valgfritt)</label>
          <input id="u-beskrivelse" className={inputCls} value={beskrivelse} maxLength={500} onChange={(e) => setBeskrivelse(e.target.value)} />
        </div>
        <div>
          <label htmlFor="u-avsender" className={labelCls}>Avsender (gjelder alle e-postene)</label>
          <select id="u-avsender" className={inputCls} value={sender} onChange={(e) => setSender(e.target.value ? Number(e.target.value) : '')}>
            <option value="">{props.senderMixed ? 'Varierer – velg for å bruke én for alle' : 'Velg avsender …'}</option>
            {props.senders.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <p className={labelCls}>Når e-postene kan gå ut{props.windowMixed ? ' (varierer nå – endrer du, gjelder det alle)' : ''}</p>
          <SendWindowFields
            idPrefix="u-sendetid"
            value={window}
            onChange={(w) => {
              setWindow(w);
              setWindowTouched(true);
            }}
            disabled={busy}
            showError
          />
        </div>
        <div className="flex gap-3">
          <Button loading={busy} disabled={!navn.trim() || (windowTouched && !windowError.ok)} onClick={save}>Lagre</Button>
          <Button variant="secondary" disabled={busy} onClick={() => setEditing(false)}>Avbryt</Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Oversikt" className="mb-10 rounded-xl border border-gray-200 bg-white px-5 py-4">
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-gray-600">Sendt til</dt>
          <dd className="mt-0.5 text-lg font-semibold text-gray-900">
            {formatCount(props.sent)} <span className="text-sm font-normal text-gray-600">av {formatCount(props.total)}</span>
          </dd>
        </div>
        <div>
          <dt className="text-gray-600">Avsender</dt>
          <dd className="mt-0.5 text-gray-900">{props.senderMixed ? 'Varierer' : props.senderName ?? 'Ikke valgt'}</dd>
        </div>
        <div>
          <dt className="text-gray-600">E-postene går ut</dt>
          <dd className="mt-0.5 text-gray-900">{props.windowMixed ? 'Varierer' : props.sendWindow || 'Når som helst'}</dd>
        </div>
      </dl>
      <Button className="mt-3" variant="secondary" size="sm" onClick={open}>Endre navn, avsender eller tidspunkt</Button>
    </section>
  );
}
