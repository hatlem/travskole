'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/admin/Toast';
import { CardSkeleton } from '@/components/admin/Skeleton';
import { useModalEscape } from '@/components/admin/useModalEscape';

interface EnrollmentRow {
  id: number;
  status: string;
  enteredAt: string;
  finishedAt: string | null;
  contact: { id: number; name: string };
}

const STATUS_LABELS_NO: Record<string, string> = {
  active: 'Underveis',
  completed: 'Ferdig',
  exited: 'Tatt ut',
  failed: 'Stoppet (feil)',
};

function fmtDate(d: string | null): string {
  return d ? new Date(d).toLocaleDateString('nb-NO') : '—';
}

/** Teller for «personer i flyten» i verktøylinjen; klikk åpner listen (GET /enrollments). */
export function EnrollmentPanel({ flowId }: { flowId: number }) {
  const { toast } = useToast();
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  useModalEscape(modalOpen, () => setModalOpen(false));
  const abortRef = useRef<AbortController | null>(null);
  const pageSize = 50;

  const load = useCallback(
    async (targetPage: number) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/crm/flows/${flowId}/enrollments?page=${targetPage}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error('Listen over personer i flyten kunne ikke hentes. Last siden på nytt.');
        const data = await res.json();
        setEnrollments(data.enrollments ?? []);
        setTotal(data.total ?? 0);
        setActive(data.active ?? 0);
        setPage(data.page ?? targetPage);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        toast(err instanceof Error ? err.message : 'Listen over personer i flyten kunne ikke hentes. Last siden på nytt.', 'error');
      } finally {
        if (abortRef.current === controller) {
          setLoading(false);
          setInitialLoading(false);
        }
      }
    },
    [flowId, toast],
  );

  useEffect(() => {
    const t = setTimeout(() => load(1), 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        className="border border-gray-300 px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-50 whitespace-nowrap"
        title="Se hvem som er med i flyten. «Underveis» venter fortsatt på flere e-poster."
      >
        {active ?? 0} underveis · {total ?? 0} totalt
      </button>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <div className="fixed inset-0 bg-black/50" />
          <div className="relative w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">Personer i flyten</h3>
              <button
                onClick={() => setModalOpen(false)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Lukk"
              >
                &times;
              </button>
            </div>

            {initialLoading ? (
              <CardSkeleton />
            ) : enrollments.length === 0 ? (
              <p className="text-sm text-gray-500">Ingen har vært med i flyten ennå. Folk blir med når flyten er aktiv og startregelen slår inn, eller når du legger dem til selv.</p>
            ) : (
              <>
                <ul className="space-y-1.5 max-h-96 overflow-y-auto">
                  {enrollments.map((e) => (
                    <li
                      key={e.id}
                      className="flex items-center justify-between text-sm border-b border-gray-100 py-1.5 last:border-b-0"
                    >
                      <span className="text-gray-800">{e.contact.name}</span>
                      <span className="text-gray-500">
                        {STATUS_LABELS_NO[e.status] ?? e.status} · {fmtDate(e.enteredAt)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex items-center justify-between text-sm">
                  <button
                    onClick={() => load(page - 1)}
                    disabled={loading || page <= 1}
                    className="text-blue-700 hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    Forrige
                  </button>
                  <span className="text-gray-500">Side {page}</span>
                  <button
                    onClick={() => load(page + 1)}
                    disabled={loading || page * pageSize >= (total ?? 0)}
                    className="text-blue-700 hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    Neste
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
