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
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { useToast } from '@/components/admin/Toast';
import { nodeTypes, NODE_TYPE_ORDER, NODE_LABELS, type FlowRFNode, type FlowNodeType } from './node-types';
import { NodeConfigPanel, type SenderIdentityOption, type SegmentOption } from './node-config-panel';
import { TriggerPanel, type TriggerRow } from './trigger-panel';
import { EnrollmentPanel } from './enrollment-panel';
import { FlowToolbar, type ValidationError } from './flow-toolbar';

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
}

interface FlowEditorProps {
  flow: FlowMeta;
  initialNodes: InitialNode[];
  initialEdges: InitialEdge[];
  initialTriggers: TriggerRow[];
  senderIdentities: SenderIdentityOption[];
  segments: SegmentOption[];
}

function refFor(rfId: string): string | number {
  const realId = Number(rfId);
  return Number.isInteger(realId) && realId > 0 ? realId : rfId;
}

export function FlowEditor({
  flow: initialFlow,
  initialNodes,
  initialEdges,
  initialTriggers,
  senderIdentities,
  segments,
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
  const [edges, setEdges] = useState<Edge[]>(() =>
    initialEdges.map((e) => ({
      id: `e${e.id}`,
      source: String(e.fromNodeId),
      target: String(e.toNodeId),
      sourceHandle: e.branch ?? undefined,
      label: e.branch ?? undefined,
    })),
  );

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [errorNodeIds, setErrorNodeIds] = useState<Set<string>>(new Set());
  const [activationErrors, setActivationErrors] = useState<ValidationError[]>([]);

  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const savingRef = useRef(false);
  const activatingRef = useRef(false);
  const statusChangeRef = useRef(false);
  const tempIdRef = useRef(0);

  const editingDisabled = flow.status !== 'draft' && flow.status !== 'paused';
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );
  const nodesForCanvas = useMemo(
    () => nodes.map((n) => ({ ...n, data: { ...n.data, hasError: errorNodeIds.has(n.id) } })),
    [nodes, errorNodeIds],
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
    (changes: EdgeChange[]) => {
      setEdges((eds) => applyEdgeChanges(changes, eds));
      if (changes.some((c) => c.type !== 'select')) {
        setDirty(true);
        clearErrors();
      }
    },
    [clearErrors],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (editingDisabled) return;
      setEdges((eds) => addEdge(connection, eds));
      setDirty(true);
      clearErrors();
    },
    [editingDisabled, clearErrors],
  );

  const onNodeClick = useCallback((_event: unknown, node: FlowRFNode) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => setSelectedNodeId(null), []);

  function addNode(type: FlowNodeType) {
    if (editingDisabled) return;
    tempIdRef.current -= 1;
    const id = String(tempIdRef.current);
    const position = {
      x: 120 + (nodes.length % 4) * 200,
      y: 80 + Math.floor(nodes.length / 4) * 140,
    };
    const defaultConfig: Record<string, unknown> = type === 'wait' ? { days: 0, hours: 0 } : {};
    setNodes((nds) => [...nds, { id, type, position, data: { config: defaultConfig, hasError: false } }]);
    setSelectedNodeId(id);
    setDirty(true);
    clearErrors();
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

  async function handleSave() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const currentNodes = nodes;
      const currentEdges = edges;
      const payloadNodes = currentNodes.map((n) => {
        const realId = Number(n.id);
        const base = {
          type: n.type as FlowNodeType,
          config: n.data.config,
          posX: n.position.x,
          posY: n.position.y,
        };
        return Number.isInteger(realId) && realId > 0
          ? { ...base, id: realId }
          : { ...base, tempId: n.id };
      });
      const payloadEdges = currentEdges.map((e) => ({
        fromRef: refFor(e.source),
        toRef: refFor(e.target),
        branch: e.sourceHandle === 'ja' || e.sourceHandle === 'nei' ? e.sourceHandle : null,
      }));

      const res = await fetch(`/api/admin/crm/flows/${flow.id}/graph`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: payloadNodes, edges: payloadEdges }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Kunne ikke lagre flyten', 'error');
        return;
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
      clearErrors();
      toast('Flyt lagret', 'success');
    } catch {
      toast('Kunne ikke lagre flyten', 'error');
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

  async function handleActivate() {
    if (activatingRef.current || dirty) return;
    activatingRef.current = true;
    setActivating(true);
    try {
      const res = await fetch(`/api/admin/crm/flows/${flow.id}/activate`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        if (Array.isArray(data.errors)) {
          applyValidationErrors(data.errors);
          toast('Flyten kan ikke aktiveres — se feilene under', 'error');
        } else {
          toast(data.error || 'Kunne ikke aktivere flyten', 'error');
        }
        return;
      }
      setFlow((f) => ({ ...f, status: data.flow.status }));
      clearErrors();
      toast('Flyt aktivert', 'success');
    } catch {
      toast('Kunne ikke aktivere flyten', 'error');
    } finally {
      activatingRef.current = false;
      setActivating(false);
    }
  }

  async function handleStatusChange(nextStatus: 'active' | 'paused') {
    if (statusChangeRef.current) return;
    if (nextStatus === 'active' && dirty) return;
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
          toast('Kan ikke gjenoppta — se feilene under', 'error');
        } else {
          toast(data.error || 'Kunne ikke endre status', 'error');
        }
        return;
      }
      setFlow((f) => ({ ...f, status: data.flow.status }));
      clearErrors();
      toast(nextStatus === 'active' ? 'Flyt gjenopptatt' : 'Flyt satt på pause', 'success');
    } catch {
      toast('Kunne ikke endre status', 'error');
    } finally {
      statusChangeRef.current = false;
      setChangingStatus(false);
    }
  }

  useEffect(() => {
    document.title = `${flow.name} – Flyt`;
  }, [flow.name]);

  return (
    <div>
      <CrmTabs />
      <FlowToolbar
        name={flow.name}
        status={flow.status}
        dirty={dirty}
        saving={saving}
        activating={activating}
        changingStatus={changingStatus}
        activationErrors={activationErrors}
        onSave={handleSave}
        onActivate={handleActivate}
        onPause={() => handleStatusChange('paused')}
        onResume={() => handleStatusChange('active')}
        enrollmentCounter={<EnrollmentPanel flowId={flow.id} />}
      />

      <div className="grid grid-cols-[160px_1fr_320px] gap-4">
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase text-gray-500">Legg til node</h3>
          {NODE_TYPE_ORDER.map((type) => (
            <button
              key={type}
              onClick={() => addNode(type)}
              disabled={editingDisabled}
              className="w-full text-left border border-gray-300 rounded-md px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              {NODE_LABELS[type]}
            </button>
          ))}
        </div>

        <div className="h-[600px] rounded-lg border border-gray-200 bg-gray-50">
          <ReactFlow
            nodes={nodesForCanvas}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodesDraggable={!editingDisabled}
            nodesConnectable={!editingDisabled}
            deleteKeyCode={null}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Node-konfigurasjon</h3>
            <NodeConfigPanel
              node={selectedNode}
              flowId={flow.id}
              senderIdentities={senderIdentities}
              segments={segments}
              disabled={editingDisabled}
              onChangeConfig={updateNodeConfig}
              onDeleteNode={deleteNode}
            />
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Utløsere</h3>
            <TriggerPanel flowId={flow.id} triggers={triggers} onTriggersChange={setTriggers} />
          </div>
        </div>
      </div>
    </div>
  );
}
