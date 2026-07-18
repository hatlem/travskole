'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TableSkeleton } from '@/components/admin/Skeleton';
import { EmptyState } from '@/components/admin/EmptyState';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { useToast } from '@/components/admin/Toast';
import { ConfirmModal } from '@/components/admin/ConfirmModal';

interface FlowRow {
  id: number;
  name: string;
  status: string;
  isMarketing: boolean;
  activeEnrollments: number;
  updatedAt: string;
}

interface SenderIdentityOption {
  id: number;
  email: string;
  displayName: string;
}

interface ValidationError {
  nodeId: number | null;
  code: string;
  message: string;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Utkast',
  active: 'Aktiv',
  paused: 'Pauset',
  archived: 'Arkivert',
};

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  active: 'bg-green-100 text-green-700',
  paused: 'bg-amber-100 text-amber-700',
  archived: 'bg-gray-100 text-gray-500',
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? STATUS_STYLES.draft;
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

type ConfirmAction = { type: 'archive' | 'delete'; flow: FlowRow };

export default function FlyterPage() {
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [goal, setGoal] = useState('');
  const [emailCount, setEmailCount] = useState(2);
  const [senderIdentityId, setSenderIdentityId] = useState<number | ''>('');
  const [senderIdentities, setSenderIdentities] = useState<SenderIdentityOption[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const { toast } = useToast();
  const abortRef = useRef<AbortController | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const res = await fetch('/api/admin/crm/flows', { signal: controller.signal });
      if (!res.ok) throw new Error('Kunne ikke laste flyter');
      const data = await res.json();
      setFlows(data.flows || []);
      setLoadError(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setLoadError(true);
      setFlows([]);
      toast(err instanceof Error ? err.message : 'Kunne ikke laste flyter', 'error');
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  }, [toast]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    const loadAiStatus = async () => {
      try {
        const res = await fetch('/api/admin/crm/ai/status');
        if (res.ok) {
          const data = await res.json();
          setAiConfigured(Boolean(data.configured));
        }
      } catch { /* KI-status er valgfri — feiler stille */ }
    };
    const t = setTimeout(loadAiStatus, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!showGenerate || senderIdentities.length > 0) return;
    const loadSenderIdentities = async () => {
      try {
        const res = await fetch('/api/admin/crm/sender-identities');
        if (!res.ok) return;
        const data = await res.json();
        const identities: SenderIdentityOption[] = Array.isArray(data.identities)
          ? data.identities.filter((i: { active?: boolean }) => i.active !== false)
          : [];
        setSenderIdentities(identities);
        setSenderIdentityId((prev) => (prev === '' && identities.length > 0 ? identities[0].id : prev));
      } catch { /* håndteres ved innsending */ }
    };
    const t = setTimeout(loadSenderIdentities, 0);
    return () => clearTimeout(t);
  }, [showGenerate, senderIdentities.length]);

  function withPending<T>(id: number, fn: () => Promise<T>): Promise<T> {
    setPendingIds((prev) => new Set(prev).add(id));
    return fn().finally(() => {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    });
  }

  async function createFlow() {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/admin/crm/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Kunne ikke opprette flyt', 'error');
        return;
      }
      toast('Flyt opprettet', 'success');
      setShowNew(false);
      setNewName('');
      router.push(`/admin/crm/flyter/${data.flow.id}`);
    } catch {
      toast('Kunne ikke opprette flyt', 'error');
    } finally {
      setCreating(false);
    }
  }

  async function generateFlow() {
    if (goal.trim().length < 10 || senderIdentityId === '' || generating) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch('/api/admin/crm/ai/generate-flow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: goal.trim(),
          emailCount,
          senderIdentityId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGenerateError(data.error || 'Kunne ikke generere flyt');
        return;
      }
      router.push(`/admin/crm/flyter/${data.flowId}`);
    } catch {
      setGenerateError('Kunne ikke generere flyt');
    } finally {
      setGenerating(false);
    }
  }

  async function toggleStatus(flow: FlowRow) {
    const nextStatus = flow.status === 'active' ? 'paused' : 'active';
    await withPending(flow.id, async () => {
      try {
        const res = await fetch(`/api/admin/crm/flows/${flow.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: nextStatus }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (Array.isArray(data.errors) && data.errors.length > 0) {
            (data.errors as ValidationError[]).forEach((e) => toast(e.message, 'error'));
          } else {
            toast(data.error || 'Kunne ikke endre status', 'error');
          }
          return;
        }
        toast(
          nextStatus === 'active' ? 'Flyt gjenopptatt' : 'Flyt satt på pause',
          'success',
        );
        load();
      } catch {
        toast('Kunne ikke endre status', 'error');
      }
    });
  }

  async function runConfirmedAction() {
    if (!confirmAction) return;
    const { type, flow } = confirmAction;
    setConfirmLoading(true);
    try {
      if (type === 'archive') {
        const res = await fetch(`/api/admin/crm/flows/${flow.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'archived' }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast(data.error || 'Kunne ikke arkivere flyt', 'error');
          return;
        }
        toast('Flyt arkivert', 'success');
      } else {
        const res = await fetch(`/api/admin/crm/flows/${flow.id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) {
          toast(data.error || 'Kunne ikke slette flyt', 'error');
          return;
        }
        toast('Flyt slettet', 'success');
      }
      setConfirmAction(null);
      load();
    } catch {
      toast(type === 'archive' ? 'Kunne ikke arkivere flyt' : 'Kunne ikke slette flyt', 'error');
    } finally {
      setConfirmLoading(false);
    }
  }

  return (
    <div>
      <CrmTabs />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className="text-sm text-gray-500">{flows.length} flyter</span>
        <div className="ml-auto flex items-center gap-2">
          {aiConfigured && (
            <button
              onClick={() => { setShowNew(false); setShowGenerate((v) => !v); }}
              className="bg-purple-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-purple-700"
            >
              Generer med KI
            </button>
          )}
          <button
            onClick={() => { setShowGenerate(false); setShowNew(true); }}
            className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
          >
            Ny flyt
          </button>
        </div>
      </div>

      {showGenerate && (
        <div className="border border-gray-200 rounded-lg p-4 mb-4 bg-purple-50 flex flex-wrap gap-3 items-end">
          <label className="text-sm flex-1 min-w-[240px]">
            <span className="block text-gray-600 mb-1">Mål *</span>
            <textarea
              autoFocus
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="F.eks.: vinn tilbake fjorårets julebord-kunder"
              rows={2}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Antall e-poster</span>
            <input
              type="number"
              min={1}
              max={5}
              value={emailCount}
              onChange={(e) =>
                setEmailCount(Math.min(5, Math.max(1, Number(e.target.value) || 1)))
              }
              className="w-20 border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Avsender</span>
            <select
              value={senderIdentityId}
              onChange={(e) => setSenderIdentityId(e.target.value ? Number(e.target.value) : '')}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm"
            >
              <option value="">Velg avsender …</option>
              {senderIdentities.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName} ({s.email})
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={generateFlow}
            disabled={goal.trim().length < 10 || senderIdentityId === '' || generating}
            className="bg-purple-600 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50"
          >
            {generating ? 'Genererer …' : 'Generer utkast'}
          </button>
          <button
            onClick={() => {
              setShowGenerate(false);
              setGoal('');
              setEmailCount(2);
              setSenderIdentityId('');
              setGenerateError(null);
            }}
            className="text-sm text-gray-600 px-2 py-2"
          >
            Avbryt
          </button>
          {generateError && <p className="w-full text-sm text-red-600">{generateError}</p>}
        </div>
      )}

      {showNew && (
        <div className="border border-gray-200 rounded-lg p-4 mb-4 bg-gray-50 flex flex-wrap gap-3 items-end">
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Navn *</span>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createFlow();
              }}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </label>
          <button
            onClick={createFlow}
            disabled={!newName.trim() || creating}
            className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50"
          >
            {creating ? 'Oppretter …' : 'Opprett'}
          </button>
          <button
            onClick={() => { setShowNew(false); setNewName(''); }}
            className="text-sm text-gray-600 px-2 py-2"
          >
            Avbryt
          </button>
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={8} />
      ) : loadError ? (
        <EmptyState
          title="Kunne ikke laste flyter"
          description="Noe gikk galt under henting av flyter. Prøv igjen."
          action={{ label: 'Prøv igjen', onClick: () => load() }}
        />
      ) : flows.length === 0 ? (
        <EmptyState
          title="Ingen flyter ennå"
          description="Ingen flyter ennå — lag din første automatiske e-postflyt."
          action={{ label: 'Ny flyt', onClick: () => setShowNew(true) }}
        />
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">Navn</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Aktive påmeldinger</th>
                <th className="px-4 py-3 font-medium">Markedsføring</th>
                <th className="px-4 py-3 font-medium">Sist endret</th>
                <th className="px-4 py-3 font-medium">Handlinger</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {flows.map((flow) => {
                const isPending = pendingIds.has(flow.id);
                const canToggle = flow.status === 'active' || flow.status === 'paused';
                const canDelete = flow.status === 'draft' || flow.status === 'archived';
                return (
                  <tr key={flow.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/crm/flyter/${flow.id}`}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {flow.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={flow.status} />
                    </td>
                    <td className="px-4 py-3">{flow.activeEnrollments}</td>
                    <td className="px-4 py-3 text-gray-600">{flow.isMarketing ? 'Ja' : 'Nei'}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(flow.updatedAt).toLocaleDateString('nb-NO')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-3">
                        <Link
                          href={`/admin/crm/flyter/${flow.id}`}
                          className="text-blue-700 hover:underline"
                        >
                          Åpne
                        </Link>
                        {canToggle && (
                          <button
                            onClick={() => toggleStatus(flow)}
                            disabled={isPending}
                            className="text-gray-700 hover:underline disabled:opacity-50"
                          >
                            {flow.status === 'active' ? 'Pause' : 'Gjenoppta'}
                          </button>
                        )}
                        {flow.status !== 'archived' && (
                          <button
                            onClick={() => setConfirmAction({ type: 'archive', flow })}
                            disabled={isPending}
                            className="text-gray-700 hover:underline disabled:opacity-50"
                          >
                            Arkiver
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => setConfirmAction({ type: 'delete', flow })}
                            disabled={isPending}
                            className="text-red-600 hover:underline disabled:opacity-50"
                          >
                            Slett
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmModal
        open={confirmAction !== null}
        title={confirmAction?.type === 'delete' ? 'Slett flyt' : 'Arkiver flyt'}
        message={
          confirmAction?.type === 'delete'
            ? `Er du sikker på at du vil slette «${confirmAction.flow.name}»? Dette kan ikke angres.`
            : `Er du sikker på at du vil arkivere «${confirmAction?.flow.name}»?`
        }
        confirmLabel={confirmAction?.type === 'delete' ? 'Slett' : 'Arkiver'}
        variant={confirmAction?.type === 'delete' ? 'danger' : 'warning'}
        loading={confirmLoading}
        onConfirm={runConfirmedAction}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
