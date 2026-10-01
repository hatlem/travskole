'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { TableSkeleton } from '@/components/admin/Skeleton';
import { EmptyState } from '@/components/admin/EmptyState';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { useToast } from '@/components/admin/Toast';
import { useOpenFromQuery } from '@/components/admin/useOpenFromQuery';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { HelpTip } from '@/components/admin/HelpTip';
import { HINTS } from '@/lib/admin-copy';
import { FLOW_STATUS_LABELS, canDeleteStatus, isTemplateStatus } from '@/lib/flows/status';
import { deleteFlowMessage, formatNorwegianDate, groupFlows } from '@/lib/crm/flow-list';
import { RowMenu } from '@/components/admin/crm/RowMenu';
import { Button } from '@/components/admin/Button';
import { Badge } from '@/components/admin/StatusBadge';
import type { InstallResult, LegacyImportResult } from '@/lib/flows/templates/install';
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

const STATUS_LABELS = FLOW_STATUS_LABELS;

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
  return <Badge className={cls}>{label}</Badge>;
}

type ConfirmAction = { type: 'archive' | 'delete' | 'resume'; flow: FlowRow };

type TemplateAction = 'standard' | 'legacy';

type TemplateReport =
  | { kind: 'standard'; result: InstallResult }
  | { kind: 'legacy'; result: LegacyImportResult };

const LIFECYCLE_SLOT_LABELS: Record<string, string> = {
  reminder_before: 'Påminnelse før kursstart',
  welcome_start: 'Velkommen ved kursstart',
  midway: 'Halvveis i kurset',
  after_end: 'Etter kursslutt',
};

const MATCH_VIA_LABELS: Record<string, string> = {
  trigger: 'koblet via gammel startregel',
  name: 'etter navn',
  order: 'etter rekkefølge',
};

function legacyStatusMessage(result: LegacyImportResult): string {
  switch (result.status) {
    case 'created':
      return 'Malen «Kurs-livssyklus (originaltekster)» er opprettet.';
    case 'exists':
      return 'Malen med originaltekstene finnes allerede — ingenting ble endret.';
    case 'missing_table':
      return 'Fant ingen gamle kursmaler i databasen (tabellen email_templates finnes ikke).';
    case 'empty':
      return 'Tabellen med gamle kursmaler er tom — ingenting å importere.';
  }
}

const ANCHOR_LABELS: Record<string, string> = { contact: 'En person', course: 'Et kurs' };

function enrollmentText(n: number): string {
  return n === 1 ? '1 person er underveis' : `${n} personer er underveis`;
}

const typeLabel = (flow: FlowRow) => (flow.isMarketing ? 'Markedsføring' : 'Viktig info');
const anchorLabel = (flow: FlowRow) => ANCHOR_LABELS[flow.anchorMode] ?? flow.anchorMode;

/** Tabell på store skjermer, kort under md. */
function FlowList({
  flows,
  renderActions,
  muted = false,
}: {
  flows: FlowRow[];
  renderActions: (flow: FlowRow) => React.ReactNode;
  muted?: boolean;
}) {
  return (
    <>
      <ul className={`divide-y divide-gray-100 rounded-lg border border-gray-200 md:hidden ${muted ? 'bg-gray-50/60' : 'bg-white'}`}>
        {flows.map((flow) => (
          <li key={flow.id} className="px-4 py-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/admin/crm/flyter/${flow.id}`} className="min-w-0 font-medium text-gray-900 break-words hover:underline">
                {flow.name}
              </Link>
              <StatusBadge status={flow.status} />
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {typeLabel(flow)} · Gjelder {anchorLabel(flow).toLowerCase()} · Endret {formatNorwegianDate(flow.updatedAt)}
            </p>
            {flow.activeEnrollments > 0 && (
              <p className="mt-0.5 text-xs text-gray-700 tabular-nums">{enrollmentText(flow.activeEnrollments)}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">{renderActions(flow)}</div>
          </li>
        ))}
      </ul>
      <div className={`hidden overflow-x-auto rounded-lg border border-gray-200 md:block ${muted ? 'bg-gray-50/60' : ''}`}>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-3 font-medium">Navn</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">
                Underveis
                <HelpTip term="recipients" />
              </th>
              <th className="px-4 py-3 font-medium">
                Type
                <HelpTip label="Markedsføring eller viktig informasjon?">
                  Markedsføring (f.eks. «Nye kurs i høst!») går bare til de som har sagt ja. Viktig informasjon
                  (f.eks. «Praktisk info før kursstart») går til alle det gjelder.
                </HelpTip>
              </th>
              <th className="px-4 py-3 font-medium">
                Gjelder
                <HelpTip term="anchor" />
              </th>
              <th className="px-4 py-3 font-medium">Sist endret</th>
              <th className="px-4 py-3 font-medium"><span className="sr-only">Handlinger</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {flows.map((flow) => (
              <tr key={flow.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link href={`/admin/crm/flyter/${flow.id}`} className="font-medium text-blue-700 hover:underline">
                    {flow.name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={flow.status} />
                </td>
                <td className="px-4 py-3 tabular-nums">{flow.activeEnrollments}</td>
                <td className="px-4 py-3 text-gray-600">{typeLabel(flow)}</td>
                <td className="px-4 py-3 text-gray-600">{anchorLabel(flow)}</td>
                <td className="px-4 py-3 whitespace-nowrap text-gray-500">{formatNorwegianDate(flow.updatedAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">{renderActions(flow)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

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
  const [templateAction, setTemplateAction] = useState<TemplateAction | null>(null);
  const [templateSenderId, setTemplateSenderId] = useState<number | ''>('');
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateReport, setTemplateReport] = useState<TemplateReport | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const { data: session } = useSession();
  const isSuperAdmin = session?.user.role === 'superadmin';
  const { toast } = useToast();
  const abortRef = useRef<AbortController | null>(null);
  const router = useRouter();
  useOpenFromQuery('ny', () => setShowNew(true));
  useOpenFromQuery('mal', () => openTemplatePicker());

  function openTemplatePicker() {
    setShowGenerate(false);
    setShowNew(false);
    setShowFromTemplate(true);
  }

  function openNewFlow() {
    setShowGenerate(false);
    setShowFromTemplate(false);
    setShowNew(true);
  }

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const res = await fetch('/api/admin/crm/flows', { signal: controller.signal });
      if (!res.ok) throw new Error('E-postflytene kunne ikke hentes. Prøv igjen om litt.');
      const data = await res.json();
      setFlows(data.flows || []);
      setLoadError(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setLoadError(true);
      setFlows([]);
      toast(err instanceof Error ? err.message : 'E-postflytene kunne ikke hentes. Prøv igjen om litt.', 'error');
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

  const needsSenders = showGenerate || templateAction !== null;
  useEffect(() => {
    if (!needsSenders || senderIdentities.length > 0) return;
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
        setTemplateSenderId((prev) => (prev === '' && identities.length > 0 ? identities[0].id : prev));
      } catch { /* håndteres ved innsending */ }
    };
    const t = setTimeout(loadSenderIdentities, 0);
    return () => clearTimeout(t);
  }, [needsSenders, senderIdentities.length]);

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
        toast(data.error || 'Flyten ble ikke opprettet. Prøv igjen.', 'error');
        return;
      }
      toast('Flyten er opprettet. Neste steg: velg når den skal starte, og legg til en e-post.', 'success');
      setShowNew(false);
      setNewSettings(DEFAULT_FLOW_SETTINGS);
      router.push(`/admin/crm/flyter/${data.flow.id}`);
    } catch {
      toast('Flyten ble ikke opprettet. Sjekk nettforbindelsen og prøv igjen.', 'error');
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
          body: JSON.stringify({ target: 'draft', name: template.name.replace(/ \(mal\)$/, '') }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast(data.error || 'Flyten ble ikke laget fra malen. Prøv igjen.', 'error');
          return;
        }
        toast('Ny flyt laget fra malen. Se over tekstene, og aktiver når du er fornøyd.', 'success');
        router.push(`/admin/crm/flyter/${data.flow.id}`);
      } catch {
        toast('Flyten ble ikke laget fra malen. Sjekk nettforbindelsen og prøv igjen.', 'error');
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
          toast(data.error || 'Navnet ble ikke endret. Prøv igjen.', 'error');
          return;
        }
        setRenaming(null);
        toast(`Navnet er endret til «${name.trim()}».`, 'success');
        load();
      } catch {
        toast('Navnet ble ikke endret. Sjekk nettforbindelsen og prøv igjen.', 'error');
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
        setGenerateError(data.error || 'KI klarte ikke å lage et utkast. Prøv å beskrive målet litt annerledes.');
        return;
      }
      router.push(`/admin/crm/flyter/${data.flowId}`);
    } catch {
      setGenerateError('KI-utkastet ble ikke laget. Sjekk nettforbindelsen og prøv igjen.');
    } finally {
      setGenerating(false);
    }
  }

  async function runTemplateAction() {
    if (!templateAction || templateSenderId === '' || templateBusy) return;
    const action = templateAction;
    setTemplateBusy(true);
    try {
      const url = action === 'standard' ? '/api/admin/crm/flows/templates' : '/api/admin/crm/flows/templates/legacy';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderIdentityId: templateSenderId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Malene ble ikke lagt til. Prøv igjen.', 'error');
        return;
      }
      if (action === 'standard') {
        const result = data as InstallResult;
        setTemplateReport({ kind: 'standard', result });
        toast(
          result.created.length > 0
            ? `${result.created.length} ferdige maler er lagt til. Velg «Bruk mal» for å lage en flyt fra en av dem.`
            : 'Alle de ferdige malene finnes allerede.',
          'success',
        );
      } else {
        const result = data as LegacyImportResult;
        setTemplateReport({ kind: 'legacy', result });
        toast(legacyStatusMessage(result), result.status === 'created' || result.status === 'exists' ? 'success' : 'error');
      }
      setTemplateAction(null);
      load();
    } catch {
      toast('Malene ble ikke lagt til. Sjekk nettforbindelsen og prøv igjen.', 'error');
    } finally {
      setTemplateBusy(false);
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
            toast(data.error || 'Statusen ble ikke endret. Prøv igjen.', 'error');
          }
          return;
        }
        toast(
          nextStatus === 'active'
            ? `«${flow.name}» går igjen. E-postene fortsetter der de stoppet.`
            : `«${flow.name}» står på pause. Ingen e-poster sendes før du gjenopptar.`,
          'success',
        );
        load();
      } catch {
        toast('Statusen ble ikke endret. Sjekk nettforbindelsen og prøv igjen.', 'error');
      }
    });
  }

  async function runConfirmedAction() {
    if (!confirmAction) return;
    const { type, flow } = confirmAction;
    if (type === 'resume') {
      setConfirmAction(null);
      await toggleStatus(flow);
      return;
    }
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
          toast(data.error || 'Flyten ble ikke arkivert. Prøv igjen.', 'error');
          return;
        }
        toast(
          data.exitedEnrollments > 0
            ? `«${flow.name}» er arkivert. ${data.exitedEnrollments === 1 ? '1 person' : `${data.exitedEnrollments} personer`} som var underveis, får ingen flere e-poster.`
            : `«${flow.name}» er arkivert og sender ingen flere e-poster.`,
          'success'
        );
      } else {
        const res = await fetch(`/api/admin/crm/flows/${flow.id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) {
          toast(data.error || 'Den ble ikke slettet. Prøv igjen.', 'error');
          return;
        }
        toast(isTemplateStatus(flow.status) ? `Malen «${flow.name}» er slettet.` : `«${flow.name}» er slettet.`, 'success');
      }
      setConfirmAction(null);
      load();
    } catch {
      toast(
        type === 'archive'
          ? 'Flyten ble ikke arkivert. Sjekk nettforbindelsen og prøv igjen.'
          : 'Den ble ikke slettet. Sjekk nettforbindelsen og prøv igjen.',
        'error',
      );
    } finally {
      setConfirmLoading(false);
    }
  }

  const { current: regularFlows, archived: archivedFlows, templates } = groupFlows(flows);

  function renderFlowActions(flow: FlowRow) {
    const isPending = pendingIds.has(flow.id);
    const canDelete = canDeleteStatus(flow.status);
    if (flow.status === 'archived') {
      return canDelete ? (
        <Button variant="dangerText" size="sm" onClick={() => setConfirmAction({ type: 'delete', flow })} disabled={isPending}>
          Slett
        </Button>
      ) : null;
    }
    const menuItems = [
      { label: 'Arkiver', onSelect: () => setConfirmAction({ type: 'archive', flow }) },
      ...(canDelete ? [{ label: 'Slett', danger: true, onSelect: () => setConfirmAction({ type: 'delete', flow }) }] : []),
    ];
    return (
      <>
        {(flow.status === 'active' || flow.status === 'paused') && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => (flow.status === 'active' ? toggleStatus(flow) : setConfirmAction({ type: 'resume', flow }))}
            disabled={isPending}
            className="whitespace-nowrap"
          >
            {flow.status === 'active' ? 'Sett på pause' : 'Gjenoppta'}
          </Button>
        )}
        <RowMenu label={`Flere valg for ${flow.name}`} disabled={isPending} items={menuItems} />
      </>
    );
  }

  return (
    <div>
      <CrmTabs
        actions={
          <>
            {aiConfigured && (
              <Button
                variant="secondary"
                onClick={() => { setShowNew(false); setShowFromTemplate(false); setShowGenerate((v) => !v); }}
              >
                Lag utkast med KI
              </Button>
            )}
            <Button variant="secondary" onClick={() => (showFromTemplate ? setShowFromTemplate(false) : openTemplatePicker())}>
              Start fra en mal
            </Button>
            <Button variant={showNew || showFromTemplate || showGenerate ? 'secondary' : 'primary'} onClick={openNewFlow}>Ny e-postflyt</Button>
          </>
        }
      />

      {showFromTemplate && !loading && (
        <div className="border border-gray-200 rounded-lg p-4 mb-4 bg-indigo-50">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-800">Velg en mal å starte fra</h3>
            <Button variant="secondary" size="sm" onClick={() => setShowFromTemplate(false)}>
              Avbryt
            </Button>
          </div>
          {templates.length === 0 ? (
            <div className="text-sm text-gray-700">
              <p>Det finnes ingen maler ennå.</p>
              {isSuperAdmin ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => { setShowFromTemplate(false); setTemplateReport(null); setTemplateAction('standard'); }}
                  className="mt-2"
                >
                  Legg til de ferdige malene
                </Button>
              ) : (
                <p className="mt-1 text-gray-600">
                  Be en superadmin legge til de ferdige malene, eller trykk «Ny e-postflyt» for å lage en fra bunnen.
                </p>
              )}
            </div>
          ) : (
          <>
          <p className="text-xs text-gray-600 mb-3">
            Du får en kopi med alle stegene, startreglene og innstillingene fra malen. Kopien er et utkast — ingenting
            sendes før du aktiverer den. Malen selv endres ikke.
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
          </>
          )}
        </div>
      )}

      {showGenerate && (
        <div className="border border-gray-200 rounded-lg p-4 mb-4 bg-purple-50 flex flex-wrap gap-3 items-end">
          <label className="text-sm flex-1 min-w-[240px]">
            <span className="block text-gray-600 mb-1">Hva skal flyten oppnå?</span>
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
          <Button
            onClick={generateFlow}
            disabled={goal.trim().length < 10 || senderIdentityId === ''}
            loading={generating}
            loadingLabel="Lager utkast …"
          >
            Lag utkast
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setShowGenerate(false);
              setGoal('');
              setEmailCount(2);
              setSenderIdentityId('');
              setGenerateError(null);
            }}
          >
            Avbryt
          </Button>
          <p className="w-full text-xs text-gray-600">
            KI lager et utkast du kan se over og endre. Ingenting sendes før du aktiverer flyten.
          </p>
          {generateError && <p className="w-full text-sm text-red-600">{generateError}</p>}
        </div>
      )}

      {showNew && (
        <div className="border border-gray-200 rounded-lg p-4 mb-4 bg-gray-50 max-w-xl">
          <h3 className="text-sm font-semibold text-gray-800">Ny e-postflyt</h3>
          <p className="mb-3 text-xs text-gray-600">{HINTS.startFromTemplate}</p>
          <FlowSettingsFields
            idPrefix="new-flow"
            values={newSettings}
            onChange={(patch) => setNewSettings((prev) => ({ ...prev, ...patch }))}
          />
          <div className="mt-4 flex gap-2">
            <Button
              onClick={createFlow}
              disabled={!newSettings.name.trim()}
              loading={creating}
              loadingLabel="Lager flyten …"
            >
              Lag flyten
            </Button>
            <Button variant="secondary" onClick={() => { setShowNew(false); setNewSettings(DEFAULT_FLOW_SETTINGS); }}>
              Avbryt
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={8} />
      ) : loadError ? (
        <EmptyState
          title="E-postflytene kunne ikke hentes"
          description="Det kan skyldes et brudd i nettforbindelsen. Prøv igjen — kontakt den tekniske ansvarlige hvis det fortsetter."
          action={{ label: 'Prøv igjen', onClick: () => load() }}
        />
      ) : (
        <>
          {regularFlows.length === 0 ? (
            <EmptyState
              icon="email"
              title="Lag din første e-postflyt"
              description="En e-postflyt sender e-poster av seg selv — for eksempel velkomst rett etter påmelding og en påminnelse før kursstart. Det enkleste er å starte fra en ferdig mal."
              action={{ label: 'Start fra en mal', onClick: openTemplatePicker }}
              secondaryAction={{ label: 'Lag fra bunnen', onClick: openNewFlow }}
            />
          ) : (
            <FlowList flows={regularFlows} renderActions={renderFlowActions} />
          )}

          {archivedFlows.length > 0 && (
            <section className="mt-6" aria-labelledby="arkivert-heading">
              <h2 id="arkivert-heading" className="text-sm font-semibold text-gray-800">
                <button
                  type="button"
                  onClick={() => setShowArchived((v) => !v)}
                  aria-expanded={showArchived}
                  aria-controls="arkivert-liste"
                  className="inline-flex min-h-9 items-center gap-2 rounded-md px-1 hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bjerke-blue"
                >
                  <span aria-hidden="true" className={`inline-block text-xs text-gray-500 transition-transform duration-150 ${showArchived ? 'rotate-90' : ''}`}>▶</span>
                  Arkivert
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 tabular-nums">
                    {archivedFlows.length}
                  </span>
                </button>
              </h2>
              {showArchived && (
                <div id="arkivert-liste" className="mt-2">
                  <p className="mb-2 text-xs text-gray-500">
                    Arkiverte flyter sender ingenting og kan ikke startes igjen. Du kan åpne dem for å se oppsettet, eller slette dem.
                  </p>
                  <FlowList flows={archivedFlows} renderActions={renderFlowActions} muted />
                </div>
              )}
            </section>
          )}

          <section className="mt-8">
            <div className="flex flex-wrap items-start gap-3 mb-3">
              <div className="flex-1 min-w-[240px]">
                <h2 className="text-sm font-semibold text-gray-800">
                  Maler
                  <HelpTip term="template" />
                </h2>
                <p className="text-xs text-gray-500">
                  Ferdige oppsett du kan kopiere. Maler sender aldri e-post selv. Trykk «Bruk mal» for å lage en ny flyt
                  fra en mal, eller «Lagre som mal» inne i en flyt for å lage din egen.
                </p>
              </div>
              {isSuperAdmin && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => { setTemplateReport(null); setTemplateAction((a) => (a === 'standard' ? null : 'standard')); }}
                  >
                    Legg til ferdige maler
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => { setTemplateReport(null); setTemplateAction((a) => (a === 'legacy' ? null : 'legacy')); }}
                  >
                    Importer gamle kursmaler
                  </Button>
                </div>
              )}
            </div>

            {templateAction && (
              <div className="border border-gray-200 rounded-lg p-4 mb-3 bg-indigo-50">
                <h3 className="text-sm font-semibold text-gray-800 mb-1">
                  {templateAction === 'standard' ? 'Legg til ferdige maler' : 'Importer gamle kursmaler'}
                </h3>
                <p className="text-xs text-gray-600 mb-3">
                  {templateAction === 'standard'
                    ? 'Legger til «Gjenbooking julebord/firmafest», «Oppfølging av forespørsel», «Etter arrangementet» og «Velkommen ny kontakt» som maler. Maler som allerede finnes, hoppes over. Ingenting sendes.'
                    : 'Lager malen «Kurs-livssyklus (originaltekster)» med tekstene fra det gamle systemet for kurs-e-post. Flyten som brukes i dag, endres ikke.'}
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-sm">
                    <span className="block text-gray-600 mb-1">Avsender for e-postene</span>
                    <select
                      value={templateSenderId}
                      onChange={(e) => setTemplateSenderId(e.target.value ? Number(e.target.value) : '')}
                      className="border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                    >
                      <option value="">Velg avsender …</option>
                      {senderIdentities.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.displayName} ({s.email})
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    onClick={runTemplateAction}
                    disabled={templateSenderId === ''}
                    loading={templateBusy}
                    loadingLabel="Jobber …"
                  >
                    {templateAction === 'standard' ? 'Legg til maler' : 'Importer'}
                  </Button>
                  <Button variant="secondary" onClick={() => setTemplateAction(null)}>
                    Avbryt
                  </Button>
                </div>
              </div>
            )}

            {templateReport && (
              <div className="border border-gray-200 rounded-lg p-4 mb-3 bg-white text-sm" role="status">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    {templateReport.kind === 'standard' ? (
                      <>
                        <p className="text-gray-800">
                          {templateReport.result.created.length > 0
                            ? `Lagt til: ${templateReport.result.created.map((f) => `«${f.name}»`).join(', ')}.`
                            : 'Ingen nye maler lagt til.'}
                        </p>
                        {templateReport.result.skipped.length > 0 && (
                          <p className="text-gray-500">
                            Fantes fra før: {templateReport.result.skipped.map((n) => `«${n}»`).join(', ')}.
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-gray-800">{legacyStatusMessage(templateReport.result)}</p>
                        {templateReport.result.status === 'created' && templateReport.result.matched.length > 0 && (
                          <ul className="text-gray-600 list-disc pl-5">
                            {templateReport.result.matched.map((m) => (
                              <li key={m.slot}>
                                {LIFECYCLE_SLOT_LABELS[m.slot] ?? m.slot}: «{m.templateName}» ({MATCH_VIA_LABELS[m.via] ?? m.via})
                              </li>
                            ))}
                          </ul>
                        )}
                        {templateReport.result.status === 'created' && templateReport.result.unmatched.length > 0 && (
                          <div className="text-gray-500">
                            <p>Ikke brukt:</p>
                            <ul className="list-disc pl-5">
                              {templateReport.result.unmatched.map((u) => (
                                <li key={`${u.name}-${u.subject}`}>
                                  «{u.name}» — {u.reason}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setTemplateReport(null)}>
                    Lukk
                  </Button>
                </div>
              </div>
            )}

            {templates.length === 0 ? (
              <div className="text-sm text-gray-600 border border-dashed border-gray-300 rounded-lg px-4 py-6 text-center">
                <p>Ingen maler ennå.</p>
                {isSuperAdmin ? (
                  <Button
                    variant="link"
                    onClick={() => { setTemplateReport(null); setTemplateAction('standard'); }}
                    className="mt-2"
                  >
                    Legg til de ferdige malene
                  </Button>
                ) : (
                  <p className="mt-1 text-gray-500">Åpne en flyt og trykk «Lagre som mal» for å lage din egen.</p>
                )}
              </div>
            ) : (
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {templates.map((template) => {
                  const isPending = pendingIds.has(template.id);
                  const isRenaming = renaming?.id === template.id;
                  return (
                    <li key={template.id} className="flex flex-col gap-3 px-4 py-3 text-sm sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        {isRenaming ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              autoFocus
                              aria-label="Nytt navn på malen"
                              value={renaming.name}
                              maxLength={200}
                              onChange={(e) => setRenaming({ id: template.id, name: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveRename();
                                if (e.key === 'Escape') setRenaming(null);
                              }}
                              className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm sm:max-w-sm"
                            />
                            <Button
                              size="sm"
                              onClick={saveRename}
                              disabled={!renaming.name.trim()}
                              loading={isPending}
                              loadingLabel="Lagrer …"
                            >
                              Lagre
                            </Button>
                            <Button variant="secondary" size="sm" onClick={() => setRenaming(null)}>
                              Avbryt
                            </Button>
                          </div>
                        ) : (
                          <>
                            <Link
                              href={`/admin/crm/flyter/${template.id}`}
                              className="font-medium text-gray-900 hover:text-bjerke-blue hover:underline"
                            >
                              {template.name}
                            </Link>
                            {template.description && (
                              <p className="mt-0.5 text-xs text-gray-500 text-pretty">{template.description}</p>
                            )}
                            <p className="mt-1 text-xs text-gray-500">
                              {template.isMarketing ? 'Markedsføring' : 'Viktig info'} · Gjelder{' '}
                              {(ANCHOR_LABELS[template.anchorMode] ?? template.anchorMode).toLowerCase()} · Endret{' '}
                              {formatNorwegianDate(template.updatedAt)}
                            </p>
                          </>
                        )}
                      </div>
                      {!isRenaming && (
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => createFromTemplate(template)}
                            loading={isPending}
                            loadingLabel="Lager flyt …"
                          >
                            Bruk mal
                          </Button>
                          <RowMenu
                            label={`Flere valg for malen ${template.name}`}
                            disabled={isPending}
                            items={[
                              { label: 'Rediger mal', href: `/admin/crm/flyter/${template.id}` },
                              { label: 'Gi nytt navn', onSelect: () => setRenaming({ id: template.id, name: template.name }) },
                              { label: 'Slett mal', danger: true, onSelect: () => setConfirmAction({ type: 'delete', flow: template }) },
                            ]}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      <ConfirmModal
        open={confirmAction !== null}
        title={
          confirmAction?.type === 'delete'
            ? isTemplateStatus(confirmAction.flow.status) ? 'Slette malen?' : 'Slette flyten?'
            : confirmAction?.type === 'resume'
              ? 'Gjenoppta flyten?'
              : 'Arkivere flyten?'
        }
        message={
          !confirmAction
            ? ''
            : confirmAction.type === 'delete'
              ? deleteFlowMessage(confirmAction.flow)
              : confirmAction.type === 'resume'
                ? `${HINTS.resumeFlow}${confirmAction.flow.activeEnrollments > 0 ? ` (${enrollmentText(confirmAction.flow.activeEnrollments)}.)` : ''}`
                : `«${confirmAction.flow.name}» stopper for godt og sender ingen flere e-poster.${
                    confirmAction.flow.activeEnrollments > 0
                      ? ` ${enrollmentText(confirmAction.flow.activeEnrollments)} og får ikke resten av e-postene.`
                      : ''
                  } Arkivering kan ikke angres. Vil du bare stoppe en stund, velg «Sett på pause» i stedet.`
        }
        confirmLabel={
          confirmAction?.type === 'delete' ? 'Ja, slett' : confirmAction?.type === 'resume' ? 'Ja, gjenoppta' : 'Ja, arkiver'
        }
        cancelLabel="Avbryt"
        variant={confirmAction?.type === 'delete' ? 'danger' : confirmAction?.type === 'resume' ? 'info' : 'warning'}
        loading={confirmLoading}
        onConfirm={runConfirmedAction}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
