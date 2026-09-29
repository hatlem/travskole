/**
 * Typede flytmal-definisjoner → `FlowCopy` (samme format som kloning bruker),
 * så malene skrives med `writeFlowCopy` og valideres med `validateFlow`. Ren modul.
 */
import type { EventType } from '@/lib/events/taxonomy';
import type { AnchorMode } from '../status';
import type { FlowCopy } from '../clone';
import { validateFlow, type GraphEdge, type GraphNode, type ValidationError } from '../graph';

/** Verdier som først er kjent ved innsetting (valgt avsender, nettstedets adresse). */
export interface TemplateContext {
  senderIdentityId: number;
  senderName: string;
  siteUrl: string;
}

type Text = string | ((ctx: TemplateContext) => string);

interface Base {
  key: string;
  /** Kolonne i editoren (0 = hovedløpet). Raden beregnes fra grafens dybde. */
  col?: number;
}
interface Linear extends Base {
  next: string;
}

export type TemplateNode =
  | (Base & { type: 'start'; next: string })
  | (Base & { type: 'end' })
  | (Linear & { type: 'email'; subject: string; bodyHtml: Text })
  | (Linear & { type: 'wait'; days?: number; hours?: number })
  | (Linear & { type: 'schedule'; anchor: 'course_start' | 'course_end' | 'course_midway'; offsetDays: number })
  | (Base & {
      type: 'condition';
      kind: 'opened_email' | 'clicked_email' | 'replied_email' | 'deal_status' | 'stage_is';
      value?: string;
      ja: string;
      nei: string;
    })
  | (Linear & { type: 'task'; title: string; dueDays: number })
  | (Linear & { type: 'action'; kind: 'add_tag' | 'remove_tag' | 'set_stage' | 'notify_admin'; value: string });

export interface FlowTemplate {
  name: string;
  description: string;
  isMarketing: boolean;
  anchorMode: AnchorMode;
  triggers: { eventType: EventType; filter?: Record<string, unknown> }[];
  nodes: TemplateNode[];
}

export const COL_WIDTH = 260;
export const ROW_HEIGHT = 120;

function nodeConfig(node: TemplateNode, ctx: TemplateContext): Record<string, unknown> {
  switch (node.type) {
    case 'email':
      return {
        subject: node.subject,
        bodyHtml: typeof node.bodyHtml === 'function' ? node.bodyHtml(ctx) : node.bodyHtml,
        senderIdentityId: ctx.senderIdentityId,
      };
    case 'wait':
      return { ...(node.days !== undefined && { days: node.days }), ...(node.hours !== undefined && { hours: node.hours }) };
    case 'schedule':
      return { anchor: node.anchor, offsetDays: node.offsetDays };
    case 'condition':
      return node.value === undefined ? { kind: node.kind } : { kind: node.kind, value: node.value };
    case 'task':
      return { kind: 'create_task', title: node.title, dueDays: node.dueDays, assignTo: 'owner' };
    case 'action':
      return { kind: node.kind, value: node.value };
    default:
      return {};
  }
}

function outgoing(node: TemplateNode): { to: string; branch: string | null }[] {
  if (node.type === 'end') return [];
  if (node.type === 'condition') return [{ to: node.ja, branch: 'ja' }, { to: node.nei, branch: 'nei' }];
  return [{ to: node.next, branch: null }];
}

/** Rad = lengste vei fra start, så sammenløp havner under begge grenene. */
function computeRows(nodes: TemplateNode[]): Map<string, number> {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const rows = new Map<string, number>();
  const visit = (key: string, depth: number, trail: Set<string>): void => {
    if (trail.has(key) || !byKey.has(key)) return;
    if ((rows.get(key) ?? -1) >= depth) return;
    rows.set(key, depth);
    const next = new Set(trail).add(key);
    for (const edge of outgoing(byKey.get(key)!)) visit(edge.to, depth + 1, next);
  };
  const start = nodes.find((n) => n.type === 'start');
  if (start) visit(start.key, 0, new Set());
  return rows;
}

export function buildTemplateCopy(template: FlowTemplate, ctx: TemplateContext, name = template.name): FlowCopy {
  const refByKey = new Map<string, number>();
  template.nodes.forEach((node, index) => {
    if (refByKey.has(node.key)) throw new Error(`Malen «${template.name}» har duplisert nøkkel «${node.key}».`);
    refByKey.set(node.key, index);
  });
  const rows = computeRows(template.nodes);

  const edges: FlowCopy['edges'] = [];
  for (const node of template.nodes) {
    for (const edge of outgoing(node)) {
      const toRef = refByKey.get(edge.to);
      if (toRef === undefined) throw new Error(`Malen «${template.name}» peker på ukjent node «${edge.to}».`);
      edges.push({ fromRef: refByKey.get(node.key)!, toRef, branch: edge.branch });
    }
  }

  return {
    flow: {
      name,
      description: template.description,
      isMarketing: template.isMarketing,
      anchorMode: template.anchorMode,
      status: 'template',
    },
    nodes: template.nodes.map((node, index) => ({
      ref: index,
      type: node.type === 'task' ? 'action' : node.type,
      config: JSON.stringify(nodeConfig(node, ctx)),
      posX: (node.col ?? 0) * COL_WIDTH,
      posY: (rows.get(node.key) ?? 0) * ROW_HEIGHT,
    })),
    edges,
    triggers: template.triggers.map((t) => ({ eventType: t.eventType, filter: JSON.stringify(t.filter ?? {}) })),
  };
}

/** Kjører samme validering som aktivering bruker, på en kopi som ennå ikke er lagret. */
export function validateFlowCopy(copy: FlowCopy): ValidationError[] {
  const nodes: GraphNode[] = copy.nodes.map((n) => ({
    id: n.ref,
    type: n.type as GraphNode['type'],
    config: JSON.parse(n.config) as Record<string, unknown>,
  }));
  const edges: GraphEdge[] = copy.edges.map((e, i) => ({ id: i, fromNodeId: e.fromRef, toNodeId: e.toRef, branch: e.branch }));
  return validateFlow(nodes, edges);
}
