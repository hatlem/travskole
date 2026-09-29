'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TableSkeleton } from '@/components/admin/Skeleton';
import { EmptyState } from '@/components/admin/EmptyState';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { useToast } from '@/components/admin/Toast';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { canDeleteStatus, isTemplateStatus } from '@/lib/flows/status';
import { DEFAULT_FLOW_SETTINGS, FlowSettingsFields, type FlowSettingsValues } from './flow-settings-fields';

interface FlowRow {
  id: number;
  name: string;
  description: string | null;
  status: string;
  isMarketing: boolean;
  anchorMode: string;
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
  template: 'Mal',
};

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  active: 'bg-green-100 text-green-700',
  paused: 'bg-amber-100 text-amber-700',
  archived: 'bg-gray-100 text-gray-500',
  template: 'bg-indigo-100 text-indigo-700',
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

const ANCHOR_LABELS: Record<string, string> = { contact: 'Kontakt', course: 'Kurs' };

export default function FlyterPage() {
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newSettings, setNewSettings] = useState<FlowSettingsValues>(DEFAULT_FLOW_SETTINGS);
  const [creating, setCreating] = useState(false);
  const [showFromTemplate, setShowFromTemplate] = useState(false);
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
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
    if (!newSettings.name.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/admin/crm/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSettings.name.trim(),
          description: newSettings.description.trim() || null,
          isMarketing: newSettings.isMarketing,
          anchorMode: newSettings.anchorMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Kunne ikke opprette flyt', 'error');
        return;
      }
      toast('Flyt opprettet', 'success');
      setShowNew(false);
      setNewSettings(DEFAULT_FLOW_SETTINGS);
      router.push(`/admin/crm/flyter/${data.flow.id}`);
    } catch {
      toast('Kunne ikke opprette flyt', 'error');
    } finally {
      setCreating(false);
    }
  }

  async function createFromTemplate(template: FlowRow) {
    await withPending(template.id, async () => {
      try {
        const res = await fetch(`/api/admin/crm/flows/${template.id}/clone`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: 'draft', name: template.name }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast(data.error || 'Kunne ikke opprette flyt fra mal', 'error');
          return;
        }
        toast('Ny flyt opprettet fra mal', 'success');
        router.push(`/admin/crm/flyter/${data.flow.id}`);
      } catch {
        toast('Kunne ikke opprette flyt fra mal', 'error');
      }
    });
  }

  async function saveRename() {
    if (!renaming || !renaming.name.trim()) return;
    const { id, name } = renaming;
    await withPending(id, async () => {
      try {
        const res = await fetch(`/api/admin/crm/flows/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast(data.error || 'Kunne ikke endre navn', 'error');
          return;
        }
        setRenaming(null);
        toast('Navn endret', 'success');
        load();
      } catch {
        toast('Kunne ikke endre navn', 'error');
      }
    });
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
        toast(isTemplateStatus(flow.status) ? 'Mal slettet' : 'Flyt slettet', 'success');
      }
      setConfirmAction(null);
      load();
    } catch {
      toast(type === 'archive' ? 'Kunne ikke arkivere flyt' : 'Kunne ikke slette flyt', 'error');
    } finally {
      setConfirmLoading(false);
    }
  }

  const regularFlows = flows.filter((f) => !isTemplateStatus(f.status));
  const templates = flows.filter((f) => isTemplateStatus(f.status));

  return (
    <div>
      <CrmTabs />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className="text-sm text-gray-500">
          {regularFlows.length} flyter · {templates.length} maler
        </span>
        <div className="ml-auto flex items-center gap-2">
          {aiConfigured && (
            <button
              onClick={() => { setShowNew(false); setShowFromTemplate(false); setShowGenerate((v) => !v); }}
              className="bg-purple-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-purple-700"
            >
              Generer med KI
            </button>
          )}
          <button
            onClick={() => { setShowGenerate(false); setShowNew(false); setShowFromTemplate((v) => !v); }}
            disabled={templates.length === 0}
            title={templates.length === 0 ? 'Lagre en flyt som mal fra flyt-editoren først' : undefined}
            className="border border-gray-300 px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            Ny flyt fra mal
          </button>
          <button
            onClick={() => { setShowGenerate(false); setShowFromTemplate(false); setShowNew(true); }}
            className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
          >
            Ny flyt
          </button>
        </div>
      </div>

      {showFromTemplate && templates.length > 0 && (
        <div className="border border-gray-200 rounded-lg p-4 mb-4 bg-indigo-50">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-800">Velg mal</h3>
            <button onClick={() => setShowFromTemplate(false)} className="text-sm text-gray-600">
              Avbryt
            </button>
          </div>
          <p className="text-xs text-gray-600 mb-3">
            Malen kopieres til et nytt utkast med noder, koblinger, utløsere og innstillinger. Malen selv endres ikke.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {templates.map((template) => (
              <li key={template.id}>
                <button
                  onClick={() => createFromTemplate(template)}
                  disabled={pendingIds.has(template.id)}
                  className="w-full text-left bg-white border border-gray-200 rounded-md px-3 py-2 text-sm hover:border-indigo-400 disabled:opacity-50"
                >
                  <span className="font-medium text-gray-900">{template.name}</span>
                  {template.description && (
                    <span className="block text-xs text-gray-500 truncate">{template.description}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

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
        <div className="border border-gray-200 rounded-lg p-4 mb-4 bg-gray-50 max-w-xl">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">Ny flyt</h3>
          <FlowSettingsFields
            idPrefix="new-flow"
            values={newSettings}
            onChange={(patch) => setNewSettings((prev) => ({ ...prev, ...patch }))}
          />
          <div className="mt-4 flex gap-2">
            <button
              onClick={createFlow}
              disabled={!newSettings.name.trim() || creating}
              className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50"
            >
              {creating ? 'Oppretter …' : 'Opprett'}
            </button>
            <button
              onClick={() => { setShowNew(false); setNewSettings(DEFAULT_FLOW_SETTINGS); }}
              className="text-sm text-gray-600 px-2 py-2"
            >
              Avbryt
            </button>
          </div>
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
      ) : (
        <>
          {regularFlows.length === 0 ? (
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
                    <th className="px-4 py-3 font-medium">Forankring</th>
                    <th className="px-4 py-3 font-medium">Sist endret</th>
                    <th className="px-4 py-3 font-medium">Handlinger</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {regularFlows.map((flow) => {
                    const isPending = pendingIds.has(flow.id);
                    const canToggle = flow.status === 'active' || flow.status === 'paused';
                    const canDelete = canDeleteStatus(flow.status);
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
                        <td className="px-4 py-3 text-gray-600">{ANCHOR_LABELS[flow.anchorMode] ?? flow.anchorMode}</td>
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

          <section className="mt-8">
            <h2 className="text-sm font-semibold text-gray-800">Maler</h2>
            <p className="text-xs text-gray-500 mb-3">
              Maler kan ikke aktiveres eller få påmeldinger. Lagre en flyt som mal fra flyt-editoren, og bruk «Ny flyt fra mal» for å starte en ny flyt fra den.
            </p>
            {templates.length === 0 ? (
              <p className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg px-4 py-6 text-center">
                Ingen maler ennå.
              </p>
            ) : (
              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-left text-gray-600">
                    <tr>
                      <th className="px-4 py-3 font-medium">Navn</th>
                      <th className="px-4 py-3 font-medium">Markedsføring</th>
                      <th className="px-4 py-3 font-medium">Forankring</th>
                      <th className="px-4 py-3 font-medium">Sist endret</th>
                      <th className="px-4 py-3 font-medium">Handlinger</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {templates.map((template) => {
                      const isPending = pendingIds.has(template.id);
                      const isRenaming = renaming?.id === template.id;
                      return (
                        <tr key={template.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            {isRenaming ? (
                              <div className="flex items-center gap-2">
                                <input
                                  autoFocus
                                  aria-label="Nytt navn"
                                  value={renaming.name}
                                  maxLength={200}
                                  onChange={(e) => setRenaming({ id: template.id, name: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveRename();
                                    if (e.key === 'Escape') setRenaming(null);
                                  }}
                                  className="border border-gray-300 rounded-md px-2 py-1 text-sm"
                                />
                                <button
                                  onClick={saveRename}
                                  disabled={isPending || !renaming.name.trim()}
                                  className="text-blue-700 hover:underline disabled:opacity-50"
                                >
                                  Lagre
                                </button>
                                <button onClick={() => setRenaming(null)} className="text-gray-600 hover:underline">
                                  Avbryt
                                </button>
                              </div>
                            ) : (
                              <>
                                <Link
                                  href={`/admin/crm/flyter/${template.id}`}
                                  className="font-medium text-blue-700 hover:underline"
                                >
                                  {template.name}
                                </Link>
                                {template.description && (
                                  <span className="block text-xs text-gray-500">{template.description}</span>
                                )}
                              </>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-600">{template.isMarketing ? 'Ja' : 'Nei'}</td>
                          <td className="px-4 py-3 text-gray-600">
                            {ANCHOR_LABELS[template.anchorMode] ?? template.anchorMode}
                          </td>
                          <td className="px-4 py-3 text-gray-500">
                            {new Date(template.updatedAt).toLocaleDateString('nb-NO')}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-3">
                              <button
                                onClick={() => createFromTemplate(template)}
                                disabled={isPending}
                                className="text-blue-700 hover:underline disabled:opacity-50"
                              >
                                Bruk mal
                              </button>
                              <Link
                                href={`/admin/crm/flyter/${template.id}`}
                                className="text-gray-700 hover:underline"
                              >
                                Rediger
                              </Link>
                              <button
                                onClick={() => setRenaming({ id: template.id, name: template.name })}
                                disabled={isPending}
                                className="text-gray-700 hover:underline disabled:opacity-50"
                              >
                                Gi nytt navn
                              </button>
                              <button
                                onClick={() => setConfirmAction({ type: 'delete', flow: template })}
                                disabled={isPending}
                                className="text-red-600 hover:underline disabled:opacity-50"
                              >
                                Slett
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <ConfirmModal
        open={confirmAction !== null}
        title={
          confirmAction?.type === 'delete'
            ? isTemplateStatus(confirmAction.flow.status) ? 'Slett mal' : 'Slett flyt'
            : 'Arkiver flyt'
        }
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
