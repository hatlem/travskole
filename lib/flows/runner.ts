/**
 * Flow batch runner.
 *
 * Claims a bounded batch of due enrollments, resolves each one's graph
 * (cached per flowId within the batch), and drives it forward via
 * `planStep` — capped at `MAX_HOPS` per enrollment per tick so a
 * misconfigured no-wait loop can't spin forever inside one call. Waits whose
 * target time has already passed continue in the same tick. Each
 * enrollment is isolated in its own try/catch so one bad row can't take
 * down the rest of the batch.
 */

import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';
import { notifyTaskAssignee } from '@/lib/crm/task-notify';
import { defaultTaskAssigneeId } from '@/lib/crm/reply-task';
import { getSetting } from '@/lib/settings';
import { sendAdminEmail } from '@/lib/mail';
import { parseJsonArray } from '@/lib/crm/normalize';
import { ENGAGEMENT_CONDITION_KINDS, parseNodeConfig, type FlowNodeType, type GraphEdge, type GraphNode } from './graph';
import { planStep, type PlannedAction, type StepContext, type TaskActionPayload } from './step';
import { sendFlowEmail } from './send';
import { findReview } from '@/lib/ai/review';
import { isExactSendWindowParking, type SendWindow } from './send-window';
import { effectiveWindowFor, loadSendWindowConfig } from './send-window-store';
import { STOP_REASON_NO_CONSENT, STOP_REASON_SUPPRESSED } from './enrollment-status';

export const BATCH_SIZE = 50;
const MAX_HOPS = 20;
export const LEASE_MINUTES = 10;
/** Tidsbudsjett for én cron-kjøring — godt under Azures ~230 s og langt under leasen. */
export const DRAIN_BUDGET_MS = 75_000;

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
  registrationId: number | null;
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

interface LastSendEngagement {
  opened: boolean;
  clicked: boolean;
  replied: boolean;
}

/**
 * Engasjement på kontaktens siste EKTE (dedupeKey-bærende) e-post i DENNE
 * enrollmentet — kun faktisk sendte/forsøkte sendinger har en dedupeKey
 * (skippede/re-opprettede feilrader har det aldri, se lib/flows/send.ts).
 * `null` betyr «ingen tidligere sporet sending», som betingelsene tolker som «nei».
 */
async function loadLastSendEngagement(enrollmentId: number): Promise<LastSendEngagement | null> {
  const send = await prisma.messageSend.findFirst({
    where: { enrollmentId, dedupeKey: { not: null } },
    orderBy: { sentAt: 'desc' },
    select: { openedAt: true, firstClickedAt: true, clickCount: true, repliedAt: true },
  });
  if (!send) return null;
  return {
    // Et klikk forutsetter en åpning, selv om sporingspikselen ble blokkert.
    opened: send.openedAt !== null || send.firstClickedAt !== null || send.clickCount > 0,
    clicked: send.firstClickedAt !== null || send.clickCount > 0,
    replied: send.repliedAt !== null,
  };
}

/** Live kursdatoer for en enrollment, eller null om den ikke er kurs-forankret. */
async function loadCourseDates(registrationId: number | null): Promise<{ startDate: Date | null; endDate: Date | null } | null> {
  if (registrationId == null) return null;
  const reg = await prisma.registration.findUnique({
    where: { id: registrationId },
    select: { course: { select: { startDate: true, endDate: true } } },
  });
  if (!reg) return null;
  return { startDate: reg.course.startDate, endDate: reg.course.endDate };
}

/** Applies an `act` step's side effect. Mutates `contact` in place so later
 * hops in the same tick see the updated tags/stage without a re-fetch. */
async function applyAction(
  action: PlannedAction,
  contact: ContactState,
  now: Date,
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
    case 'create_task': {
      if (!action.task) return;
      await createFlowTask(action.task, contact.id, now);
      return;
    }
    case 'exit':
      return; // terminal transition is handled by the caller (plan.nextNodeId === null)
    default:
      return;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

async function activeAdminId(userId: number | null | undefined): Promise<number | null> {
  if (userId == null) return null;
  const user = await prisma.user.findFirst({
    where: { id: userId, role: { in: ['admin', 'superadmin'] }, deactivatedAt: null },
    select: { id: true },
  });
  return user?.id ?? null;
}

/**
 * Oppretter en CRM-oppgave på kontakten. Rekkefølge ved «kontaktens ansvarlige»:
 * kontaktens eier → bedriftens eier → fast ansvarlig → standard ansvarlig for
 * oppgaver (innstilling). Finnes ingen aktiv admin, blir oppgaven ufordelt i
 * stedet for at enrollmentet feiler.
 */
async function createFlowTask(task: TaskActionPayload, contactId: number, now: Date): Promise<void> {
  let assigneeId: number | null = null;
  if (task.assignToOwner) {
    const owners = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { ownerId: true, organization: { select: { ownerId: true } } },
    });
    assigneeId =
      (await activeAdminId(owners?.ownerId)) ?? (await activeAdminId(owners?.organization?.ownerId));
  }
  assigneeId ??= await activeAdminId(task.assigneeUserId);
  assigneeId ??= await defaultTaskAssigneeId();
  const created = await prisma.task.create({
    data: {
      title: task.title,
      contactId,
      assigneeId,
      dueAt: task.dueDays !== null ? new Date(now.getTime() + task.dueDays * DAY_MS) : null,
    },
  });
  // Samme varsel som når en kollega tildeler oppgaven; kaster aldri.
  if (created?.id && assigneeId !== null) {
    await notifyTaskAssignee({ taskId: created.id, actorUserId: null, actorEmail: 'E-postflyt' });
  }
}

async function failEnrollment(enrollmentId: number, reason: string, now: Date, nodeId?: number): Promise<void> {
  await prisma.flowEnrollment.update({
    where: { id: enrollmentId },
    data: {
      status: 'failed',
      failReason: reason,
      finishedAt: now,
      nextRunAt: now,
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
  sendWindow: SendWindow | null,
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

    const needsEngagement =
      node.type === 'condition' && typeof node.config.kind === 'string' && ENGAGEMENT_CONDITION_KINDS.has(node.config.kind);
    const engagement = needsEngagement ? await loadLastSendEngagement(enrollment.id) : null;
    const courseDates = node.type === 'schedule' ? await loadCourseDates(enrollment.registrationId) : null;
    const ctx: StepContext = {
      contact: { ...contact },
      segmentRulesById,
      lastSendOpened: engagement ? engagement.opened : null,
      lastSendClicked: engagement ? engagement.clicked : null,
      lastSendReplied: engagement ? engagement.replied : null,
      now,
      courseDates,
      nodeType: (id) => graph.nodesById.get(id)?.type,
    };
    const plan = planStep(node, graph.edges, ctx);

    switch (plan.kind) {
      case 'send_email': {
        const result = await sendFlowEmail({
          enrollmentId: enrollment.id,
          flowId: enrollment.flowId,
          nodeId: node.id,
          contactId: enrollment.contactId,
          registrationId: enrollment.registrationId,
          subject: plan.subject,
          bodyHtml: plan.bodyHtml,
          senderIdentityId: plan.senderIdentityId,
          aiPersonalize: plan.aiPersonalize,
          aiReview: plan.aiReview,
          isMarketing: enrollment.flow.isMarketing,
          sendWindow,
          now,
        });
        if (typeof result === 'object' && result.kind === 'outside_window') {
          // Utenfor sendetiden: parker PÅ e-post-noden til vinduet åpner.
          // Ingenting er sendt eller reservert, så neste tick prøver på nytt.
          await prisma.flowEnrollment.update({
            where: { id: enrollment.id },
            data: { currentNodeId: node.id, nextRunAt: result.resumeAt },
          });
          return { sent, failed: false, completed: false };
        }
        if (typeof result === 'object') {
          // KI-utkast venter på godkjenning: parker PÅ e-post-noden til fristen.
          // Neste tick (tidsavbrudd eller admin-vekking) treffer samme utkast via
          // dedupeKey og sender/skipper uten å generere på nytt.
          // Admin kan ha besluttet i vinduet mellom oppslag og parkering —
          // da ville vekkingen bommet, så kjør igjen straks i stedet for ved fristen.
          const review = await findReview(enrollment.id, node.id);
          const decided = review !== null && review.status !== 'pending';
          await prisma.flowEnrollment.update({
            where: { id: enrollment.id },
            data: { currentNodeId: node.id, nextRunAt: decided ? now : result.resumeAt },
          });
          return { sent, failed: false, completed: false };
        }
        if (result === 'failed') {
          await failEnrollment(enrollment.id, 'send-failed', now, node.id);
          return { sent, failed: true, completed: false };
        }
        // Samtykket trukket/adressen sperret underveis: markedsføringsløpet
        // stoppes synlig i stedet for å gå videre som om e-posten ble sendt.
        if (enrollment.flow.isMarketing && (result === 'skipped_no_consent' || result === 'skipped_suppressed')) {
          await prisma.flowEnrollment.update({
            where: { id: enrollment.id },
            data: {
              status: 'exited',
              failReason: result === 'skipped_no_consent' ? STOP_REASON_NO_CONSENT : STOP_REASON_SUPPRESSED,
              finishedAt: now,
              currentNodeId: node.id,
              nextRunAt: now,
            },
          });
          return { sent, failed: false, completed: false };
        }
        // 'sent' | 'already_sent' | 'skipped_review' (og skippede tjenestemeldinger) går videre.
        if (result === 'sent') sent++;
        currentNodeId = plan.nextNodeId;
        continue;
      }
      case 'sleep': {
        // Allerede passert (f.eks. vent 0 eller et kurstidspunkt som har vært):
        // fortsett i samme kjøring i stedet for én cron-tick per steg. MAX_HOPS
        // hindrer at en feilkoblet løkke spinner.
        if (plan.until.getTime() <= now.getTime()) {
          currentNodeId = plan.nextNodeId;
          continue;
        }
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
        await applyAction(plan.action, contact, now);
        if (plan.nextNodeId === null) {
          if (plan.action.kind === 'exit' && plan.action.value) {
            logger.info('Flyt-enrollment avsluttet', { enrollmentId: enrollment.id, reason: plan.action.value });
          }
          await prisma.flowEnrollment.update({
            where: { id: enrollment.id },
            data: { status: 'exited', finishedAt: now, currentNodeId: node.id, nextRunAt: now },
          });
          return { sent, failed: false, completed: false };
        }
        currentNodeId = plan.nextNodeId;
        continue;
      }
      case 'complete': {
        await prisma.flowEnrollment.update({
          where: { id: enrollment.id },
          data: { status: 'completed', finishedAt: now, currentNodeId: node.id, nextRunAt: now },
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
async function claimDueEnrollmentIds(now: Date, onlyId?: number): Promise<number[]> {
  return prisma.$transaction(async (tx) => {
    const rows = onlyId === undefined
      ? await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM flow_enrollments
        WHERE status = 'active' AND next_run_at <= ${now}
        ORDER BY next_run_at ASC
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      `
      : await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM flow_enrollments
        WHERE id = ${onlyId} AND status = 'active' AND next_run_at <= ${now}
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

async function processClaimed(claimedIds: number[], now: Date): Promise<FlowBatchResult> {
  const result: FlowBatchResult = { processed: 0, sent: 0, failed: 0, completed: 0 };
  if (claimedIds.length === 0) return result;

  const dueEnrollments = await prisma.flowEnrollment.findMany({
    where: { id: { in: claimedIds } },
    orderBy: { id: 'asc' },
    include: { flow: { select: { status: true, isMarketing: true } } },
  });

  const graphCache = new Map<number, FlowGraph>();
  const segmentRulesById = await loadSegmentRulesById();
  const sendWindows = await loadSendWindowConfig();

  for (const enrollment of dueEnrollments) {
    if (enrollment.flow.status !== 'active') continue;

    result.processed++;
    try {
      const graph = await getGraph(enrollment.flowId, graphCache);
      const sendWindow = effectiveWindowFor(sendWindows, enrollment.flowId);
      const outcome = await processEnrollment(enrollment, graph, segmentRulesById, sendWindow, now);
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
        .update({ where: { id: enrollment.id }, data: { status: 'failed', failReason: 'runner-error', finishedAt: now, nextRunAt: now } })
        .catch(() => {});
      result.failed++;
    }
  }

  return result;
}

/**
 * Claims up to `BATCH_SIZE` due, active enrollments (see
 * `claimDueEnrollmentIds`) and ticks each one forward. Enrollments whose
 * flow is no longer 'active' (paused/archived) are left untouched beyond
 * the claim/lease — they'll be reconsidered once the lease expires (or
 * sooner, once the flow is reactivated and re-ticked).
 */
export async function runFlowBatch(now: Date = new Date()): Promise<FlowBatchResult> {
  return processClaimed(await claimDueEnrollmentIds(now), now);
}

export interface FlowDrainResult extends FlowBatchResult {
  batches: number;
}

/**
 * Kjører batcher etter hverandre til køen er tom eller tidsbudsjettet er
 * brukt, så en nattlig kø tømmes raskt når sendetiden åpner. Hver batch
 * claimer med fersk `now` (samme claim/lease som én batch); en ny startes
 * bare når den tregeste batchen hittil fortsatt får plass i budsjettet.
 */
export async function drainFlowBatches(
  budgetMs: number = DRAIN_BUDGET_MS,
  clock: () => Date = () => new Date(),
): Promise<FlowDrainResult> {
  const total: FlowDrainResult = { processed: 0, sent: 0, failed: 0, completed: 0, batches: 0 };
  const startedAt = clock().getTime();
  let slowestMs = 0;

  for (;;) {
    const now = clock();
    const claimed = await claimDueEnrollmentIds(now);
    if (claimed.length === 0) break;
    const result = await processClaimed(claimed, now);
    total.processed += result.processed;
    total.sent += result.sent;
    total.failed += result.failed;
    total.completed += result.completed;
    total.batches++;

    const finishedAt = clock().getTime();
    slowestMs = Math.max(slowestMs, finishedAt - now.getTime());
    if (claimed.length < BATCH_SIZE) break;
    if (finishedAt - startedAt + slowestMs > budgetMs) break;
  }
  return total;
}

/**
 * Vekker og kjører ett parkert enrollment nå (rett etter en beslutning i
 * KI-godkjenningskøen), med samme claim/lease-garanti som cron-batchen.
 * Vekkingen treffer kun hvis enrollmentet fortsatt står parkert på noden med
 * nøyaktig `parkedUntil` — er det claimet av en pågående batch (lease) eller
 * flyttet videre, gjør kallet ingenting og runneren tar det ved fristen.
 */
export async function runEnrollmentNow(
  enrollmentId: number,
  expectedNodeId: number,
  parkedUntil: Date,
  now: Date = new Date(),
): Promise<FlowBatchResult> {
  const { count } = await prisma.flowEnrollment.updateMany({
    where: { id: enrollmentId, status: 'active', currentNodeId: expectedNodeId, nextRunAt: parkedUntil },
    data: { nextRunAt: now },
  });
  if (count === 0) return { processed: 0, sent: 0, failed: 0, completed: 0 };
  return processClaimed(await claimDueEnrollmentIds(now, enrollmentId), now);
}

/**
 * Etter endret sendetid: vekker løp som står parkert på en e-post-node og
 * venter på at den FORRIGE sendetiden åpner, så de vurderes mot den nye
 * (utenfor vinduet parkeres de bare på nytt). Vente-/kurssteg og KI-godkjenning
 * røres ikke. Rader med `nextRunAt` innenfor leasehorisonten kan være claimet
 * av en pågående batch og hoppes over — de kjører uansett innen LEASE_MINUTES.
 */
export async function wakeSendWindowParked(
  flowId: number,
  previousWindow: SendWindow | null,
  now: Date = new Date(),
): Promise<number> {
  if (!previousWindow) return 0;
  const emailNodes = await prisma.flowNode.findMany({ where: { flowId, type: 'email' }, select: { id: true } });
  if (emailNodes.length === 0) return 0;

  const emailNodeIds = emailNodes.map((node) => node.id);
  const leaseHorizon = new Date(now.getTime() + LEASE_MINUTES * 60_000);
  const parkedWhere = {
    flowId,
    status: 'active',
    currentNodeId: { in: emailNodeIds },
    nextRunAt: { gt: leaseHorizon },
  };
  const candidates = await prisma.flowEnrollment.findMany({
    where: parkedWhere,
    select: { id: true, nextRunAt: true },
  });
  const ids = candidates
    .filter((e) => isExactSendWindowParking(e.id, e.nextRunAt, previousWindow))
    .map((e) => e.id);
  if (ids.length === 0) return 0;

  const { count } = await prisma.flowEnrollment.updateMany({
    where: { ...parkedWhere, id: { in: ids } },
    data: { nextRunAt: now },
  });
  return count;
}
