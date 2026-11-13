'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/admin/Toast';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { Button } from '@/components/admin/Button';
import type { ContactUtsendelse } from '@/lib/utsendelser/recipients';

const STATUS: Record<ContactUtsendelse['status'], string> = {
  ikke: 'ikke sendt ennå',
  sendt: 'har fått e-post',
  ut: 'tatt ut',
  ingen: 'ikke med',
};

/** Utsendelsene kontakten er med i: flytt til en annen gruppe, ta ut eller legg til. */
export function ContactUtsendelser({ contactId, contactName }: { contactId: number; contactName: string }) {
  const { toast } = useToast();
  const [items, setItems] = useState<ContactUtsendelse[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmStop, setConfirmStop] = useState<ContactUtsendelse | null>(null);

  const load = useCallback(() => {
    fetch(`/api/admin/crm/contacts/${contactId}/utsendelser`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        return (await res.json()).utsendelser as ContactUtsendelse[];
      })
      .then((list) => {
        setFailed(false);
        setItems(list);
      })
      .catch(() => setFailed(true));
  }, [contactId]);

  useEffect(() => {
    load();
  }, [load]);

  async function change(u: ContactUtsendelse, body: Record<string, unknown>, success: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/utsendelser/${u.id}/mottaker`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      toast(res.ok ? success : data.error ?? 'Noe gikk galt. Prøv igjen.', res.ok ? 'success' : 'error');
      if (res.ok) {
        setConfirmStop(null);
        load();
      }
    } finally {
      setBusy(false);
    }
  }

  if (failed) return <p className="text-sm text-gray-500">Kunne ikke hente utsendelsene. <button type="button" className="underline" onClick={load}>Prøv igjen</button></p>;
  if (!items) return <p className="text-sm text-gray-500">Henter …</p>;
  if (items.length === 0) return <p className="text-sm text-gray-500">Ingen utsendelser ennå.</p>;

  const member = items.filter((u) => u.status !== 'ingen');
  const others = items.filter((u) => u.status === 'ingen');

  return (
    <div className="space-y-2">
      {member.map((u) => (
        <div key={u.id} className="rounded-md bg-gray-50 px-3 py-2 text-sm">
          <p>
            <Link href={`/admin/utsendelser/${u.id}`} className="font-medium text-bjerke-blue hover:underline">{u.navn}</Link>
            <span className="text-gray-600"> · {u.groupNavn ? `${u.groupNavn} · ` : ''}{STATUS[u.status]}</span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {u.status === 'ikke' && u.grupper.length > 1 && (
              <>
                <label htmlFor={`flytt-${u.id}`} className="sr-only">Flytt {contactName} til gruppe</label>
                <select
                  id={`flytt-${u.id}`}
                  value=""
                  disabled={busy}
                  onChange={(e) => {
                    const g = u.grupper.find((x) => x.id === e.target.value);
                    if (g) change(u, { action: 'move', gruppeId: g.id }, `Flyttet til ${g.navn}.`);
                  }}
                  className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
                >
                  <option value="">Flytt til …</option>
                  {u.grupper.filter((g) => g.id !== u.groupId).map((g) => <option key={g.id} value={g.id}>{g.navn}</option>)}
                </select>
              </>
            )}
            {u.status === 'ut' ? (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => change(u, { action: 'include' }, `${contactName} er med igjen.`)}>Ta med igjen</Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => (u.status === 'sendt' ? setConfirmStop(u) : change(u, { action: 'exclude' }, `${contactName} får ikke e-postene.`))}
              >
                {u.status === 'sendt' ? 'Stopp e-postene' : 'Ta ut'}
              </Button>
            )}
            {u.groupId && (
              <Link href={`/admin/utsendelser/${u.id}/${u.groupId}?modus=en`} className="text-sm font-medium text-bjerke-blue hover:underline">
                Se og endre e-posten
              </Link>
            )}
          </div>
        </div>
      ))}

      {others.length > 0 && (
        <>
          <label htmlFor="legg-i-utsendelse" className="sr-only">Legg {contactName} til i en utsendelse</label>
          <select
            id="legg-i-utsendelse"
            value=""
            disabled={busy}
            onChange={(e) => {
              const [uid, gid] = e.target.value.split('|');
              const u = others.find((x) => x.id === uid);
              const g = u?.grupper.find((x) => x.id === gid);
              if (u && g) change(u, { action: 'move', gruppeId: g.id }, `Lagt til i ${u.navn} (${g.navn}).`);
            }}
            className="w-full rounded-md border border-dashed border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700"
          >
            <option value="">+ Legg til i en utsendelse …</option>
            {others.map((u) => (
              <optgroup key={u.id} label={u.navn}>
                {u.grupper.map((g) => <option key={g.id} value={`${u.id}|${g.id}`}>{g.navn}</option>)}
              </optgroup>
            ))}
          </select>
        </>
      )}

      <ConfirmModal
        open={confirmStop !== null}
        title={`Stoppe e-postene til ${contactName}?`}
        message="Personen har allerede fått e-post fra utsendelsen. Resten blir ikke sendt. Dette kan ikke angres."
        confirmLabel="Stopp e-postene"
        loading={busy}
        onConfirm={() => confirmStop && change(confirmStop, { action: 'exclude' }, 'E-postene er stoppet.')}
        onCancel={() => setConfirmStop(null)}
      />
    </div>
  );
}
