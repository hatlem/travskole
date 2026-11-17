// Apply-lag for e-posttracking: registrerer åpninger, klikk, svar og
// bounces mot MessageSend/MessageLink og sender hendelser til bussen.
// Tynt IO-lag — DB-feil kastes videre til kallende rute/poller.

import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';
import { emitEvent } from '@/lib/events/bus';
import { normalizeEmail } from '@/lib/crm/normalize';
import { createReplyTask } from '@/lib/crm/reply-task';
import { storeInboundReply } from '@/lib/replies/store';
import { parseNodeConfig, type FlowNodeType, type GraphEdge, type GraphNode } from '@/lib/flows/graph';
import { flowBranchesOnReply, latestTrackedSendQuery, replyConditionPending } from '@/lib/flows/reply-branch';

export async function recordOpen(token: string): Promise<boolean> {
  const send = await prisma.messageSend.findUnique({ where: { trackingToken: token } });
  if (!send) return false;

  await prisma.messageSend.updateMany({
    where: { id: send.id, openedAt: null },
    data: { openedAt: new Date() },
  });

  await emitEvent({
    type: 'email.opened',
    source: 'server',
    contactId: send.contactId,
    meta: { messageSendId: send.id },
    dedupeKey: `open:${send.id}`,
  });

  return true;
}

export async function recordClick(token: string, idx: number): Promise<string | null> {
  const send = await prisma.messageSend.findUnique({ where: { trackingToken: token } });
  if (!send) return null;

  const link = await prisma.messageLink.findUnique({
    where: { messageSendId_idx: { messageSendId: send.id, idx } },
  });
  if (!link) return null;

  const now = new Date();
  await prisma.messageSend.update({
    where: { id: send.id },
    data: {
      clickCount: { increment: 1 },
      firstClickedAt: send.firstClickedAt ?? now,
    },
  });
  // Et klikk betyr at e-posten ble åpnet — også når pikselen ble blokkert.
  if (send.openedAt === null) {
    await prisma.messageSend.updateMany({ where: { id: send.id, openedAt: null }, data: { openedAt: now } });
  }

  await emitEvent({
    type: 'email.clicked',
    source: 'server',
    contactId: send.contactId,
    meta: { url: link.url },
    dedupeKey: `click:${send.id}:${idx}`,
  });

  return link.url;
}

/** Selve svaret, når det er lest fra postboksen (lagres så det kan besvares i CRM). */
export interface InboundDetails {
  subject?: string | null;
  fromEmail?: string | null;
  fromName?: string | null;
  body?: string | null;
  internetMessageId?: string | null;
  references?: string | null;
  receivedAt?: Date | null;
}

export async function recordReply(matchedMessageId: string, inbound: InboundDetails = {}): Promise<void> {
  const send = await prisma.messageSend.findFirst({
    where: { messageId: matchedMessageId },
    orderBy: { sentAt: 'desc' },
  });
  if (!send) return;

  const { count: firstReply } = await prisma.messageSend.updateMany({
    where: { id: send.id, repliedAt: null },
    data: { repliedAt: new Date() },
  });

  const enrollment =
    send.enrollmentId != null
      ? await prisma.flowEnrollment.findUnique({
        where: { id: send.enrollmentId },
        select: { id: true, flowId: true, status: true, currentNodeId: true, flow: { select: { isMarketing: true } } },
      })
      : null;
  const graph = enrollment ? await loadFlowGraph(enrollment.flowId) : null;
  const branchesOnReply = graph !== null && flowBranchesOnReply(graph.nodes);
  const isActive = enrollment?.status === 'active';

  // Kun ved første registrerte svar per utsendelse — gjentatte polls/svar i
  // samme tråd gir ikke duplikate oppgaver. Oppgaven droppes bare når flyten
  // garantert leser akkurat dette svaret i en «svarte»-betingelse; i tvil
  // lages oppgaven heller enn at svaret blir liggende.
  let taskId: number | null = null;
  if (firstReply > 0) {
    const flowWillReadReply =
      enrollment !== null && graph !== null && isActive && branchesOnReply &&
      (await isLatestTrackedSend(enrollment.id, send.id)) &&
      replyConditionPending(graph.nodes, graph.edges, send.nodeId, enrollment.currentNodeId);
    if (!flowWillReadReply) taskId = await createReplyTask(send, inbound.subject);
  }

  if (inbound.fromEmail) {
    await storeInboundReply({
      contactId: send.contactId,
      repliedToSendId: send.id,
      fromEmail: inbound.fromEmail,
      fromName: inbound.fromName ?? null,
      subject: inbound.subject ?? send.subject,
      body: inbound.body ?? '',
      internetMessageId: inbound.internetMessageId ?? null,
      references: inbound.references ?? null,
      receivedAt: inbound.receivedAt ?? new Date(),
      taskId,
    }).catch((error) => {
      // Svaret er registrert uansett; teksten kan leses i postboksen.
      logger.error('Kunne ikke lagre svaret', { messageSendId: send.id, error: error instanceof Error ? error.message : String(error) });
    });
  }

  await emitEvent({
    type: 'email.replied',
    source: 'server',
    contactId: send.contactId,
    meta: {
      messageSendId: send.id,
      ...(send.enrollmentId != null && { enrollmentId: send.enrollmentId }),
      ...(enrollment?.flowId != null && { flowId: enrollment.flowId }),
    },
    dedupeKey: `reply:${send.id}`,
  });

  // Et svar avslutter et markedsføringsløp — med mindre flyten selv forgrener
  // på «svarte». Transaksjonelle (kurs-)flyter inviterer til svar i bunnteksten
  // og fortsetter; svar-oppgaven over sørger for at noen svarer.
  if (enrollment && isActive && enrollment.flow.isMarketing && !branchesOnReply) {
    await prisma.flowEnrollment.update({
      where: { id: enrollment.id },
      data: { status: 'exited', finishedAt: new Date() },
    });
  }
}

async function loadFlowGraph(flowId: number): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const [nodeRows, edges] = await Promise.all([
    prisma.flowNode.findMany({ where: { flowId }, select: { id: true, type: true, config: true } }),
    prisma.flowEdge.findMany({ where: { flowId }, select: { id: true, fromNodeId: true, toNodeId: true, branch: true } }),
  ]);
  const nodes = nodeRows.map((row) => ({ id: row.id, type: row.type as FlowNodeType, config: parseNodeConfig(row.config) }));
  return { nodes, edges };
}

/** Er dette den sendingen runnerens «svarte»-betingelse vil lese? */
async function isLatestTrackedSend(enrollmentId: number, sendId: number): Promise<boolean> {
  const latest = await prisma.messageSend.findFirst({ ...latestTrackedSendQuery(enrollmentId), select: { id: true } });
  return latest?.id === sendId;
}

export async function recordBounce(
  matchedMessageId: string | null,
  failedRecipient: string | null,
  hard: boolean
): Promise<void> {
  let send: Awaited<ReturnType<typeof prisma.messageSend.findFirst>> = null;

  if (matchedMessageId != null) {
    send = await prisma.messageSend.findFirst({
      where: { messageId: matchedMessageId },
      orderBy: { sentAt: 'desc' },
    });
  } else if (failedRecipient != null) {
    const normalizedRecipient = normalizeEmail(failedRecipient);
    if (normalizedRecipient != null) {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      send = await prisma.messageSend.findFirst({
        where: {
          toEmail: { equals: normalizedRecipient, mode: 'insensitive' },
          sentAt: { gte: sevenDaysAgo },
        },
        orderBy: { sentAt: 'desc' },
      });
    }
  }

  if (!send) return;

  await prisma.messageSend.updateMany({
    where: { id: send.id, bouncedAt: null },
    data: { bouncedAt: new Date() },
  });

  await emitEvent({
    type: 'email.bounced',
    source: 'server',
    contactId: send.contactId,
    meta: { hard },
    dedupeKey: `bounce:${send.id}`,
  });

  if (hard) {
    const normalizedEmail = normalizeEmail(send.toEmail) ?? normalizeEmail(failedRecipient);
    if (normalizedEmail != null) {
      await prisma.suppression.upsert({
        where: { email: normalizedEmail },
        create: { email: normalizedEmail, reason: 'bounce' },
        update: { reason: 'bounce' },
      });
    }
  }
}

/**
 * Autosvar om at personen har sluttet: adressen settes på ikke-kontakt-lista («har sluttet»), så e-postene
 * stopper, og svaret lagres som behandlet, så det synes i CRM (og en ny kontaktperson i teksten kan legges inn).
 */
export async function recordLeftCompany(matchedMessageId: string, inbound: InboundDetails): Promise<boolean> {
  const send = await prisma.messageSend.findFirst({ where: { messageId: matchedMessageId }, orderBy: { sentAt: 'desc' } });
  if (!send) return false;
  const email = normalizeEmail(send.toEmail);
  if (email) {
    // En eksisterende sperre (f.eks. avmelding) beholder sin grunn.
    await prisma.suppression.upsert({ where: { email }, create: { email, reason: 'left' }, update: {} });
  }
  if (inbound.fromEmail) {
    try {
      const id = await storeInboundReply({
        contactId: send.contactId,
        repliedToSendId: send.id,
        fromEmail: inbound.fromEmail,
        fromName: inbound.fromName ?? null,
        subject: inbound.subject ?? send.subject,
        body: inbound.body ?? '',
        internetMessageId: inbound.internetMessageId ?? null,
        references: inbound.references ?? null,
        receivedAt: inbound.receivedAt ?? new Date(),
      });
      await prisma.inboundReply.updateMany({
        where: { id, status: 'open' },
        data: { status: 'no_reply', handledAt: new Date(), handledBy: 'Systemet (har sluttet)' },
      });
    } catch (error) {
      logger.error('Kunne ikke lagre autosvar om at personen har sluttet', { messageSendId: send.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return true;
}

