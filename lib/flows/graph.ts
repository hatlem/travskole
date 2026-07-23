/**
 * Pure graph parsing + validation for the flow engine.
 *
 * No imports beyond types — this module must be safe to run anywhere
 * (server, edge, tests) without touching Prisma or any I/O. Activation of a
 * flow gates on `validateFlow` returning an empty array.
 */

export type FlowNodeType = 'start' | 'email' | 'wait' | 'condition' | 'action' | 'end' | 'schedule';

export interface GraphNode {
  id: number;
  type: FlowNodeType;
  config: Record<string, unknown>;
}

export interface GraphEdge {
  id: number;
  fromNodeId: number;
  toNodeId: number;
  branch: string | null;
}

export interface ValidationError {
  nodeId: number | null;
  code: string;
  message: string;
}

/** Tolerant JSON parse: returns `{}` for garbage input or non-object JSON. */
export function parseNodeConfig(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

const CONDITION_KINDS = ['in_segment', 'stage_is', 'deal_status', 'opened_email'] as const;
const ACTION_KINDS = ['add_tag', 'remove_tag', 'set_stage', 'notify_admin', 'exit'] as const;
const ACTION_KINDS_REQUIRING_VALUE = new Set(['add_tag', 'remove_tag', 'set_stage']);
const SCHEDULE_ANCHORS = ['course_start', 'course_end', 'course_midway'] as const;

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isInteger = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const hasValue = (v: unknown): boolean => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');

function err(nodeId: number | null, code: string, message: string): ValidationError {
  return { nodeId, code, message };
}

function validateEmailConfig(node: GraphNode): ValidationError | null {
  const { subject, bodyHtml, senderIdentityId } = node.config;
  const ok = isNonEmptyString(subject) && isNonEmptyString(bodyHtml) && isInteger(senderIdentityId);
  if (ok) return null;
  return err(node.id, 'email_config', 'E-post-noden mangler emne, innhold eller avsender.');
}

function validateWaitConfig(node: GraphNode): ValidationError | null {
  const { days, hours } = node.config;
  if (days !== undefined && !isFiniteNumber(days)) {
    return err(node.id, 'wait_config', 'Vent-noden har en ugyldig verdi for dager.');
  }
  if (hours !== undefined && !isFiniteNumber(hours)) {
    return err(node.id, 'wait_config', 'Vent-noden har en ugyldig verdi for timer.');
  }
  if (isFiniteNumber(days) && days < 0) {
    return err(node.id, 'wait_config', 'Vent-noden kan ikke ha negative dager.');
  }
  if (isFiniteNumber(hours) && hours < 0) {
    return err(node.id, 'wait_config', 'Vent-noden kan ikke ha negative timer.');
  }
  const totalHours = (isFiniteNumber(days) ? days : 0) * 24 + (isFiniteNumber(hours) ? hours : 0);
  if (totalHours < 1) {
    return err(node.id, 'wait_config', 'Vent-noden må ha en varighet på minst 1 time.');
  }
  return null;
}

function validateConditionConfig(node: GraphNode): ValidationError | null {
  const { kind, value } = node.config;
  const validKind = typeof kind === 'string' && (CONDITION_KINDS as readonly string[]).includes(kind);
  if (!validKind) {
    return err(node.id, 'condition_config', 'Betingelses-noden mangler type eller verdi.');
  }
  if (kind !== 'opened_email' && !hasValue(value)) {
    return err(node.id, 'condition_config', 'Betingelses-noden mangler type eller verdi.');
  }
  return null;
}

function validateActionConfig(node: GraphNode): ValidationError | null {
  const { kind, value } = node.config;
  const validKind = typeof kind === 'string' && (ACTION_KINDS as readonly string[]).includes(kind);
  if (!validKind) {
    return err(node.id, 'action_config', 'Handlings-noden har en ugyldig type.');
  }
  if (ACTION_KINDS_REQUIRING_VALUE.has(kind as string) && !hasValue(value)) {
    return err(node.id, 'action_config', 'Handlings-noden mangler en verdi.');
  }
  return null;
}

function validateScheduleConfig(node: GraphNode): ValidationError | null {
  const { anchor, offsetDays } = node.config;
  const validAnchor = typeof anchor === 'string' && (SCHEDULE_ANCHORS as readonly string[]).includes(anchor);
  if (!validAnchor) {
    return err(node.id, 'schedule_config', 'Planleggings-noden mangler et gyldig anker.');
  }
  if (offsetDays !== undefined && !isInteger(offsetDays)) {
    return err(node.id, 'schedule_config', 'Planleggings-noden har en ugyldig forskyvning.');
  }
  return null;
}

const isExitAction = (node: GraphNode): boolean => node.type === 'action' && node.config.kind === 'exit';

/**
 * Structural graph checks: start count, reachability, cycles, edge-count/branch
 * rules, and dead-end (every path must reach `end` or a terminal exit-action).
 */
function validateStructure(nodes: GraphNode[], edges: GraphEdge[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  const startNodes = nodes.filter((node) => node.type === 'start');
  if (startNodes.length === 0) {
    return [err(null, 'no_start', 'Flyten må ha nøyaktig én start-node.')];
  }
  if (startNodes.length > 1) {
    return [err(null, 'multiple_starts', 'Flyten kan bare ha én start-node.')];
  }
  const [startNode] = startNodes;

  const outgoing = new Map<number, GraphEdge[]>();
  for (const node of nodes) outgoing.set(node.id, []);
  for (const edge of edges) {
    if (!outgoing.has(edge.fromNodeId)) continue; // dangling edge reference; ignore
    outgoing.get(edge.fromNodeId)!.push(edge);
  }

  // --- BFS reachability from start ---
  const reachable = new Set<number>([startNode.id]);
  const queue: number[] = [startNode.id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of outgoing.get(current) ?? []) {
      if (nodesById.has(edge.toNodeId) && !reachable.has(edge.toNodeId)) {
        reachable.add(edge.toNodeId);
        queue.push(edge.toNodeId);
      }
    }
  }
  for (const node of nodes) {
    if (!reachable.has(node.id)) {
      errors.push(err(node.id, 'unreachable', 'Noden kan ikke nås fra start-noden.'));
    }
  }

  // --- DFS cycle detection (3-color) over the whole graph ---
  const color = new Map<number, 'white' | 'gray' | 'black'>(nodes.map((node) => [node.id, 'white']));
  let cycleReported = false;
  const visit = (nodeId: number): void => {
    if (cycleReported) return;
    color.set(nodeId, 'gray');
    for (const edge of outgoing.get(nodeId) ?? []) {
      if (cycleReported) return;
      if (!nodesById.has(edge.toNodeId)) continue;
      const state = color.get(edge.toNodeId);
      if (state === 'gray') {
        errors.push(err(edge.toNodeId, 'cycle', 'Flyten har en løkke — flyter må være uten sykler.'));
        cycleReported = true;
        return;
      }
      if (state === 'white') visit(edge.toNodeId);
    }
    color.set(nodeId, 'black');
  };
  for (const node of nodes) {
    if (cycleReported) break;
    if (color.get(node.id) === 'white') visit(node.id);
  }

  // --- Edge-count / branch rules ---
  for (const node of nodes) {
    const nodeOutgoing = outgoing.get(node.id) ?? [];

    if (node.type === 'end') {
      if (nodeOutgoing.length > 0) {
        errors.push(err(node.id, 'end_with_edge', 'Slutt-noden kan ikke ha utgående koblinger.'));
      }
      continue;
    }

    if (node.type === 'condition') {
      const branches = nodeOutgoing.map((edge) => edge.branch).sort();
      const isValid = nodeOutgoing.length === 2 && branches[0] === 'ja' && branches[1] === 'nei';
      if (!isValid) {
        errors.push(err(node.id, 'missing_branch', 'Betingelses-noden må ha nøyaktig to grener: «ja» og «nei».'));
      }
      continue;
    }

    if (isExitAction(node)) {
      if (nodeOutgoing.length > 0) {
        errors.push(err(node.id, 'exit_with_edge', 'En avslutt-handling kan ikke ha utgående kobling.'));
      }
      continue;
    }

    const isValid = nodeOutgoing.length === 1 && nodeOutgoing[0].branch === null;
    if (!isValid) {
      errors.push(err(node.id, 'missing_edge', 'Noden mangler en utgående kobling.'));
    }
  }

  // --- dead_end: every node reachable from start must be able to reach a
  // terminal (`end` node, or a terminal exit-action) ---
  const isTerminal = (node: GraphNode): boolean => node.type === 'end' || isExitAction(node);
  const reverseAdj = new Map<number, number[]>();
  for (const node of nodes) reverseAdj.set(node.id, []);
  for (const edge of edges) {
    if (!nodesById.has(edge.fromNodeId) || !nodesById.has(edge.toNodeId)) continue;
    reverseAdj.get(edge.toNodeId)!.push(edge.fromNodeId);
  }
  const canReachTerminal = new Set<number>();
  const terminalQueue: number[] = [];
  for (const node of nodes) {
    if (isTerminal(node)) {
      canReachTerminal.add(node.id);
      terminalQueue.push(node.id);
    }
  }
  while (terminalQueue.length > 0) {
    const current = terminalQueue.shift()!;
    for (const predecessorId of reverseAdj.get(current) ?? []) {
      if (!canReachTerminal.has(predecessorId)) {
        canReachTerminal.add(predecessorId);
        terminalQueue.push(predecessorId);
      }
    }
  }
  for (const nodeId of reachable) {
    if (!canReachTerminal.has(nodeId)) {
      errors.push(err(nodeId, 'dead_end', 'Det finnes en vei fra start som aldri når en slutt-node.'));
    }
  }

  return errors;
}

function validateConfigs(nodes: GraphNode[]): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const node of nodes) {
    const configError =
      node.type === 'email'
        ? validateEmailConfig(node)
        : node.type === 'wait'
          ? validateWaitConfig(node)
          : node.type === 'condition'
            ? validateConditionConfig(node)
            : node.type === 'action'
              ? validateActionConfig(node)
              : node.type === 'schedule'
                ? validateScheduleConfig(node)
                : null;
    if (configError) errors.push(configError);
  }
  return errors;
}

export function validateFlow(nodes: GraphNode[], edges: GraphEdge[]): ValidationError[] {
  const structureErrors = validateStructure(nodes, edges);
  // no_start / multiple_starts short-circuit: nothing else is well-defined
  // without exactly one start node, so don't cascade further noise.
  if (structureErrors.some((e) => e.code === 'no_start' || e.code === 'multiple_starts')) {
    return structureErrors;
  }
  return [...structureErrors, ...validateConfigs(nodes)];
}
