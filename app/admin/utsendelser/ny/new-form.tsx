'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/admin/Button';
import { useToast } from '@/components/admin/Toast';

interface Option {
  id: number;
  name: string;
}

const inputCls = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm';
const labelCls = 'mb-1 block text-sm font-medium text-gray-800';

export function NewUtsendelseForm({ senders, lists, segments }: { senders: { id: number; label: string }[]; lists: Option[]; segments: Option[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [navn, setNavn] = useState('');
  const [sender, setSender] = useState<number | ''>(senders.length === 1 ? senders[0].id : '');
  const [kilder, setKilder] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const toggle = (value: string) => setKilder((k) => (k.includes(value) ? k.filter((x) => x !== value) : [...k, value]));

  async function create() {
    setSaving(true);
    try {
      const grupper = kilder.map((value) => {
        const [type, id] = value.split(':');
        const name = (type === 'liste' ? lists : segments).find((o) => o.id === Number(id))?.name ?? 'Gruppe';
        return { navn: name, ...(type === 'liste' ? { listId: Number(id) } : { segmentId: Number(id) }) };
      });
      const res = await fetch('/api/admin/utsendelser/ny', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ navn, senderIdentityId: sender, grupper }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error ?? 'Kunne ikke lage utsendelsen.', 'error');
        return;
      }
      toast('Utsendelsen er laget. Skriv teksten i e-post 1.', 'success');
      router.push(`/admin/utsendelser/${data.utsendelse.id}`);
    } finally {
      setSaving(false);
    }
  }

  const sourceList = (title: string, type: 'liste' | 'segment', options: Option[]) =>
    options.length > 0 && (
      <fieldset className="mt-2">
        <legend className="text-xs font-medium uppercase tracking-wide text-gray-500">{title}</legend>
        <div className="mt-1 max-h-56 space-y-1 overflow-y-auto rounded-md border border-gray-200 p-2">
          {options.map((o) => {
            const value = `${type}:${o.id}`;
            return (
              <label key={value} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm text-gray-800 hover:bg-gray-50">
                <input type="checkbox" checked={kilder.includes(value)} onChange={() => toggle(value)} />
                {o.name}
              </label>
            );
          })}
        </div>
      </fieldset>
    );

  return (
    <div className="space-y-6 rounded-xl border border-gray-200 bg-white px-6 py-5">
      <div>
        <label htmlFor="ny-navn" className={labelCls}>Navn</label>
        <input id="ny-navn" className={inputCls} value={navn} maxLength={120} placeholder="For eksempel «Påskeløp 2027»" onChange={(e) => setNavn(e.target.value)} />
      </div>
      <div>
        <label htmlFor="ny-avsender" className={labelCls}>Avsender</label>
        <select id="ny-avsender" className={inputCls} value={sender} onChange={(e) => setSender(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Velg avsender …</option>
          {senders.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
      <div>
        <p className={labelCls}>Hvem skal få den? <span className="font-normal text-gray-500">(kan endres senere)</span></p>
        {lists.length === 0 && segments.length === 0 ? (
          <p className="text-sm text-gray-600">Ingen lister eller segmenter ennå. Importer kontakter under CRM først.</p>
        ) : (
          <>
            {sourceList('Lister', 'liste', lists)}
            {sourceList('Segmenter', 'segment', segments)}
          </>
        )}
      </div>
      <p className="text-sm text-gray-600">Utsendelsen starter med én e-post. Du kan legge til flere, og ingenting sendes før du trykker «Send nå».</p>
      <div className="flex gap-3">
        <Button loading={saving} disabled={!navn.trim() || sender === ''} onClick={create}>Lag utsendelse</Button>
        <Button variant="secondary" disabled={saving} onClick={() => router.push('/admin/utsendelser')}>Avbryt</Button>
      </div>
    </div>
  );
}
