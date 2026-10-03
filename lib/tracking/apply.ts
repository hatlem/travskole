// Apply-lag for e-posttracking: registrerer åpninger, klikk, svar og
// bounces mot MessageSend/MessageLink og sender hendelser til bussen.
// Tynt IO-lag — DB-feil kastes videre til kallende rute/poller.

import { prisma } from '@/lib/prisma';
import { emitEvent } from '@/lib/events/bus';
import { normalizeEmail } from '@/lib/crm/normalize';
import { createReplyTask } from '@/lib/crm/reply-task';

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

export async function recordReply(
  matchedMessageId: string,
  inbound: { subject?: string | null } = {},
): Promise<void> {
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
      ? await prisma.flowEnrollment.findUnique({ where: { id: send.enrollmentId } })
      : null;
  const branchesOnReply = enrollment ? await flowBranchesOnReply(enrollment.flowId) : false;

  // Kun ved første registrerte svar per utsendelse — gjentatte polls/svar i
  // samme tråd gir ikke duplikate oppgaver. Forgrener flyten på «svarte»,
  // følger flyten selv opp svaret (ellers blir det to oppgaver).
  if (firstReply > 0 && !branchesOnReply) {
    await createReplyTask(send, inbound.subject);
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

  if (send.enrollmentId != null) {
    // Et svar avslutter flyten — med mindre flyten selv forgrener på «svarte»,
    // da må den fortsette for å nå ja-grenen.
    if (enrollment && enrollment.status === 'active' && !branchesOnReply) {
      await prisma.flowEnrollment.update({
        where: { id: send.enrollmentId },
        data: { status: 'exited', finishedAt: new Date() },
      });
    }
  }
}

async function flowBranchesOnReply(flowId: number): Promise<boolean> {
  const conditions = await prisma.flowNode.findMany({
    where: { flowId, type: 'condition' },
    select: { config: true },
  });
  return conditions.some((node) => {
    try {
      return (JSON.parse(node.config) as { kind?: unknown }).kind === 'replied_email';
    } catch {
      return false;
    }
  });
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
