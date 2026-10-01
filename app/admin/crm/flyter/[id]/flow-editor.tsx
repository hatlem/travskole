'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type OnBeforeDelete,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Link from 'next/link';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { Button } from '@/components/admin/Button';
import { useToast } from '@/components/admin/Toast';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { HelpTip } from '@/components/admin/HelpTip';
import { HINTS } from '@/lib/admin-copy';
import type { CourseOption, ListOption } from '@/lib/flows/event-labels';
import { isFlowEditable, isTemplateStatus } from '@/lib/flows/status';
import { freeNodePosition, initialViewport, validateEditorGraph } from '@/lib/flows/editor';
import { nodeTypes, NODE_TYPE_ORDER, NODE_LABELS, NODE_DESCRIPTIONS, type FlowRFNode, type FlowNodeType } from './node-types';
import { edgeTypes, type FlowRFEdge } from './deletable-edge';
import {
  NodeConfigPanel,
  type AdminUserOption,
  type SenderIdentityOption,
  type SegmentOption,
} from './node-config-panel';
import { TriggerPanel, type TriggerRow } from './trigger-panel';
import { EnrollmentPanel } from './enrollment-panel';
import { EnrollModal } from './enroll-modal';
import { FlowSettingsPanel } from './flow-settings-panel';
import { FlowToolbar, type ValidationError } from './flow-toolbar';
import type { FlowSendWindowValue } from './flow-send-window-section';
import { activatedFlowNote, describeSendWindow, resolveEffectiveSendWindow } from '@/lib/flows/send-window';
import {
  isSendWindowDirty,
  isSettingsDirty,
  planFlowSave,
  sendWindowStateFrom,
  settingsDraftAfterSave,
  settingsDraftFrom,
  type FlowSettingsDraft,
  type SendWindowState,
} from '@/lib/flows/editor-save';
import { useUnsavedChangesGuard } from '@/components/admin/useUnsavedChangesGuard';
import { BreadcrumbLabel } from '@/components/admin/BreadcrumbLabel';

interface InitialNode {
  id: number;
  type: FlowNodeType;
  config: Record<string, unknown>;
  posX: number;
  posY: number;
}

interface InitialEdge {
  id: number;
  fromNodeId: number;
  toNodeId: number;
  branch: string | null;
}

interface FlowMeta {
  id: number;
  name: string;
  description: string | null;
  status: string;
  isMarketing: boolean;
  anchorMode: string;
}

interface FlowEditorProps {
  flow: FlowMeta;
  initialNodes: InitialNode[];
  initialEdges: InitialEdge[];
  initialTriggers: TriggerRow[];
  senderIdentities: SenderIdentityOption[];
  segments: SegmentOption[];
  courses: CourseOption[];
  lists: ListOption[];
  adminUsers: AdminUserOption[];
  initialActiveEnrollments: number;
  initialSendWindow: FlowSendWindowValue;
}

const DRAG_MIME = 'application/x-flow-node-type';

type HelperAction = 'trigger' | 'skeleton' | 'email' | 'activate';

function refFor(rfId: string): string | number {
  const realId = Number(rfId);
  return Number.isInteger(realId) && realId > 0 ? realId : rfId;
}

const isNodeType = (v: string): v is FlowNodeType => (NODE_TYPE_ORDER as string[]).includes(v);

export function FlowEditor({
  flow: initialFlow,
  initialNodes,
  initialEdges,
  initialTriggers,
  senderIdentities,
  segments,
  courses,
  lists,
  adminUsers,
  initialActiveEnrollments,
  initialSendWindow,
}: FlowEditorProps) {
  const { toast } = useToast();
  const [flow, setFlow] = useState<FlowMeta>(initialFlow);
  const [triggers, setTriggers] = useState<TriggerRow[]>(initialTriggers);

  const [nodes, setNodes] = useState<FlowRFNode[]>(() =>
    initialNodes.map((n) => ({
      id: String(n.id),
      type: n.type,
      position: { x: n.posX, y: n.posY },
      data: { config: n.config, hasError: false },
    })),
  );
  const [edges, setEdges] = useState<FlowRFEdge[]>(() =>
    initialEdges.map((e) => ({
      id: `e${e.id}`,
      type: 'deletable' as const,
      source: String(e.fromNodeId),
      target: String(e.toNodeId),
      sourceHandle: e.branch ?? undefined,
    })),
  );

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  /** Kun tegningen (steg og piler); innstillinger og sendetider har egne utkast under. */
  const [dirty, setDirty] = useState(false);
  const [errorNodeIds, setErrorNodeIds] = useState<Set<string>>(new Set());
  const [activationErrors, setActivationErrors] = useState<ValidationError[]>([]);

  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollmentsVersion, setEnrollmentsVersion] = useState(0);
  const [hasActiveEnrollments, setHasActiveEnrollments] = useState(initialActiveEnrollments > 0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState<'activate' | 'resume' | null>(null);
  const [helperHidden, setHelperHidden] = useState(false);
  const [sendWindow, setSendWindow] = useState<FlowSendWindowValue>(initialSendWindow);
  const [settingsDraft, setSettingsDraft] = useState<FlowSettingsDraft>(() => settingsDraftFrom(initialFlow));
  const [sendWindowDraft, setSendWindowDraft] = useState<SendWindowState>(() =>
    sendWindowStateFrom(initialSendWindow.global, initialSendWindow.override),
  );
  const sendWindowLabel = describeSendWindow(resolveEffectiveSendWindow(sendWindow.global, sendWindow.override));
  const savingRef = useRef(false);
  const activatingRef = useRef(false);
  const statusChangeRef = useRef(false);
  const tempIdRef = useRef(0);
  const rfInstanceRef = useRef<ReactFlowInstance<FlowRFNode, FlowRFEdge> | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const editingDisabled = !isFlowEditable(flow.status);
  const isTemplate = isTemplateStatus(flow.status);
  const settingsDirty = !editingDisabled && isSettingsDirty(flow, settingsDraft);
  const sendWindowDirty = isSendWindowDirty(sendWindow.override, sendWindowDraft);
  const anyDirty = (dirty && !editingDisabled) || settingsDirty || sendWindowDirty;
  const guard = useUnsavedChangesGuard(anyDirty && !saving);
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );
  const nodesForCanvas = useMemo(
    () => nodes.map((n) => ({ ...n, data: { ...n.data, hasError: errorNodeIds.has(n.id) } })),
    [nodes, errorNodeIds],
  );
  const edgesForCanvas = useMemo(
    () => edges.map((e) => ({ ...e, data: { editable: !editingDisabled } })),
    [edges, editingDisabled],
  );

  // Samme validering som aktiveringen, kjørt på grafen slik den ligger i editoren.
  const liveErrors = useMemo(() => validateEditorGraph(nodes, edges), [nodes, edges]);
  const nodeLabel = useCallback(
    (nodeId: number) => {
      const node = nodes.find((n) => n.id === String(nodeId));
      return node ? NODE_LABELS[node.type as FlowNodeType] ?? 'Steg' : `Steg #${nodeId}`;
    },
    [nodes],
  );

  const clearErrors = useCallback(() => {
    setErrorNodeIds((prev) => (prev.size === 0 ? prev : new Set()));
    setActivationErrors((prev) => (prev.length === 0 ? prev : []));
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowRFNode>[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
      if (changes.some((c) => c.type !== 'select' && c.type !== 'dimensions')) {
        setDirty(true);
        clearErrors();
      }
    },
    [clearErrors],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<FlowRFEdge>[]) => {
      setEdges((eds) => applyEdgeChanges(changes, eds));
      if (changes.some((c) => c.type !== 'select')) {
        setDirty(true);
        clearErrors();
      }
    },
    [clearErrors],
  );

  // Tastatursletting gjelder bare valgte koblinger — noder slettes med «Slett node» i panelet.
  const onBeforeDelete: OnBeforeDelete<FlowRFNode, FlowRFEdge> = useCallback(
    async ({ edges: candidates }) => {
      if (editingDisabled) return false;
      const selectedEdges = candidates.filter((e) => e.selected);
      return selectedEdges.length > 0 ? { nodes: [], edges: selectedEdges } : false;
    },
    [editingDisabled],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (editingDisabled) return;
      setEdges((eds) => addEdge({ ...connection, type: 'deletable' as const }, eds));
      setDirty(true);
      clearErrors();
    },
    [editingDisabled, clearErrors],
  );

  const onNodeClick = useCallback((_event: unknown, node: FlowRFNode) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => setSelectedNodeId(null), []);

  function addNode(type: FlowNodeType, position?: { x: number; y: number }) {
    if (editingDisabled) return;
    tempIdRef.current -= 1;
    const id = String(tempIdRef.current);
    const pos = position ?? freeNodePosition(nodes.map((n) => n.position));
    const defaultConfig: Record<string, unknown> = type === 'wait' ? { days: 0, hours: 0 } : {};
    setNodes((nds) => [...nds, { id, type, position: pos, data: { config: defaultConfig, hasError: false } }]);
    setSelectedNodeId(id);
    setDirty(true);
    clearErrors();
  }

  /** «Kom i gang»: Start → E-post → Slutt, ferdig koblet, med e-posten valgt for utfylling. */
  function addStarterSkeleton() {
    if (editingDisabled || nodes.length > 0) return;
    const ids = ['start', 'email', 'end'].map(() => {
      tempIdRef.current -= 1;
      return String(tempIdRef.current);
    });
    const [startId, emailId, endId] = ids;
    const at = (row: number) => ({ x: 0, y: row * 140 });
    setNodes([
      { id: startId, type: 'start', position: at(0), data: { config: {}, hasError: false } },
      { id: emailId, type: 'email', position: at(1), data: { config: {}, hasError: false } },
      { id: endId, type: 'end', position: at(2), data: { config: {}, hasError: false } },
    ]);
    setEdges([
      { id: `tmp-${startId}-${emailId}`, type: 'deletable', source: startId, target: emailId },
      { id: `tmp-${emailId}-${endId}`, type: 'deletable', source: emailId, target: endId },
    ]);
    setSelectedNodeId(emailId);
    setDirty(true);
    clearErrors();
    setTimeout(fitCanvas, 50);
  }

  /** Lesbar zoom og Start-steget synlig — React Flows egen fitView sentrerer og kan klippe toppen. */
  function fitCanvas() {
    const instance = rfInstanceRef.current;
    const el = canvasRef.current;
    if (!instance || !el) return;
    const current = instance.getNodes();
    if (current.length === 0) return;
    const xs = current.map((n) => n.position.x);
    const ys = current.map((n) => n.position.y);
    const right = current.map((n) => n.position.x + (n.measured?.width ?? 200));
    const bottom = current.map((n) => n.position.y + (n.measured?.height ?? 72));
    const bounds = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...right) - Math.min(...xs),
      height: Math.max(...bottom) - Math.min(...ys),
    };
    void instance.setViewport(initialViewport(bounds, { width: el.clientWidth, height: el.clientHeight }));
  }

  function runHelperAction(kind: HelperAction) {
    if (kind === 'skeleton') return addStarterSkeleton();
    if (kind === 'email') return addNode('email');
    if (kind === 'activate') return void requestStatusChange('activate');
    const select = document.getElementById('trigger-event');
    select?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    select?.focus();
  }

  function onPaletteDragStart(event: React.DragEvent, type: FlowNodeType) {
    event.dataTransfer.setData(DRAG_MIME, type);
    event.dataTransfer.effectAllowed = 'move';
  }

  function onCanvasDragOver(event: React.DragEvent) {
    if (editingDisabled || !event.dataTransfer.types.includes(DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  function onCanvasDrop(event: React.DragEvent) {
    const type = event.dataTransfer.getData(DRAG_MIME);
    const instance = rfInstanceRef.current;
    if (editingDisabled || !isNodeType(type) || !instance) return;
    event.preventDefault();
    const position = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    // Sentrer kortet (~180×60) under markøren.
    addNode(type, { x: position.x - 90, y: position.y - 30 });
  }

  function deleteNode(rfId: string) {
    setNodes((nds) => nds.filter((n) => n.id !== rfId));
    setEdges((eds) => eds.filter((e) => e.source !== rfId && e.target !== rfId));
    setSelectedNodeId((cur) => (cur === rfId ? null : cur));
    setDirty(true);
    clearErrors();
  }

  function updateNodeConfig(rfId: string, config: Record<string, unknown>) {
    setNodes((nds) => nds.map((n) => (n.id === rfId ? { ...n, data: { ...n.data, config } } : n)));
    setDirty(true);
    clearErrors();
  }

  /** Lagrer tegningen (replace-all). Returnerer false ved feil — endringene blir liggende i editoren. */
  async function saveGraph(): Promise<boolean> {
    const currentNodes = nodes;
    const payloadNodes = currentNodes.map((n) => {
      const realId = Number(n.id);
      const base = {
        type: n.type as FlowNodeType,
        config: n.data.config,
        posX: n.position.x,
        posY: n.position.y,
      };
      return Number.isInteger(realId) && realId > 0 ? { ...base, id: realId } : { ...base, tempId: n.id };
    });
    const payloadEdges = edges.map((e) => ({
      fromRef: refFor(e.source),
      toRef: refFor(e.target),
      branch: e.sourceHandle === 'ja' || e.sourceHandle === 'nei' ? e.sourceHandle : null,
    }));

    const res = await fetch(`/api/admin/crm/flows/${flow.id}/graph`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes: payloadNodes, edges: payloadEdges }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.error || 'Stegene ble ikke lagret. Prøv igjen — endringene dine er fortsatt her.', 'error');
      return false;
    }

    const idMap = new Map<string, string>();
    currentNodes.forEach((n, i) => {
      const real = data.graph?.nodes?.[i]?.id;
      if (typeof real === 'number') idMap.set(n.id, String(real));
    });
    setNodes((nds) => nds.map((n) => (idMap.has(n.id) ? { ...n, id: idMap.get(n.id)! } : n)));
    setEdges((eds) =>
      eds.map((e) => ({
        ...e,
        source: idMap.get(e.source) ?? e.source,
        target: idMap.get(e.target) ?? e.target,
      })),
    );
    setSelectedNodeId((cur) => (cur ? idMap.get(cur) ?? cur : cur));
    setDirty(false);
    return true;
  }

  /** Én lagring for alt som er endret: innstillinger og sendetider (én PATCH), deretter stegene. */
  async function handleSave(): Promise<boolean> {
    if (savingRef.current) return false;
    const plan = planFlowSave({
      editable: !editingDisabled,
      graphDirty: dirty,
      savedSettings: flow,
      settings: settingsDraft,
      savedSendWindow: sendWindow.override,
      sendWindow: sendWindowDraft,
    });
    if (plan.errors.length > 0) {
      setSettingsOpen(true);
      toast(`Ikke lagret: ${plan.errors.join(' ')}`, 'error');
      return false;
    }
    if (!plan.patch && !plan.saveGraph) return true;

    savingRef.current = true;
    setSaving(true);
    // Det som sendes; endringer gjort mens lagringen pågår, skal ikke overskrives av svaret.
    const sentSettings = settingsDraft;
    const sentSendWindow = sendWindowDraft;
    try {
      if (plan.patch) {
        const res = await fetch(`/api/admin/crm/flows/${flow.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(plan.patch),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSettingsOpen(true);
          toast(data.error || 'Innstillingene ble ikke lagret. Prøv igjen.', 'error');
          return false;
        }
        const saved = {
          name: data.flow.name as string,
          description: data.flow.description as string | null,
          isMarketing: data.flow.isMarketing as boolean,
          anchorMode: data.flow.anchorMode as string,
        };
        setFlow((f) => ({ ...f, ...saved }));
        setSettingsDraft((current) => settingsDraftAfterSave(current, sentSettings, saved));
        const override = plan.sendWindowOverride;
        if (override) {
          setSendWindow((prev) => ({ ...prev, override }));
          setSendWindowDraft((current) => (current === sentSendWindow ? sendWindowStateFrom(sendWindow.global, override) : current));
        }
      }
      if (plan.saveGraph && !(await saveGraph())) return false;
      clearErrors();
      toast('Endringene er lagret.', 'success');
      return true;
    } catch {
      toast('Endringene ble ikke lagret. Sjekk nettforbindelsen og prøv igjen — de er fortsatt her.', 'error');
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function applyValidationErrors(errors: ValidationError[]) {
    setActivationErrors(errors);
    setErrorNodeIds(
      new Set(errors.filter((e) => e.nodeId !== null).map((e) => String(e.nodeId))),
    );
  }

  /** Sjekker grafen først; er den gyldig, spørres brukeren før e-postene begynner å gå. */
  async function requestStatusChange(kind: 'activate' | 'resume') {
    if (anyDirty && !(await handleSave())) return;
    if (liveErrors.length > 0) {
      applyValidationErrors(liveErrors);
      toast(
        kind === 'activate'
          ? 'Flyten kan ikke aktiveres ennå. Se listen over hva som må fikses.'
          : 'Flyten kan ikke gjenopptas ennå. Se listen over hva som må fikses.',
        'error',
      );
      return;
    }
    setConfirmStatus(kind);
  }

  async function handleActivate() {
    if (activatingRef.current || anyDirty) return;
    if (liveErrors.length > 0) {
      applyValidationErrors(liveErrors);
      toast('Flyten kan ikke aktiveres ennå. Se listen over hva som må fikses.', 'error');
      return;
    }
    activatingRef.current = true;
    setActivating(true);
    try {
      const res = await fetch(`/api/admin/crm/flows/${flow.id}/activate`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        if (Array.isArray(data.errors)) {
          applyValidationErrors(data.errors);
          toast('Flyten kan ikke aktiveres ennå. Se listen over hva som må fikses.', 'error');
        } else {
          toast(data.error || 'Flyten ble ikke aktivert. Prøv igjen.', 'error');
        }
        return;
      }
      setFlow((f) => ({ ...f, status: data.flow.status }));
      clearErrors();
      const started = Number(data.startedEnrollments) || 0;
      toast(
        started > 0
          ? `${activatedFlowNote(sendWindowLabel)} ${started === 1 ? '1 person' : `${started} personer`} som ventet, starter nå.`
          : activatedFlowNote(sendWindowLabel),
        'success',
      );
      if (started > 0) setEnrollmentsVersion((v) => v + 1);
    } catch {
      toast('Flyten ble ikke aktivert. Sjekk nettforbindelsen og prøv igjen.', 'error');
    } finally {
      activatingRef.current = false;
      setActivating(false);
    }
  }

  async function handleStatusChange(nextStatus: 'active' | 'paused') {
    if (statusChangeRef.current) return;
    if (nextStatus === 'active' && anyDirty) return;
    if (nextStatus === 'active' && liveErrors.length > 0) {
      applyValidationErrors(liveErrors);
      toast('Flyten kan ikke gjenopptas ennå. Se listen over hva som må fikses.', 'error');
      return;
    }
    statusChangeRef.current = true;
    setChangingStatus(true);
    try {
      const res = await fetch(`/api/admin/crm/flows/${flow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (Array.isArray(data.errors)) {
          applyValidationErrors(data.errors);
          toast('Flyten kan ikke gjenopptas ennå. Se listen over hva som må fikses.', 'error');
        } else {
          toast(data.error || 'Statusen ble ikke endret. Prøv igjen.', 'error');
        }
        return;
      }
      setFlow((f) => ({ ...f, status: data.flow.status }));
      clearErrors();
      toast(
        nextStatus === 'active'
          ? 'Flyten går igjen. E-postene fortsetter der de stoppet.'
          : 'Flyten står på pause. Ingen e-poster sendes før du gjenopptar.',
        'success',
      );
    } catch {
      toast('Statusen ble ikke endret. Sjekk nettforbindelsen og prøv igjen.', 'error');
    } finally {
      statusChangeRef.current = false;
      setChangingStatus(false);
    }
  }

  async function handleSaveAsTemplate() {
    if (savingTemplate) return;
    if (anyDirty && !(await handleSave())) return;
    setSavingTemplate(true);
    try {
      const res = await fetch(`/api/admin/crm/flows/${flow.id}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'template' }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Malen ble ikke lagret. Prøv igjen.', 'error');
        return;
      }
      toast(`Lagret som malen «${data.flow.name}». Du finner den under «Maler» i listen over e-postflyter.`, 'success', {
        action: { label: 'Åpne malen', href: `/admin/crm/flyter/${data.flow.id}` },
      });
    } catch {
      toast('Malen ble ikke lagret. Sjekk nettforbindelsen og prøv igjen.', 'error');
    } finally {
      setSavingTemplate(false);
    }
  }

  const hasEmail = nodes.some((n) => n.type === 'email');
  const showHelper = flow.status === 'draft' && !helperHidden;
  const helperSteps: {
    title: string;
    text: string;
    done: boolean;
    action?: { label: string; kind: HelperAction; disabled?: boolean };
  }[] = [
    {
      title: 'Velg når den starter',
      text: 'For eksempel «Ny kurspåmelding». Da blir folk med automatisk.',
      done: triggers.length > 0,
      action: { label: 'Velg startregel', kind: 'trigger' },
    },
    {
      title: 'Legg til en e-post',
      text: 'Skriv emne og tekst, og velg hvem den kommer fra. Trykk «Lagre» når du er ferdig.',
      done: hasEmail,
      action:
        nodes.length === 0
          ? { label: 'Lag start og første e-post', kind: 'skeleton', disabled: editingDisabled }
          : { label: 'Legg til e-post', kind: 'email', disabled: editingDisabled },
    },
    {
      title: 'Aktiver',
      text: HINTS.activateFlow,
      done: false,
      action: { label: 'Aktiver flyten', kind: 'activate', disabled: saving || !hasEmail },
    },
  ];

  useEffect(() => {
    document.title = `${flow.name} – ${isTemplate ? 'Mal' : 'Flyt'}`;
  }, [flow.name, isTemplate]);

  return (
    <div>
      <BreadcrumbLabel label={flow.name} />
      <CrmTabs />
      <FlowToolbar
        name={flow.name}
        status={flow.status}
        dirty={anyDirty}
        saving={saving}
        activating={activating}
        changingStatus={changingStatus}
        activationErrors={activationErrors}
        pendingProblems={flow.status === 'draft' || flow.status === 'paused' ? liveErrors.length : 0}
        nodeLabel={nodeLabel}
        onSave={() => void handleSave()}
        onActivate={() => void requestStatusChange('activate')}
        onPause={() => handleStatusChange('paused')}
        onResume={() => void requestStatusChange('resume')}
        onEnroll={
          flow.anchorMode === 'course' || isTemplate || flow.status === 'archived' ? undefined : () => setEnrollOpen(true)
        }
        onSaveAsTemplate={() => void handleSaveAsTemplate()}
        savingTemplate={savingTemplate}
        enrollmentCounter={<EnrollmentPanel key={enrollmentsVersion} flowId={flow.id} />}
        sendWindowLabel={sendWindowLabel}
        onSendWindowClick={() => setSettingsOpen(true)}
      />

      {showHelper && (
        <section
          aria-labelledby="flow-getting-started"
          className="mb-4 rounded-lg border border-bjerke-blue/20 bg-blue-50/60 p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id="flow-getting-started" className="text-sm font-semibold text-gray-900">Kom i gang i tre steg</h2>
              {nodes.length === 0 && (
                <p className="mt-0.5 text-sm text-gray-600">
                  Usikker på hvor du skal begynne?{' '}
                  <Link href="/admin/crm/flyter?mal=1" className="font-medium text-bjerke-blue hover:underline">
                    Start fra en ferdig mal
                  </Link>{' '}
                  — den er satt opp, og du endrer bare tekstene.
                </p>
              )}
            </div>
            <Button variant="link" size="sm" onClick={() => setHelperHidden(true)}>
              Skjul hjelpen
            </Button>
          </div>
          <ol className="mt-3 grid gap-3 md:grid-cols-3">
            {helperSteps.map((step, i) => (
              <li
                key={step.title}
                className={`rounded-md border bg-white p-3 ${step.done ? 'border-green-300' : 'border-gray-200'}`}
              >
                <p className="text-sm font-medium text-gray-900">
                  <span
                    aria-hidden="true"
                    className={`mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${
                      step.done ? 'bg-green-600 text-white' : 'bg-bjerke-blue text-white'
                    }`}
                  >
                    {step.done ? '✓' : i + 1}
                  </span>
                  {step.title}
                  <span className="sr-only">{step.done ? ' (gjort)' : ''}</span>
                </p>
                <p className="mt-1 text-xs text-gray-600">{step.text}</p>
                {!step.done && step.action && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => runHelperAction(step.action!.kind)}
                    disabled={step.action.disabled}
                    className="mt-2"
                  >
                    {step.action.label}
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[184px_minmax(0,1fr)_360px] lg:items-start">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:sticky lg:top-4 lg:block lg:max-h-[calc(100vh-2rem)] lg:space-y-2 lg:overflow-y-auto">
          <h3 className="col-span-full text-xs font-semibold uppercase text-gray-500">Legg til steg</h3>
          {NODE_TYPE_ORDER.map((type) => (
            <button
              key={type}
              onClick={() => addNode(type)}
              draggable={!editingDisabled}
              onDragStart={(e) => onPaletteDragStart(e, type)}
              disabled={editingDisabled}
              title="Klikk for å legge til, eller dra inn i tegningen"
              className="lg:w-full text-left border border-gray-300 bg-white rounded-md px-3 py-2 text-sm hover:border-bjerke-blue hover:bg-blue-50/50 disabled:opacity-50 cursor-grab active:cursor-grabbing disabled:cursor-not-allowed"
            >
              <span className="block font-medium text-gray-900">{NODE_LABELS[type]}</span>
              <span className="mt-0.5 block text-xs leading-snug text-gray-500">{NODE_DESCRIPTIONS[type]}</span>
            </button>
          ))}
          {!editingDisabled && (
            <p className="col-span-full text-xs text-gray-500 pt-1">
              Klikk på et steg, eller dra det inn i tegningen. Koble stegene ved å dra en pil fra prikken nederst på et
              steg til det neste. For å fjerne en pil: klikk på den og trykk ×.
            </p>
          )}
        </div>

        <div
          ref={canvasRef}
          className="h-[420px] min-w-0 rounded-lg border border-gray-200 bg-gray-50 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:max-h-[860px] lg:min-h-[480px]"
          onDragOver={onCanvasDragOver}
          onDrop={onCanvasDrop}
        >
          <ReactFlow<FlowRFNode, FlowRFEdge>
            nodes={nodesForCanvas}
            edges={edgesForCanvas}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onInit={(instance) => {
              rfInstanceRef.current = instance;
              requestAnimationFrame(fitCanvas);
            }}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onBeforeDelete={onBeforeDelete}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodesDraggable={!editingDisabled}
            nodesConnectable={!editingDisabled}
            edgesFocusable={!editingDisabled}
            deleteKeyCode={editingDisabled ? null : ['Delete', 'Backspace']}
            fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
            minZoom={0.3}
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>

        <div className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <button
              type="button"
              onClick={() => setSettingsOpen((v) => !v)}
              aria-expanded={settingsOpen}
              className="flex w-full items-start justify-between gap-3 text-left text-sm font-semibold text-gray-800"
            >
              <span className="inline-flex items-center gap-1.5">
                Innstillinger
                {(settingsDirty || sendWindowDirty) && (
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-label="ikke lagret" />
                )}
              </span>
              <span className="text-right text-xs font-normal text-gray-500">
                {flow.isMarketing ? 'Markedsføring' : 'Viktig informasjon'} · {flow.anchorMode === 'course' ? 'Gjelder et kurs' : 'Gjelder en person'} · Sendes {sendWindowLabel}
                <span aria-hidden="true">{settingsOpen ? ' ▲' : ' ▼'}</span>
              </span>
            </button>
            {settingsOpen && (
              <div className="mt-3">
                <FlowSettingsPanel
                  flowId={flow.id}
                  disabled={editingDisabled}
                  hasActiveEnrollments={hasActiveEnrollments}
                  values={settingsDraft}
                  onChange={(patch) => setSettingsDraft((prev) => ({ ...prev, ...patch }))}
                  isMarketing={settingsDraft.isMarketing}
                  globalSendWindow={sendWindow.global}
                  sendWindow={sendWindowDraft}
                  onSendWindowChange={setSendWindowDraft}
                />
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Valgt steg</h3>
            <NodeConfigPanel
              node={selectedNode}
              flowId={flow.id}
              senderIdentities={senderIdentities}
              segments={segments}
              adminUsers={adminUsers}
              isMarketing={flow.isMarketing}
              anchorMode={flow.anchorMode}
              disabled={editingDisabled}
              onChangeConfig={updateNodeConfig}
              onDeleteNode={deleteNode}
            />
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">
              Når skal flyten starte?
              <HelpTip term="trigger" align="right" />
            </h3>
            {isTemplate && (
              <p className="mb-2 text-xs text-gray-500">Startreglene i en mal kopieres til nye flyter, men starter aldri noe selv.</p>
            )}
            <TriggerPanel
              flowId={flow.id}
              triggers={triggers}
              courses={courses}
              lists={lists}
              anchorMode={flow.anchorMode}
              onTriggersChange={setTriggers}
            />
          </div>
        </div>
      </div>

      <ConfirmModal
        open={guard.pendingHref !== null}
        title="Forlate siden?"
        message="Du har endringer i flyten som ikke er lagret. Forlater du siden, går de tapt."
        confirmLabel="Forlat uten å lagre"
        cancelLabel="Bli på siden"
        variant="warning"
        onConfirm={guard.leave}
        onCancel={guard.stay}
      />

      <ConfirmModal
        open={confirmStatus !== null}
        title={confirmStatus === 'resume' ? 'Gjenoppta flyten?' : 'Aktivere flyten?'}
        message={
          confirmStatus === 'resume'
            ? HINTS.resumeFlow
            : `${HINTS.activateFlow}${
                triggers.length === 0
                  ? ' Flyten har ingen startregel ennå, så ingen blir med automatisk — du må legge til personer selv.'
                  : ''
              }${flow.isMarketing ? ' Bare de som har sagt ja til markedsføring, får e-postene.' : ''}`
        }
        confirmLabel={confirmStatus === 'resume' ? 'Ja, gjenoppta' : 'Ja, aktiver'}
        cancelLabel="Ikke nå"
        variant="info"
        loading={activating || changingStatus}
        onConfirm={async () => {
          const kind = confirmStatus;
          if (kind === 'activate') await handleActivate();
          else if (kind === 'resume') await handleStatusChange('active');
          setConfirmStatus(null);
        }}
        onCancel={() => setConfirmStatus(null)}
      />

      {enrollOpen && (
        <EnrollModal
          flowId={flow.id}
          isMarketing={flow.isMarketing}
          isDraft={flow.status === 'draft'}
          onActivate={() => void requestStatusChange('activate')}
          sendWindowLabel={sendWindowLabel}
          onClose={() => setEnrollOpen(false)}
          onEnrolled={(result) => {
            if (result.enrolled > 0) {
              setHasActiveEnrollments(true);
              setEnrollmentsVersion((v) => v + 1);
            }
          }}
        />
      )}
    </div>
  );
}
