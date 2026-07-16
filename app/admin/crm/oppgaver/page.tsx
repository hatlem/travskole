'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { EmptyState } from '@/components/admin/EmptyState';
import { TableSkeleton } from '@/components/admin/Skeleton';
import { useToast } from '@/components/admin/Toast';

interface TaskRow {
  id: number;
  title: string;
  dueAt: string | null;
  status: string;
  contact: { id: number; name: string } | null;
  assignee: { id: number; email: string } | null;
}

export default function OppgaverPage() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('open');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [creating, setCreating] = useState(false);
  const [updatingIds, setUpdatingIds] = useState<Set<number>>(new Set());
  const { toast } = useToast();
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
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
  }, [statusFilter, toast]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function createTask() {
    if (!title.trim()) return;
    if (creating) return;

    setCreating(true);
    try {
      const res = await fetch('/api/admin/crm/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Kunne ikke opprette oppgave', 'error');
        return;
      }
      toast('Oppgave opprettet', 'success');
      setTitle('');
      setDueAt('');
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function toggle(task: TaskRow) {
    if (updatingIds.has(task.id)) return;

    setUpdatingIds((prev) => {
      const next = new Set(prev);
      next.add(task.id);
      return next;
    });
    try {
      const res = await fetch(`/api/admin/crm/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: task.status === 'done' ? 'open' : 'done' }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Kunne ikke oppdatere oppgave', 'error');
        return;
      }
      await load();
    } finally {
      setUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }
  }

  const isOverdue = (dueAtStr: string): boolean => {
    const dueDate = new Date(dueAtStr);
    const today = new Date();
    // Compare date-only: extract local date components
    const dueDateLocal = new Date(
      dueDate.getFullYear(),
      dueDate.getMonth(),
      dueDate.getDate(),
    );
    const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return dueDateLocal < todayLocal;
  };

  const overdue = (t: TaskRow) =>
    t.status === 'open' && t.dueAt !== null && isOverdue(t.dueAt);

  return (
    <div>
      <CrmTabs />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
        >
          <option value="open">Åpne</option>
          <option value="done">Fullførte</option>
          <option value="">Alle</option>
        </select>
        <div className="ml-auto flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ny oppgave …"
            className="border border-gray-300 rounded-md px-3 py-2 text-sm w-64"
          />
          <input
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="border border-gray-300 rounded-md px-2 py-2 text-sm"
          />
          <button
            onClick={createTask}
            disabled={!title.trim() || creating}
            className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50"
          >
            Legg til
          </button>
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={8} />
      ) : loadError ? (
        <EmptyState
          title="Kunne ikke laste oppgaver"
          description="Noe gikk galt under henting av oppgaver. Prøv igjen."
          action={{ label: 'Prøv igjen', onClick: () => load() }}
        />
      ) : tasks.length === 0 ? (
        <EmptyState
          title="Ingen oppgaver"
          description="Opprett oppgaver her eller fra en kontakt."
        />
      ) : (
        <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <input
                type="checkbox"
                checked={t.status === 'done'}
                onChange={() => toggle(t)}
                disabled={updatingIds.has(t.id)}
              />
              <span
                className={t.status === 'done' ? 'line-through text-gray-400' : ''}
              >
                {t.title}
              </span>
              {t.contact && (
                <Link
                  href={`/admin/crm/kontakter/${t.contact.id}`}
                  className="text-blue-700 hover:underline text-xs"
                >
                  {t.contact.name}
                </Link>
              )}
              <span
                className={`ml-auto text-xs ${
                  overdue(t)
                    ? 'text-red-600 font-semibold'
                    : 'text-gray-500'
                }`}
              >
                {t.dueAt ? new Date(t.dueAt).toLocaleDateString('nb-NO') : ''}
                {overdue(t) && ' (forfalt)'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
