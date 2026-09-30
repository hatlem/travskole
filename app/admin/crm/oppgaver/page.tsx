'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { EmptyState } from '@/components/admin/EmptyState';
import { TableSkeleton } from '@/components/admin/Skeleton';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { useToast } from '@/components/admin/Toast';
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
      if (!res.ok) throw new Error('Kunne ikke laste oppgaver');
      const data = await res.json();
      setTasks(data.tasks || []);
      setLoadError(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setLoadError(true);
      setTasks([]);
      toast(err instanceof Error ? err.message : 'Kunne ikke laste oppgaver', 'error');
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
        toast(data.error || 'Kunne ikke opprette oppgave', 'error');
        return;
      }
      toast('Oppgave opprettet', 'success');
      setTitle('');
      setDueAt('');
      setNewAssigneeTouched(false);
      await load();
    } catch {
      toast('Kunne ikke opprette oppgave', 'error');
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
      toast(data.error || 'Kunne ikke oppdatere oppgave', 'error');
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
        toast('Oppgave oppdatert', 'success');
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
        toast(data.error || 'Kunne ikke slette oppgave', 'error');
        return;
      }
      toast('Oppgave slettet', 'success');
      setDeleteTarget(null);
      await load();
    } catch {
      toast('Kunne ikke slette oppgave', 'error');
    } finally {
      setDeleting(false);
    }
  }

  const overdue = (t: TaskRow) => t.status === 'open' && t.dueAt !== null && isOverdue(t.dueAt);
  const emptyDescription =
    assigneeFilter === 'me' ? 'Du har ingen oppgaver her. Velg «Alle» for å se hele teamets oppgaver.'
      : 'Opprett oppgaver her eller fra en kontakt.';

  return (
    <div>
      <CrmTabs />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="inline-flex rounded-md border border-gray-300 overflow-hidden text-sm" role="group" aria-label="Ansvarlig">
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
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ny oppgave …"
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
          value={effectiveNewAssignee}
          onChange={(v) => { setNewAssignee(v); setNewAssigneeTouched(true); }}
          className="border border-gray-300 rounded-md px-2 py-2 text-sm bg-white"
        />
        <button
          type="submit"
          disabled={!title.trim() || creating}
          className="bg-bjerke-blue text-white px-4 py-2 rounded-md text-sm disabled:opacity-50"
        >
          {creating ? 'Legger til …' : 'Legg til'}
        </button>
      </form>

      {loading ? (
        <TableSkeleton rows={8} />
      ) : loadError ? (
        <EmptyState
          title="Kunne ikke laste oppgaver"
          description="Noe gikk galt under henting av oppgaver. Prøv igjen."
          action={{ label: 'Prøv igjen', onClick: () => load() }}
        />
      ) : tasks.length === 0 ? (
        <EmptyState title="Ingen oppgaver" description={emptyDescription} />
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
                        aria-label="Fullført"
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
        title="Slett oppgave"
        message={deleteTarget ? `Slette «${deleteTarget.title}»?` : ''}
        confirmLabel="Slett"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
