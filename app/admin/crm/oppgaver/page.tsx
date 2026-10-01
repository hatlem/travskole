'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { EmptyState } from '@/components/admin/EmptyState';
import { TableSkeleton } from '@/components/admin/Skeleton';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { useToast } from '@/components/admin/Toast';
import { HelpTip } from '@/components/admin/HelpTip';
import { AssigneeSelect } from '@/components/admin/crm/AssigneeSelect';
import { assigneeLabel, useAssignees } from '@/components/admin/crm/useAssignees';
import { dateInputToIso, isoToDateInput } from '@/lib/crm/form-utils';

interface TaskRow {
  id: number;
  title: string;
  dueAt: string | null;
  status: string;
  contact: { id: number; name: string } | null;
  organization: { id: number; name: string } | null;
  deal: { id: number; title: string } | null;
  assignee: { id: number; email: string } | null;
}

interface EditState { id: number; title: string; dueAt: string; assigneeId: number | null }

function isOverdue(dueAtStr: string): boolean {
  const due = new Date(dueAtStr);
  const today = new Date();
  const dueLocal = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return dueLocal < todayLocal;
}

export default function OppgaverPage() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('open');
  const [assigneeFilter, setAssigneeFilter] = useState('me');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [newAssignee, setNewAssignee] = useState<number | null>(null);
  const [newAssigneeTouched, setNewAssigneeTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [updatingIds, setUpdatingIds] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<EditState | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TaskRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { assignees, currentUserId } = useAssignees();
  const { toast } = useToast();
  const abortRef = useRef<AbortController | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Nye oppgaver tildeles meg som standard.
  const effectiveNewAssignee = newAssigneeTouched ? newAssignee : currentUserId;

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (assigneeFilter) params.set('assignee', assigneeFilter);
      const res = await fetch(`/api/admin/crm/tasks?${params}`, { signal: controller.signal });
      if (!res.ok) throw new Error('Kunne ikke hente oppgavene. Last siden på nytt om litt.');
      const data = await res.json();
      setTasks(data.tasks || []);
      setLoadError(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setLoadError(true);
      setTasks([]);
      toast(err instanceof Error ? err.message : 'Kunne ikke hente oppgavene. Last siden på nytt om litt.', 'error');
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  }, [statusFilter, assigneeFilter, toast]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function createTask() {
    if (!title.trim() || creating) return;

    setCreating(true);
    try {
      const res = await fetch('/api/admin/crm/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          assigneeId: effectiveNewAssignee,
          dueAt: dateInputToIso(dueAt),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || 'Oppgaven ble ikke lagt til. Sjekk tittel og frist og prøv igjen.', 'error');
        return;
      }
      toast(`Oppgaven «${title.trim()}» er lagt til`, 'success');
      setTitle('');
      setDueAt('');
      setNewAssigneeTouched(false);
      await load();
    } catch {
      toast('Oppgaven ble ikke lagt til — sjekk nettforbindelsen og prøv igjen.', 'error');
    } finally {
      setCreating(false);
    }
  }

  async function patchTask(taskId: number, body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/admin/crm/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast(data.error || 'Endringen ble ikke lagret. Prøv igjen.', 'error');
      return false;
    }
    return true;
  }

  async function toggle(task: TaskRow) {
    if (updatingIds.has(task.id)) return;

    setUpdatingIds((prev) => new Set(prev).add(task.id));
    try {
      if (await patchTask(task.id, { status: task.status === 'done' ? 'open' : 'done' })) await load();
    } catch {
      toast('Kunne ikke oppdatere oppgave', 'error');
    } finally {
      setUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }
  }

  function startEdit(t: TaskRow) {
    setEditing({ id: t.id, title: t.title, dueAt: isoToDateInput(t.dueAt), assigneeId: t.assignee?.id ?? null });
  }

  async function saveEdit(original: TaskRow) {
    if (!editing || !editing.title.trim() || savingEdit) return;
    const body: Record<string, unknown> = {};
    if (editing.title.trim() !== original.title) body.title = editing.title.trim();
    if (editing.dueAt !== isoToDateInput(original.dueAt)) body.dueAt = dateInputToIso(editing.dueAt);
    if (editing.assigneeId !== (original.assignee?.id ?? null)) body.assigneeId = editing.assigneeId;
    if (Object.keys(body).length === 0) {
      setEditing(null);
      return;
    }
    setSavingEdit(true);
    try {
      if (await patchTask(original.id, body)) {
        toast('Oppgaven er lagret', 'success');
        setEditing(null);
        await load();
      }
    } catch {
      toast('Kunne ikke oppdatere oppgave', 'error');
    } finally {
      setSavingEdit(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/crm/tasks/${deleteTarget.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error || 'Oppgaven ble ikke slettet. Prøv igjen.', 'error');
        return;
      }
      toast('Oppgaven er slettet', 'success');
      setDeleteTarget(null);
      await load();
    } catch {
      toast('Oppgaven ble ikke slettet — sjekk nettforbindelsen og prøv igjen.', 'error');
    } finally {
      setDeleting(false);
    }
  }

  const overdue = (t: TaskRow) => t.status === 'open' && t.dueAt !== null && isOverdue(t.dueAt);
  const emptyDescription =
    assigneeFilter === 'me'
      ? 'Du har ingen oppgaver her. Velg «Alle» for å se hele teamets oppgaver, eller lag en ny.'
      : 'Skriv inn en ny oppgave i feltet over, eller lag en fra en kontakt.';

  return (
    <div>
      <CrmTabs
        actions={
          <button
            type="button"
            onClick={() => titleInputRef.current?.focus()}
            className="inline-flex items-center gap-2 bg-bjerke-blue text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-bjerke-blue-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bjerke-blue focus-visible:ring-offset-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Ny oppgave
          </button>
        }
      />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="inline-flex rounded-md border border-gray-300 overflow-hidden text-sm" role="group" aria-label="Vis oppgaver for">
          {[
            { value: 'me', label: 'Mine' },
            { value: '', label: 'Alle' },
            { value: 'none', label: 'Uten ansvarlig' },
          ].map((o) => (
            <button
              key={o.value || 'all'}
              type="button"
              onClick={() => setAssigneeFilter(o.value)}
              aria-pressed={assigneeFilter === o.value}
              className={`px-3 py-2 ${assigneeFilter === o.value ? 'bg-bjerke-blue text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <select
          value={['me', '', 'none'].includes(assigneeFilter) ? '' : assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          aria-label="Vis oppgaver for bestemt person"
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
        >
          <option value="">Bestemt person …</option>
          {assignees.map((a) => <option key={a.id} value={String(a.id)}>{assigneeLabel(a)}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Status"
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
        >
          <option value="open">Åpne</option>
          <option value="done">Fullførte</option>
          <option value="">Alle statuser</option>
        </select>
      </div>

      <form
        className="flex flex-wrap items-center gap-2 mb-4 border border-gray-200 rounded-lg p-3 bg-gray-50"
        onSubmit={(e) => { e.preventDefault(); createTask(); }}
      >
        <label htmlFor="new-task-title" className="w-full text-sm font-medium text-gray-800 flex items-center">
          Ny oppgave
          <HelpTip term="owner" />
          <span className="ml-2 font-normal text-gray-500">Hva skal gjøres, når, og hvem har ansvaret?</span>
        </label>
        <input
          id="new-task-title"
          ref={titleInputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="F.eks. Ring Firma AS om julebordet"
          maxLength={300}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm flex-1 min-w-[12rem] bg-white"
        />
        <input
          type="date"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          aria-label="Frist"
          className="border border-gray-300 rounded-md px-2 py-2 text-sm bg-white"
        />
        <AssigneeSelect
          aria-label="Ansvarlig"
          value={effectiveNewAssignee}
          onChange={(v) => { setNewAssignee(v); setNewAssigneeTouched(true); }}
          className="border border-gray-300 rounded-md px-2 py-2 text-sm bg-white"
        />
        <button
          type="submit"
          disabled={!title.trim() || creating}
          className="bg-bjerke-blue text-white px-4 py-2 rounded-md text-sm disabled:opacity-50"
        >
          {creating ? 'Legger til …' : 'Legg til oppgave'}
        </button>
      </form>

      {loading ? (
        <TableSkeleton rows={8} />
      ) : loadError ? (
        <EmptyState
          title="Kunne ikke hente oppgavene"
          description="Noe gikk galt da oppgavene skulle hentes. Ingenting er endret — prøv igjen."
          action={{ label: 'Prøv igjen', onClick: () => load() }}
        />
      ) : tasks.length === 0 ? (
        <EmptyState
          title={statusFilter === 'open' ? 'Ingenting å gjøre akkurat nå' : 'Ingen oppgaver her'}
          description={emptyDescription}
          action={{ label: 'Lag en oppgave', onClick: () => titleInputRef.current?.focus() }}
        />
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 w-8"><span className="sr-only">Fullført</span></th>
                <th className="px-4 py-3 font-medium">Oppgave</th>
                <th className="px-4 py-3 font-medium">Gjelder</th>
                <th className="px-4 py-3 font-medium">Ansvarlig</th>
                <th className="px-4 py-3 font-medium">Frist</th>
                <th className="px-4 py-3"><span className="sr-only">Handlinger</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tasks.map((t) => {
                const isEditing = editing?.id === t.id;
                return (
                  <tr key={t.id} className="align-middle">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={t.status === 'done'}
                        onChange={() => toggle(t)}
                        disabled={updatingIds.has(t.id)}
                        aria-label={t.status === 'done' ? `Marker «${t.title}» som ikke gjort` : `Marker «${t.title}» som gjort`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          value={editing.title}
                          onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit(t);
                            if (e.key === 'Escape') setEditing(null);
                          }}
                          maxLength={300}
                          autoFocus
                          className="border border-gray-300 rounded-md px-2 py-1 text-sm w-full"
                        />
                      ) : (
                        <span className={t.status === 'done' ? 'line-through text-gray-400' : ''}>{t.title}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs space-x-2">
                      {t.contact && (
                        <Link href={`/admin/crm/kontakter/${t.contact.id}`} className="text-blue-700 hover:underline">{t.contact.name}</Link>
                      )}
                      {t.organization && (
                        <Link href={`/admin/crm/bedrifter/${t.organization.id}`} className="text-blue-700 hover:underline">{t.organization.name}</Link>
                      )}
                      {t.deal && <span className="text-gray-500">{t.deal.title}</span>}
                      {!t.contact && !t.organization && !t.deal && <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <AssigneeSelect
                          value={editing.assigneeId}
                          onChange={(assigneeId) => setEditing({ ...editing, assigneeId })}
                          className="border border-gray-300 rounded-md px-2 py-1 text-sm"
                        />
                      ) : (
                        <span className={t.assignee ? 'text-gray-700' : 'text-gray-400'}>
                          {t.assignee ? t.assignee.email : 'Uten ansvarlig'}
                          {t.assignee && t.assignee.id === currentUserId && ' (meg)'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {isEditing ? (
                        <input
                          type="date"
                          value={editing.dueAt}
                          onChange={(e) => setEditing({ ...editing, dueAt: e.target.value })}
                          aria-label="Frist"
                          className="border border-gray-300 rounded-md px-2 py-1 text-sm"
                        />
                      ) : (
                        <span className={`text-xs ${overdue(t) ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                          {t.dueAt ? new Date(t.dueAt).toLocaleDateString('nb-NO') : '—'}
                          {overdue(t) && ' (forfalt)'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-xs">
                      {isEditing ? (
                        <>
                          <button onClick={() => setEditing(null)} disabled={savingEdit} className="text-gray-500 px-2">Avbryt</button>
                          <button
                            onClick={() => saveEdit(t)}
                            disabled={savingEdit || !editing.title.trim()}
                            className="bg-bjerke-blue text-white px-3 py-1 rounded-md disabled:opacity-50"
                          >
                            {savingEdit ? 'Lagrer …' : 'Lagre'}
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startEdit(t)} className="text-blue-700 hover:underline px-2">Rediger</button>
                          <button onClick={() => setDeleteTarget(t)} className="text-gray-400 hover:text-red-600 px-2">Slett</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        title="Slette oppgaven?"
        message={deleteTarget ? `«${deleteTarget.title}» forsvinner for godt, også fra kontakten den hører til. Vil du bare krysse den av som gjort, bruk avkrysningsboksen i stedet.` : ''}
        confirmLabel="Slett oppgaven"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
