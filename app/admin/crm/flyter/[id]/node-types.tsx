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
  email: 'Send e-post',
  wait: 'Vent',
  condition: 'Sjekk (ja/nei)',
  action: 'Gjør noe',
  schedule: 'Vent til kursdato',
  end: 'Slutt',
};

/** Kort forklaring per stegtype — vises i paletten og i panelet for valgt steg. */
export const NODE_DESCRIPTIONS: Record<FlowNodeType, string> = {
  start: 'Her begynner flyten. Hver flyt trenger ett.',
  email: 'Sender en e-post du skriver selv.',
  wait: 'Venter et antall dager eller timer før neste steg.',
  condition: 'Deler flyten i to: én vei for «ja» og én for «nei».',
  action: 'Gir stikkord, endrer kundestatus, lager en oppgave eller varsler dere.',
  schedule: 'Venter til f.eks. 3 dager før kursstart. Bare for kursflyter.',
  end: 'Her er flyten ferdig for personen.',
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

export const SCHEDULE_ANCHOR_LABELS: Record<string, string> = {
  course_start: 'Kursstart',
  course_midway: 'Halvveis i kurset',
  course_end: 'Kursslutt',
};

export const CONDITION_LABELS: Record<string, string> = {
  in_segment: 'Er med i segment?',
  stage_is: 'Har kundestatus?',
  deal_status: 'Har avtale med status?',
  opened_email: 'Åpnet forrige e-post?',
  clicked_email: 'Klikket i forrige e-post?',
  replied_email: 'Svarte på forrige e-post?',
};

export const ACTION_LABELS: Record<string, string> = {
  add_tag: 'Gi stikkord',
  remove_tag: 'Fjern stikkord',
  set_stage: 'Endre kundestatus',
  notify_admin: 'Send varsel til dere',
  create_task: 'Lag en oppgave',
  exit: 'Ta personen ut av flyten',
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

function waitSubtitle(days: number, hours: number): string {
  const parts = [days ? `${days} ${days === 1 ? 'dag' : 'dager'}` : '', hours ? `${hours} ${hours === 1 ? 'time' : 'timer'}` : ''];
  return parts.filter(Boolean).join(' og ');
}

function scheduleSubtitle(label: string, offsetDays: number | undefined): string {
  if (!offsetDays) return label;
  const n = Math.abs(offsetDays);
  return `${n} ${n === 1 ? 'dag' : 'dager'} ${offsetDays < 0 ? 'før' : 'etter'} ${label.toLowerCase()}`;
}

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
      subtitle={days || hours ? waitSubtitle(days, hours) : undefined}
    >
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </Card>
  );
}

export function ConditionNode({ data, selected }: NodeProps<FlowRFNode>) {
  const kind = typeof data.config.kind === 'string' ? data.config.kind : undefined;
  return (
    <Card
      nodeType="condition"
      selected={selected}
      hasError={data.hasError}
      subtitle={kind ? CONDITION_LABELS[kind] ?? kind : undefined}
    >
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
  const detail =
    kind === 'create_task' && typeof data.config.title === 'string' && data.config.title.trim()
      ? `: ${data.config.title.trim()}`
      : typeof data.config.value === 'string' && data.config.value.trim()
        ? `: ${data.config.value.trim()}`
        : '';
  const subtitle = kind ? `${ACTION_LABELS[kind] ?? kind}${detail}` : undefined;
  return (
    <Card nodeType="action" selected={selected} hasError={data.hasError} subtitle={subtitle}>
      <Handle type="target" position={Position.Top} />
      {data.config.kind !== 'exit' && <Handle type="source" position={Position.Bottom} />}
    </Card>
  );
}

export function ScheduleNode({ data, selected }: NodeProps<FlowRFNode>) {
  const anchor = typeof data.config.anchor === 'string' ? data.config.anchor : undefined;
  const off = typeof data.config.offsetDays === 'number' ? data.config.offsetDays : undefined;
  const label = anchor ? SCHEDULE_ANCHOR_LABELS[anchor] ?? anchor : undefined;
  const subtitle = label ? scheduleSubtitle(label, off) : undefined;
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
