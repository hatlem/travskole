'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { useToast } from '@/components/admin/Toast';
import { EmptyState } from '@/components/admin/EmptyState';

interface ContactDetail {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  roleTitle: string | null;
  stage: string;
  source: string;
  tags: string[];
  organization: { id: number; name: string } | null;
  consent: { marketing: boolean; lawfulBasis: string | null; consentAt: string | null } | null;
  deals: { id: number; title: string; value: number | null; eventType: string | null; eventDate: string | null; status: string; stage: { name: string }; pipeline: { name: string } }[];
  tasks: { id: number; title: string; dueAt: string | null; status: string }[];
  notes: { id: number; body: string; authorEmail: string; createdAt: string }[];
  activities: { id: number; type: string; title: string; body: string | null; actorEmail: string | null; occurredAt: string }[];
}

const STAGES = [
  { value: 'lead', label: 'Interessent' }, { value: 'active', label: 'Aktiv' },
  { value: 'customer', label: 'Kunde' }, { value: 'dormant', label: 'Sovende' },
  { value: 'lost', label: 'Tapt' },
];

const ACTIVITY_ICONS: Record<string, string> = {
  booking: '📅', registration: '📝', note: '🗒️', task: '✅',
  deal_change: '💼', import: '📥', event: '⚡',
};

function fmtDate(d: string | null): string {
  return d ? new Date(d).toLocaleDateString('nb-NO') : '—';
}

export default function KontaktDetaljPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const { toast } = useToast();
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const res = await fetch(`/api/admin/crm/contacts/${id}`, { signal: controller.signal });
      if (!res.ok) throw new Error('Kunne ikke laste kontaktdetaljer');
      const data = await res.json();
      setContact(data.contact);
      setLoadError(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setLoadError(true);
      setContact(null);
      toast(err instanceof Error ? err.message : 'Kunne ikke laste kontaktdetaljer', 'error');
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function patch(body: Record<string, unknown>, okMsg: string) {
    try {
      const res = await fetch(`/api/admin/crm/contacts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        toast(data.error || 'Noe gikk galt', 'error');
        return;
      }
      toast(okMsg, 'success');
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
    }
  }

  async function setConsent(marketing: boolean) {
    try {
      const res = await fetch(`/api/admin/crm/contacts/${id}/consent`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketing, lawfulBasis: marketing ? 'consent' : null }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast(data.error || 'Noe gikk galt', 'error');
        return;
      }
      toast('Samtykke oppdatert', 'success');
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
    }
  }

  async function addNote() {
    if (!noteText.trim()) return;
    try {
      const res = await fetch('/api/admin/crm/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: noteText, contactId: Number(id) }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast(data.error || 'Noe gikk galt', 'error');
        return;
      }
      setNoteText('');
      toast('Notat lagret', 'success');
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
    }
  }

  async function addTask() {
    if (!taskTitle.trim()) return;
    try {
      const res = await fetch('/api/admin/crm/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: taskTitle, contactId: Number(id),
          dueAt: taskDue ? new Date(taskDue).toISOString() : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast(data.error || 'Noe gikk galt', 'error');
        return;
      }
      setTaskTitle('');
      setTaskDue('');
      toast('Oppgave opprettet', 'success');
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
    }
  }

  async function toggleTask(taskId: number, status: string) {
    try {
      const res = await fetch(`/api/admin/crm/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: status === 'done' ? 'open' : 'done' }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast(data.error || 'Noe gikk galt', 'error');
        return;
      }
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
    }
  }

  if (loading) return <div className="text-gray-500 p-8">Laster …</div>;
  if (loadError) {
    return (
      <div>
        <CrmTabs />
        <EmptyState
          title="Kunne ikke laste kontaktdetaljer"
          description="Noe gikk galt under henting av kontaktdetaljer. Prøv igjen."
          action={{ label: 'Prøv igjen', onClick: () => load() }}
        />
      </div>
    );
  }
  if (!contact) return (
    <div>
      <CrmTabs />
      <div className="text-gray-500 p-8">Kontakten finnes ikke.</div>
    </div>
  );

  return (
    <div>
      <CrmTabs />

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">{contact.name}</h1>
          <p className="text-gray-600 text-sm mt-1">
            {contact.email ?? 'Ingen e-post'} · {contact.phone ?? 'Ingen telefon'}
            {contact.organization && (
              <> · <Link href={`/admin/crm/bedrifter/${contact.organization.id}`} className="text-blue-700 hover:underline">{contact.organization.name}</Link></>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600">
            Stadium:{' '}
            <select
              value={contact.stage}
              onChange={(e) => patch({ stage: e.target.value }, 'Stadium oppdatert')}
              className="border border-gray-300 rounded-md px-2 py-1 text-sm"
            >
              {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={contact.consent?.marketing ?? false}
              onChange={(e) => setConsent(e.target.checked)}
            />
            Markedsføringssamtykke
          </label>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Venstre: tidslinje */}
        <section>
          <h2 className="font-semibold mb-3">Tidslinje</h2>
          {contact.activities.length === 0 ? (
            <p className="text-sm text-gray-500">Ingen aktivitet ennå.</p>
          ) : (
            <ol className="space-y-3">
              {contact.activities.map((a) => (
                <li key={a.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{ACTIVITY_ICONS[a.type] ?? '·'} {a.title}</span>
                    <span className="text-gray-500 text-xs">{fmtDate(a.occurredAt)}</span>
                  </div>
                  {a.body && <p className="text-gray-600 mt-1 whitespace-pre-wrap">{a.body}</p>}
                  {a.actorEmail && <p className="text-gray-400 text-xs mt-1">{a.actorEmail}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Høyre: deals, oppgaver, notater */}
        <div className="space-y-6">
          <section>
            <h2 className="font-semibold mb-3">Deals ({contact.deals.length})</h2>
            {contact.deals.length === 0 ? (
              <p className="text-sm text-gray-500">Ingen deals.</p>
            ) : (
              <ul className="space-y-2">
                {contact.deals.map((d) => (
                  <li key={d.id} className="border border-gray-200 rounded-lg p-3 text-sm flex items-center justify-between">
                    <div>
                      <span className="font-medium">{d.title}</span>
                      <span className="text-gray-500 ml-2">{d.stage.name}</span>
                      {d.eventDate && <span className="text-gray-500 ml-2">{fmtDate(d.eventDate)}</span>}
                    </div>
                    <span className="text-gray-700">{d.value !== null ? `${d.value.toLocaleString('nb-NO')} kr` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="font-semibold mb-3">Oppgaver</h2>
            <div className="flex gap-2 mb-2">
              <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Ny oppgave …"
                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm flex-1" />
              <input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
              <button onClick={addTask} disabled={!taskTitle.trim()}
                className="bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm disabled:opacity-50">Legg til</button>
            </div>
            <ul className="space-y-1">
              {contact.tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-sm py-1">
                  <input type="checkbox" checked={t.status === 'done'} onChange={() => toggleTask(t.id, t.status)} />
                  <span className={t.status === 'done' ? 'line-through text-gray-400' : ''}>{t.title}</span>
                  {t.dueAt && <span className="text-gray-500 text-xs ml-auto">{fmtDate(t.dueAt)}</span>}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-semibold mb-3">Notater</h2>
            <div className="flex gap-2 mb-2">
              <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Skriv et notat …"
                rows={2} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm flex-1" />
              <button onClick={addNote} disabled={!noteText.trim()}
                className="bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm self-end disabled:opacity-50">Lagre</button>
            </div>
            <ul className="space-y-2">
              {contact.notes.map((n) => (
                <li key={n.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <p className="text-gray-400 text-xs mt-1">{n.authorEmail} · {fmtDate(n.createdAt)}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
