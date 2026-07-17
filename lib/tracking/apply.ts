// Apply-lag for e-posttracking: registrerer åpninger, klikk, svar og
// bounces mot MessageSend/MessageLink og sender hendelser til bussen.
// Tynt IO-lag — DB-feil kastes videre til kallende rute/poller.

import { prisma } from '@/lib/prisma';
import { emitEvent } from '@/lib/events/bus';
import { normalizeEmail } from '@/lib/crm/normalize';

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
    meta: {},
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

  await prisma.messageSend.update({
    where: { id: send.id },
    data: {
      clickCount: { increment: 1 },
      firstClickedAt: send.firstClickedAt ?? new Date(),
    },
  });

  await emitEvent({
    type: 'email.clicked',
    source: 'server',
    contactId: send.contactId,
    meta: { url: link.url },
    dedupeKey: `click:${send.id}:${idx}`,
  });

  return link.url;
}

export async function recordReply(matchedMessageId: string): Promise<void> {
  const send = await prisma.messageSend.findFirst({
    where: { messageId: matchedMessageId },
    orderBy: { sentAt: 'desc' },
  });
  if (!send) return;

  await prisma.messageSend.updateMany({
    where: { id: send.id, repliedAt: null },
    data: { repliedAt: new Date() },
  });

  await emitEvent({
    type: 'email.replied',
    source: 'server',
    contactId: send.contactId,
    meta: {},
    dedupeKey: `reply:${send.id}`,
  });

  if (send.enrollmentId != null) {
    const enrollment = await prisma.flowEnrollment.findUnique({ where: { id: send.enrollmentId } });
    if (enrollment && enrollment.status === 'active') {
      await prisma.flowEnrollment.update({
        where: { id: send.enrollmentId },
        data: { status: 'exited', finishedAt: new Date() },
      });
    }
  }
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
