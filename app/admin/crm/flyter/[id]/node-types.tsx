'use client';

import { Handle, Position, type Node, type NodeProps, type NodeTypes } from '@xyflow/react';
import type { FlowNodeType } from '@/lib/flows/graph';

export type { FlowNodeType };

export interface FlowNodeData extends Record<string, unknown> {
  config: Record<string, unknown>;
  hasError: boolean;
}

export type FlowRFNode = Node<FlowNodeData, FlowNodeType>;

export const NODE_TYPE_ORDER: FlowNodeType[] = ['start', 'email', 'wait', 'condition', 'action', 'schedule', 'end'];

export const NODE_LABELS: Record<FlowNodeType, string> = {
  start: 'Start',
  email: 'E-post',
  wait: 'Vent',
  condition: 'Betingelse',
  action: 'Handling',
  schedule: 'Planlegg',
  end: 'Slutt',
};

const NODE_ICONS: Record<FlowNodeType, string> = {
  start: '▶️',
  email: '✉️',
  wait: '⏱️',
  condition: '\u{1F500}',
  action: '⚙️',
  schedule: '📅',
  end: '⏹️',
};

const SCHEDULE_ANCHOR_LABELS: Record<string, string> = {
  course_start: 'Kursstart',
  course_midway: 'Halvveis',
  course_end: 'Kursslutt',
};

const NODE_ACCENTS: Record<FlowNodeType, string> = {
  start: 'border-t-emerald-500',
  email: 'border-t-blue-500',
  wait: 'border-t-amber-500',
  condition: 'border-t-purple-500',
  action: 'border-t-slate-500',
  schedule: 'border-t-cyan-500',
  end: 'border-t-gray-500',
};

function cardClasses(nodeType: FlowNodeType, selected: boolean, hasError: boolean): string {
  const ring = hasError
    ? 'ring-2 ring-red-500'
    : selected
      ? 'ring-2 ring-blue-500'
      : 'ring-1 ring-gray-200';
  return `min-w-[160px] max-w-[220px] rounded-lg border-t-4 bg-white shadow-sm px-3 py-2 ${NODE_ACCENTS[nodeType]} ${ring}`;
}

function Card({
  nodeType,
  selected,
  hasError,
  subtitle,
  children,
}: {
  nodeType: FlowNodeType;
  selected: boolean;
  hasError: boolean;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cardClasses(nodeType, selected, hasError)}>
      <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
        <span>{NODE_ICONS[nodeType]}</span>
        <span>{NODE_LABELS[nodeType]}</span>
      </div>
      {subtitle !== undefined && (
        <div className="mt-1 truncate text-xs text-gray-500" title={subtitle}>
          {subtitle}
        </div>
      )}
      {children}
    </div>
  );
}

export function StartNode({ data, selected }: NodeProps<FlowRFNode>) {
  return (
    <Card nodeType="start" selected={selected} hasError={data.hasError}>
      <Handle type="source" position={Position.Bottom} />
    </Card>
  );
}

export function EmailNode({ data, selected }: NodeProps<FlowRFNode>) {
  const subject = typeof data.config.subject === 'string' && data.config.subject.trim()
    ? data.config.subject.trim()
    : 'Uten emne';
  return (
    <Card nodeType="email" selected={selected} hasError={data.hasError} subtitle={subject}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </Card>
  );
}

export function WaitNode({ data, selected }: NodeProps<FlowRFNode>) {
  const days = typeof data.config.days === 'number' ? data.config.days : 0;
  const hours = typeof data.config.hours === 'number' ? data.config.hours : 0;
  return (
    <Card
      nodeType="wait"
      selected={selected}
      hasError={data.hasError}
      subtitle={days || hours ? `${days}d ${hours}t` : undefined}
    >
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </Card>
  );
}

export function ConditionNode({ data, selected }: NodeProps<FlowRFNode>) {
  return (
    <Card nodeType="condition" selected={selected} hasError={data.hasError}>
      <Handle type="target" position={Position.Top} />
      <Handle
        type="source"
        position={Position.Bottom}
        id="ja"
        style={{ left: '25%', background: '#22c55e' }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="nei"
        style={{ left: '75%', background: '#ef4444' }}
      />
      <div className="mt-1 flex justify-between text-[10px] font-semibold">
        <span className="text-green-600">ja</span>
        <span className="text-red-600">nei</span>
      </div>
    </Card>
  );
}

export function ActionNode({ data, selected }: NodeProps<FlowRFNode>) {
  const kind = typeof data.config.kind === 'string' ? data.config.kind : undefined;
  return (
    <Card nodeType="action" selected={selected} hasError={data.hasError} subtitle={kind}>
      <Handle type="target" position={Position.Top} />
      {data.config.kind !== 'exit' && <Handle type="source" position={Position.Bottom} />}
    </Card>
  );
}

export function ScheduleNode({ data, selected }: NodeProps<FlowRFNode>) {
  const anchor = typeof data.config.anchor === 'string' ? data.config.anchor : undefined;
  const off = typeof data.config.offsetDays === 'number' ? data.config.offsetDays : undefined;
  const label = anchor ? SCHEDULE_ANCHOR_LABELS[anchor] ?? anchor : undefined;
  const subtitle = label ? `${label}${off ? ` ${off > 0 ? '+' : ''}${off}d` : ''}` : undefined;
  return (
    <Card nodeType="schedule" selected={selected} hasError={data.hasError} subtitle={subtitle}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </Card>
  );
}

export function EndNode({ data, selected }: NodeProps<FlowRFNode>) {
  return (
    <Card nodeType="end" selected={selected} hasError={data.hasError}>
      <Handle type="target" position={Position.Top} />
    </Card>
  );
}

export const nodeTypes: NodeTypes = {
  start: StartNode,
  email: EmailNode,
  wait: WaitNode,
  condition: ConditionNode,
  action: ActionNode,
  schedule: ScheduleNode,
  end: EndNode,
};
