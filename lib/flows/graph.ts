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

export const CONDITION_KINDS = ['in_segment', 'stage_is', 'deal_status', 'opened_email', 'clicked_email', 'replied_email'] as const;
export const ACTION_KINDS = ['add_tag', 'remove_tag', 'set_stage', 'notify_admin', 'create_task', 'exit'] as const;
/** Betingelser som ser på siste e-post i enrollmentet og ikke trenger `value`. */
export const ENGAGEMENT_CONDITION_KINDS: ReadonlySet<string> = new Set(['opened_email', 'clicked_email', 'replied_email']);
export const TASK_DUE_DAYS_MAX = 365;
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
  return err(node.id, 'email_config', 'E-posten mangler emne, tekst eller avsender. Klikk på steget og fyll inn det som mangler.');
}

function validateWaitConfig(node: GraphNode): ValidationError | null {
  const { days, hours } = node.config;
  if (days !== undefined && !isFiniteNumber(days)) {
    return err(node.id, 'wait_config', 'Antall dager må være et helt tall.');
  }
  if (hours !== undefined && !isFiniteNumber(hours)) {
    return err(node.id, 'wait_config', 'Antall timer må være et helt tall.');
  }
  if (isFiniteNumber(days) && days < 0) {
    return err(node.id, 'wait_config', 'Antall dager kan ikke være mindre enn 0.');
  }
  if (isFiniteNumber(hours) && hours < 0) {
    return err(node.id, 'wait_config', 'Antall timer kan ikke være mindre enn 0.');
  }
  const totalHours = (isFiniteNumber(days) ? days : 0) * 24 + (isFiniteNumber(hours) ? hours : 0);
  if (totalHours < 1) {
    return err(node.id, 'wait_config', 'Ventetiden må være minst 1 time. Fyll inn dager eller timer.');
  }
  return null;
}

function validateConditionConfig(node: GraphNode): ValidationError | null {
  const { kind, value } = node.config;
  const validKind = typeof kind === 'string' && (CONDITION_KINDS as readonly string[]).includes(kind);
  if (!validKind) {
    return err(node.id, 'condition_config', 'Velg hva som skal sjekkes, og hva svaret skal sammenlignes med.');
  }
  if (!ENGAGEMENT_CONDITION_KINDS.has(kind) && !hasValue(value)) {
    return err(node.id, 'condition_config', 'Velg hva som skal sjekkes, og hva svaret skal sammenlignes med.');
  }
  return null;
}

function validateActionConfig(node: GraphNode): ValidationError | null {
  const { kind, value } = node.config;
  const validKind = typeof kind === 'string' && (ACTION_KINDS as readonly string[]).includes(kind);
  if (!validKind) {
    return err(node.id, 'action_config', 'Velg hva som skal gjøres.');
  }
  if (ACTION_KINDS_REQUIRING_VALUE.has(kind as string) && !hasValue(value)) {
    return err(node.id, 'action_config', 'Fyll inn stikkord eller kundestatus.');
  }
  if (kind === 'create_task') return validateCreateTaskConfig(node);
  return null;
}

function validateCreateTaskConfig(node: GraphNode): ValidationError | null {
  const { title, assigneeUserId, assignTo, dueDays } = node.config;
  if (!isNonEmptyString(title)) {
    return err(node.id, 'action_config', 'Oppgaven mangler en tittel.');
  }
  if (title.length > 300) {
    return err(node.id, 'action_config', 'Oppgavetittelen kan være maks 300 tegn.');
  }
  if (assigneeUserId !== undefined && assigneeUserId !== null && !(isInteger(assigneeUserId) && assigneeUserId > 0)) {
    return err(node.id, 'action_config', 'Den valgte ansvarlige finnes ikke lenger. Velg en annen.');
  }
  if (assignTo !== undefined && assignTo !== null && assignTo !== 'owner') {
    return err(node.id, 'action_config', 'Velg hvem som skal få oppgaven.');
  }
  if (dueDays !== undefined && dueDays !== null && !(isInteger(dueDays) && dueDays >= 0 && dueDays <= TASK_DUE_DAYS_MAX)) {
    return err(node.id, 'action_config', `Frist må være et helt antall dager mellom 0 og ${TASK_DUE_DAYS_MAX}.`);
  }
  return null;
}

function validateScheduleConfig(node: GraphNode): ValidationError | null {
  const { anchor, offsetDays } = node.config;
  const validAnchor = typeof anchor === 'string' && (SCHEDULE_ANCHORS as readonly string[]).includes(anchor);
  if (!validAnchor) {
    return err(node.id, 'schedule_config', 'Velg hvilken kursdato e-posten skal regnes fra.');
  }
  if (offsetDays !== undefined && !isInteger(offsetDays)) {
    return err(node.id, 'schedule_config', 'Antall dager før/etter kursdatoen må være et helt tall.');
  }
  const { ifPast } = node.config;
  if (ifPast !== undefined && ifPast !== 'send' && ifPast !== 'skip') {
    return err(node.id, 'schedule_config', 'Velg hva som skal skje hvis tidspunktet allerede har passert.');
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
    return [err(null, 'no_start', 'Flyten mangler et «Start»-steg. Legg til «Start» og koble det til første e-post.')];
  }
  if (startNodes.length > 1) {
    return [err(null, 'multiple_starts', 'Flyten har flere «Start»-steg. Slett alle unntatt ett.')];
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
      errors.push(err(node.id, 'unreachable', 'Steget henger ikke sammen med «Start». Dra en pil fra steget før og hit.'));
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
        errors.push(err(edge.toNodeId, 'cycle', 'Pilene går i ring. En flyt må gå fremover fra start til slutt.'));
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
        errors.push(err(node.id, 'end_with_edge', 'Ingenting kan komme etter «Slutt». Fjern pilen ut fra steget.'));
      }
      continue;
    }

    if (node.type === 'condition') {
      const branches = nodeOutgoing.map((edge) => edge.branch).sort();
      const isValid = nodeOutgoing.length === 2 && branches[0] === 'ja' && branches[1] === 'nei';
      if (!isValid) {
        errors.push(err(node.id, 'missing_branch', 'Sjekken trenger to piler: én fra «ja» og én fra «nei».'));
      }
      continue;
    }

    if (isExitAction(node)) {
      if (nodeOutgoing.length > 0) {
        errors.push(err(node.id, 'exit_with_edge', 'Ingenting kan komme etter «Ta ut av flyten». Fjern pilen ut fra steget.'));
      }
      continue;
    }

    const isValid = nodeOutgoing.length === 1 && nodeOutgoing[0].branch === null;
    if (!isValid) {
      errors.push(err(node.id, 'missing_edge', 'Steget fører ingen steder. Dra en pil herfra til neste steg (eller til «Slutt»).'));
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
      errors.push(err(nodeId, 'dead_end', 'Herfra kommer man aldri til «Slutt». Koble steget videre til et «Slutt»-steg.'));
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
