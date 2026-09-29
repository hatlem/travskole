/**
 * Pure step planner for the flow engine.
 *
 * Given a node, its outgoing edges, and the evaluation context (contact +
 * segment rules + clock), decides what to do next. No I/O, no Prisma — the
 * runner is responsible for turning a `StepPlan` into actual side effects
 * (sending mail, writing enrollment state, etc).
 */

import type { GraphEdge, GraphNode } from './graph';
import { contactMatchesSegment, parseSegmentRules, type SegmentContact } from '@/lib/crm/segments';
import { computeAnchorDay, osloDayStartUtc, type ScheduleAnchor } from './schedule';

export interface StepContext {
  contact: SegmentContact & { stage: string | null; tags: string[] };
  segmentRulesById: Record<number, string>; // segmentId → raw rules-JSON (for in_segment)
  lastSendOpened: boolean | null; // most recent tracked email-node send's openedAt !== null in THIS enrollment; null = no prior tracked send exists
  lastSendClicked?: boolean | null; // samme send: minst ett sporet klikk
  lastSendReplied?: boolean | null; // samme send: repliedAt satt
  now: Date;
  courseDates?: { startDate: Date | null; endDate: Date | null } | null; // fra enrollmentens registrering; undefined/null = ingen kurs-anker
}

export interface TaskActionPayload {
  title: string;
  assigneeUserId: number | null;
  dueDays: number | null;
}

export interface PlannedAction {
  kind: string;
  value?: string;
  task?: TaskActionPayload;
}

export type StepPlan =
  | {
    kind: 'send_email'; subject: string; bodyHtml: string; senderIdentityId: number;
    aiPersonalize: boolean; aiReview: 'auto' | 'approve'; nextNodeId: number;
  }
  | { kind: 'sleep'; until: Date; nextNodeId: number }
  | { kind: 'advance'; nextNodeId: number } // condition/action fortsetter umiddelbart
  | { kind: 'act'; action: PlannedAction; nextNodeId: number | null } // null ⇒ exit-terminal
  | { kind: 'complete' }
  | { kind: 'fail'; reason: string };

const fail = (reason: string): StepPlan => ({ kind: 'fail', reason });

const outgoingEdges = (node: GraphNode, edges: GraphEdge[]): GraphEdge[] =>
  edges.filter((edge) => edge.fromNodeId === node.id);

const findEdgeByBranch = (edges: GraphEdge[], branch: string | null): GraphEdge | undefined =>
  edges.find((edge) => edge.branch === branch);

function planStart(node: GraphNode, edges: GraphEdge[]): StepPlan {
  const edge = findEdgeByBranch(outgoingEdges(node, edges), null);
  if (!edge) return fail('Start-noden mangler en utgående kobling.');
  return { kind: 'advance', nextNodeId: edge.toNodeId };
}

function planEmail(node: GraphNode, edges: GraphEdge[]): StepPlan {
  const { subject, bodyHtml, senderIdentityId } = node.config;
  if (typeof subject !== 'string' || typeof bodyHtml !== 'string' || typeof senderIdentityId !== 'number') {
    return fail('E-post-noden har en ugyldig konfigurasjon.');
  }
  const edge = findEdgeByBranch(outgoingEdges(node, edges), null);
  if (!edge) return fail('E-post-noden mangler en utgående kobling.');
  const aiPersonalize = node.config.aiPersonalize === true;
  // Manglende nøkkel ⇒ 'auto': eldre noder skal ikke plutselig stoppe opp i kø.
  const aiReview = node.config.aiReview === 'approve' ? 'approve' : 'auto';
  return { kind: 'send_email', subject, bodyHtml, senderIdentityId, aiPersonalize, aiReview, nextNodeId: edge.toNodeId };
}

function planWait(node: GraphNode, edges: GraphEdge[], ctx: StepContext): StepPlan {
  const edge = findEdgeByBranch(outgoingEdges(node, edges), null);
  if (!edge) return fail('Vent-noden mangler en utgående kobling.');
  const days = typeof node.config.days === 'number' ? node.config.days : 0;
  const hours = typeof node.config.hours === 'number' ? node.config.hours : 0;
  const totalMs = (days * 24 + hours) * 60 * 60 * 1000;
  const until = new Date(ctx.now.getTime() + totalMs);
  return { kind: 'sleep', until, nextNodeId: edge.toNodeId };
}

/** Returns null when the condition config itself is malformed/unrecognized. */
function evaluateCondition(node: GraphNode, ctx: StepContext): boolean | null {
  const { kind, value } = node.config;

  // Manglende tidligere sending ⇒ «nei», aldri en feil.
  if (kind === 'opened_email') return ctx.lastSendOpened === true;
  if (kind === 'clicked_email') return ctx.lastSendClicked === true;
  if (kind === 'replied_email') return ctx.lastSendReplied === true;

  if (value === undefined || value === null) return null;

  if (kind === 'in_segment') {
    const segmentId = Number(value);
    const rawRules = ctx.segmentRulesById[segmentId];
    if (rawRules === undefined) return false; // referenced segment missing rules ⇒ nei, not a failure
    return contactMatchesSegment(ctx.contact, parseSegmentRules(rawRules));
  }
  if (kind === 'stage_is') {
    return ctx.contact.stage === value;
  }
  if (kind === 'deal_status') {
    return ctx.contact.deals.some((deal) => deal.status === value);
  }
  return null;
}

function planCondition(node: GraphNode, edges: GraphEdge[], ctx: StepContext): StepPlan {
  const matches = evaluateCondition(node, ctx);
  if (matches === null) return fail('Betingelses-noden har en ugyldig konfigurasjon.');
  const branch = matches ? 'ja' : 'nei';
  const edge = findEdgeByBranch(outgoingEdges(node, edges), branch);
  if (!edge) return fail(`Betingelses-noden mangler «${branch}»-grenen.`);
  return { kind: 'advance', nextNodeId: edge.toNodeId };
}

function planAction(node: GraphNode, edges: GraphEdge[]): StepPlan {
  const { kind } = node.config;
  if (typeof kind !== 'string') return fail('Handlings-noden har en ugyldig type.');
  const value = typeof node.config.value === 'string' ? node.config.value : undefined;

  if (kind === 'exit') {
    return { kind: 'act', action: { kind, value }, nextNodeId: null };
  }
  const edge = findEdgeByBranch(outgoingEdges(node, edges), null);
  if (!edge) return fail('Handlings-noden mangler en utgående kobling.');
  if (kind === 'create_task') {
    const task = parseTaskPayload(node.config);
    if (!task) return fail('Oppgave-handlingen har en ugyldig konfigurasjon.');
    return { kind: 'act', action: { kind, task }, nextNodeId: edge.toNodeId };
  }
  return { kind: 'act', action: { kind, value }, nextNodeId: edge.toNodeId };
}

function parseTaskPayload(config: Record<string, unknown>): TaskActionPayload | null {
  const { title, assigneeUserId, dueDays } = config;
  if (typeof title !== 'string' || title.trim() === '') return null;
  const assignee = typeof assigneeUserId === 'number' && Number.isInteger(assigneeUserId) && assigneeUserId > 0
    ? assigneeUserId
    : null;
  const due = typeof dueDays === 'number' && Number.isInteger(dueDays) && dueDays >= 0 ? dueDays : null;
  return { title: title.trim(), assigneeUserId: assignee, dueDays: due };
}

function planSchedule(node: GraphNode, edges: GraphEdge[], ctx: StepContext): StepPlan {
  const edge = findEdgeByBranch(outgoingEdges(node, edges), null);
  if (!edge) return fail('Planleggings-noden mangler en utgående kobling.');
  const anchor = node.config.anchor;
  if (anchor !== 'course_start' && anchor !== 'course_end' && anchor !== 'course_midway') {
    return fail('Planleggings-noden har et ugyldig anker.');
  }
  const offsetDays = typeof node.config.offsetDays === 'number' ? node.config.offsetDays : 0;
  const dates = ctx.courseDates ?? null;
  const graceExit = (reason: string): StepPlan =>
    ({ kind: 'act', action: { kind: 'exit', value: reason }, nextNodeId: null });
  if (!dates) return graceExit('schedule: enrollment mangler kurs-anker');
  const day = computeAnchorDay(anchor as ScheduleAnchor, offsetDays, dates.startDate, dates.endDate);
  if (day === null) return graceExit(`schedule: kurs mangler dato for anker ${anchor}`);
  return { kind: 'sleep', until: osloDayStartUtc(day), nextNodeId: edge.toNodeId };
}

export function planStep(node: GraphNode, edges: GraphEdge[], ctx: StepContext): StepPlan {
  switch (node.type) {
    case 'start':
      return planStart(node, edges);
    case 'email':
      return planEmail(node, edges);
    case 'wait':
      return planWait(node, edges, ctx);
    case 'condition':
      return planCondition(node, edges, ctx);
    case 'action':
      return planAction(node, edges);
    case 'schedule':
      return planSchedule(node, edges, ctx);
    case 'end':
      return { kind: 'complete' };
    default:
      return fail('Ukjent node-type.');
  }
}
