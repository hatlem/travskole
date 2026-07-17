/**
 * Flow batch runner.
 *
 * Claims a bounded batch of due enrollments, resolves each one's graph
 * (cached per flowId within the batch), and drives it forward via
 * `planStep` — capped at `MAX_HOPS` per enrollment per tick so a
 * misconfigured no-wait loop can't spin forever inside one call. Each
 * enrollment is isolated in its own try/catch so one bad row can't take
 * down the rest of the batch.
 */

import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';
import { getSetting } from '@/lib/settings';
import { sendAdminEmail } from '@/lib/mail';
import { parseJsonArray } from '@/lib/crm/normalize';
import { parseNodeConfig, type FlowNodeType, type GraphEdge, type GraphNode } from './graph';
import { planStep, type StepContext } from './step';
import { sendFlowEmail } from './send';

const BATCH_SIZE = 50;
const MAX_HOPS = 20;
const LEASE_MINUTES = 10;

export interface FlowBatchResult {
  processed: number;
  sent: number;
  failed: number;
  completed: number;
}

interface FlowGraph {
  edges: GraphEdge[];
  nodesById: Map<number, GraphNode>;
  startNodeId: number | null;
}

interface ContactState {
  id: number;
  name: string;
  email: string | null;
  stage: string;
  source: string;
  organizationId: number | null;
  lastActivityAt: Date | null;
  tags: string[];
  deals: { eventType: string | null; eventDate: Date | null; status: string }[];
}

type ClaimedEnrollment = {
  id: number;
  flowId: number;
  contactId: number;
  currentNodeId: number | null;
  flow: { status: string; isMarketing: boolean };
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function loadGraph(flowId: number): Promise<FlowGraph> {
  const [nodeRows, edgeRows] = await Promise.all([
    prisma.flowNode.findMany({ where: { flowId } }),
    prisma.flowEdge.findMany({ where: { flowId } }),
  ]);

  const nodes: GraphNode[] = nodeRows.map((row) => ({
    id: row.id,
    type: row.type as FlowNodeType,
    config: parseNodeConfig(row.config),
  }));
  const edges: GraphEdge[] = edgeRows.map((row) => ({
    id: row.id,
    fromNodeId: row.fromNodeId,
    toNodeId: row.toNodeId,
    branch: row.branch,
  }));

  const startNode = nodes.find((node) => node.type === 'start');
  return {
    edges,
    nodesById: new Map(nodes.map((node) => [node.id, node])),
    startNodeId: startNode?.id ?? null,
  };
}

async function getGraph(flowId: number, cache: Map<number, FlowGraph>): Promise<FlowGraph> {
  const cached = cache.get(flowId);
  if (cached) return cached;
  const graph = await loadGraph(flowId);
  cache.set(flowId, graph);
  return graph;
}

async function loadSegmentRulesById(): Promise<Record<number, string>> {
  const segments = await prisma.segment.findMany({ select: { id: true, rules: true } });
  return Object.fromEntries(segments.map((segment) => [segment.id, segment.rules]));
}

async function loadContactState(contactId: number): Promise<ContactState | null> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: { deals: { select: { eventType: true, eventDate: true, status: true } } },
  });
  if (!contact) return null;
  return {
    id: contact.id,
    name: contact.name,
    email: contact.email,
    stage: contact.stage,
    source: contact.source,
    organizationId: contact.organizationId,
    lastActivityAt: contact.lastActivityAt,
    tags: parseJsonArray(contact.tags),
    deals: contact.deals,
  };
}

/** Applies an `act` step's side effect. Mutates `contact` in place so later
 * hops in the same tick see the updated tags/stage without a re-fetch. */
async function applyAction(
  action: { kind: string; value?: string },
  contact: ContactState,
): Promise<void> {
  switch (action.kind) {
    case 'add_tag': {
      if (!action.value || contact.tags.includes(action.value)) return;
      contact.tags = [...contact.tags, action.value];
      await prisma.contact.update({ where: { id: contact.id }, data: { tags: JSON.stringify(contact.tags) } });
      return;
    }
    case 'remove_tag': {
      if (!action.value || !contact.tags.includes(action.value)) return;
      contact.tags = contact.tags.filter((tag) => tag !== action.value);
      await prisma.contact.update({ where: { id: contact.id }, data: { tags: JSON.stringify(contact.tags) } });
      return;
    }
    case 'set_stage': {
      if (!action.value) return;
      contact.stage = action.value;
      await prisma.contact.update({ where: { id: contact.id }, data: { stage: action.value } });
      return;
    }
    case 'notify_admin': {
      const adminEmail = await getSetting('contact_email');
      const subject = `Flyt-varsel: ${contact.name}`;
      const detail = action.value ? `<p>${escapeHtml(action.value)}</p>` : '';
      const body = `<p>Kontakt: ${escapeHtml(contact.name)} (${escapeHtml(contact.email ?? 'ingen e-post')})</p>${detail}`;
      await sendAdminEmail(adminEmail, subject, body);
      return;
    }
    case 'exit':
      return; // terminal transition is handled by the caller (plan.nextNodeId === null)
    default:
      return;
  }
}

async function failEnrollment(enrollmentId: number, reason: string, now: Date, nodeId?: number): Promise<void> {
  await prisma.flowEnrollment.update({
    where: { id: enrollmentId },
    data: {
      status: 'failed',
      failReason: reason,
      finishedAt: now,
      ...(nodeId !== undefined ? { currentNodeId: nodeId } : {}),
    },
  });
}

interface EnrollmentOutcome {
  sent: number;
  failed: boolean;
  completed: boolean;
}

async function processEnrollment(
  enrollment: ClaimedEnrollment,
  graph: FlowGraph,
  segmentRulesById: Record<number, string>,
  now: Date,
): Promise<EnrollmentOutcome> {
  const contact = await loadContactState(enrollment.contactId);
  if (!contact) {
    await failEnrollment(enrollment.id, 'contact-missing', now);
    return { sent: 0, failed: true, completed: false };
  }

  let currentNodeId = enrollment.currentNodeId ?? graph.startNodeId;
  let sent = 0;

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (currentNodeId === null) {
      await failEnrollment(enrollment.id, 'Flyten mangler en start-node.', now);
      return { sent, failed: true, completed: false };
    }

    const node = graph.nodesById.get(currentNodeId);
    if (!node) {
      await failEnrollment(enrollment.id, 'Noden finnes ikke lenger.', now);
      return { sent, failed: true, completed: false };
    }

    // lastSendOpened: real query wired up in a later task (opened_email
    // support); null here means "no prior tracked send" — same as the
    // condition's own "no send yet" semantics, so this is a safe default.
    const ctx: StepContext = { contact: { ...contact }, segmentRulesById, lastSendOpened: null, now };
    const plan = planStep(node, graph.edges, ctx);

    switch (plan.kind) {
      case 'send_email': {
        const result = await sendFlowEmail({
          enrollmentId: enrollment.id,
          nodeId: node.id,
          contactId: enrollment.contactId,
          subject: plan.subject,
          bodyHtml: plan.bodyHtml,
          senderIdentityId: plan.senderIdentityId,
          isMarketing: enrollment.flow.isMarketing,
        });
        if (result === 'failed') {
          await failEnrollment(enrollment.id, 'send-failed', now, node.id);
          return { sent, failed: true, completed: false };
        }
        // 'sent' | 'already_sent' | 'skipped_suppressed' | 'skipped_no_consent' all advance —
        // only an actual send/network failure halts the enrollment.
        if (result === 'sent') sent++;
        currentNodeId = plan.nextNodeId;
        continue;
      }
      case 'sleep': {
        await prisma.flowEnrollment.update({
          where: { id: enrollment.id },
          data: { currentNodeId: plan.nextNodeId, nextRunAt: plan.until },
        });
        return { sent, failed: false, completed: false };
      }
      case 'advance': {
        currentNodeId = plan.nextNodeId;
        continue;
      }
      case 'act': {
        await applyAction(plan.action, contact);
        if (plan.nextNodeId === null) {
          await prisma.flowEnrollment.update({
            where: { id: enrollment.id },
            data: { status: 'exited', finishedAt: now, currentNodeId: node.id },
          });
          return { sent, failed: false, completed: false };
        }
        currentNodeId = plan.nextNodeId;
        continue;
      }
      case 'complete': {
        await prisma.flowEnrollment.update({
          where: { id: enrollment.id },
          data: { status: 'completed', finishedAt: now, currentNodeId: node.id },
        });
        return { sent, failed: false, completed: true };
      }
      case 'fail': {
        await failEnrollment(enrollment.id, plan.reason, now, node.id);
        return { sent, failed: true, completed: false };
      }
    }
  }

  await failEnrollment(enrollment.id, 'hop-limit', now);
  return { sent, failed: true, completed: false };
}

/**
 * Atomically claims up to `BATCH_SIZE` due, active enrollment ids using
 * `SELECT ... FOR UPDATE SKIP LOCKED` inside a transaction, then immediately
 * bumps their `nextRunAt` forward by a `LEASE_MINUTES` lease before
 * committing. This is what makes overlapping cron ticks safe: a second tick
 * that starts before the first finishes will `SKIP LOCKED` rows the first
 * tick has already claimed (still locked until its transaction commits),
 * and even after that commit those rows' `nextRunAt` is now in the future,
 * so the second tick's own `next_run_at <= now()` filter excludes them too.
 * If an enrollment turns out not to need another tick this soon (e.g. it
 * sleeps for longer, or completes), `processEnrollment` overwrites the
 * leased `nextRunAt` with the real value — the lease is just a placeholder
 * until then.
 */
async function claimDueEnrollmentIds(now: Date): Promise<number[]> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: number }[]>`
      SELECT id FROM flow_enrollments
      WHERE status = 'active' AND next_run_at <= ${now}
      ORDER BY next_run_at ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    `;
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return ids;

    const leaseUntil = new Date(now.getTime() + LEASE_MINUTES * 60_000);
    await tx.flowEnrollment.updateMany({
      where: { id: { in: ids } },
      data: { nextRunAt: leaseUntil },
    });
    return ids;
  });
}

/**
 * Claims up to `BATCH_SIZE` due, active enrollments (see
 * `claimDueEnrollmentIds`) and ticks each one forward. Enrollments whose
 * flow is no longer 'active' (paused/archived) are left untouched beyond
 * the claim/lease — they'll be reconsidered once the lease expires (or
 * sooner, once the flow is reactivated and re-ticked).
 */
export async function runFlowBatch(now: Date = new Date()): Promise<FlowBatchResult> {
  const claimedIds = await claimDueEnrollmentIds(now);
  const result: FlowBatchResult = { processed: 0, sent: 0, failed: 0, completed: 0 };
  if (claimedIds.length === 0) return result;

  const dueEnrollments = await prisma.flowEnrollment.findMany({
    where: { id: { in: claimedIds } },
    orderBy: { id: 'asc' },
    include: { flow: { select: { status: true, isMarketing: true } } },
  });

  const graphCache = new Map<number, FlowGraph>();
  const segmentRulesById = await loadSegmentRulesById();

  for (const enrollment of dueEnrollments) {
    if (enrollment.flow.status !== 'active') continue;

    result.processed++;
    try {
      const graph = await getGraph(enrollment.flowId, graphCache);
      const outcome = await processEnrollment(enrollment, graph, segmentRulesById, now);
      result.sent += outcome.sent;
      if (outcome.failed) result.failed++;
      if (outcome.completed) result.completed++;
    } catch (error) {
      logger.error('runFlowBatch: enrollment failed unexpectedly', {
        enrollmentId: enrollment.id,
        flowId: enrollment.flowId,
        error: error instanceof Error ? error.message : String(error),
      });
      await prisma.flowEnrollment
        .update({ where: { id: enrollment.id }, data: { status: 'failed', failReason: 'runner-error', finishedAt: now } })
        .catch(() => {});
      result.failed++;
    }
  }

  return result;
}
