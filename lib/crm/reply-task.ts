// Oppretter en CRM-oppgave når en kontakt svarer på en flow-e-post, slik at
// svaret følges opp av avsenderen (styres av reply_*-innstillingene).

import { prisma } from '@/lib/prisma';
import { getSetting, isAdmin } from '@/lib/settings';
import logger from '@/lib/logger';

const MAX_TITLE_LENGTH = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReplyTaskSend {
  id: number;
  contactId: number;
  enrollmentId: number | null;
  senderIdentityId: number | null;
  subject: string;
}

export function replyTaskTitle(contactName: string, topic: string): string {
  const title = `Svar fra ${contactName.trim() || 'ukjent kontakt'}: ${topic.trim() || 'e-post'}`;
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title;
}

/** Ugyldig/negativ verdi faller tilbake til 1 dag (standard). */
export function replyTaskDueAt(now: Date, rawDays: string): Date {
  const days = Number(rawDays);
  const safeDays = Number.isInteger(days) && days >= 0 ? days : 1;
  return new Date(now.getTime() + safeDays * DAY_MS);
}

/** Kun aktive admin-brukere kan få oppgaver — ellers blir de usynlige. */
async function findStaffUserId(email: string | null | undefined): Promise<number | null> {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return null;
  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true, role: true, deactivatedAt: true, anonymizedAt: true },
  });
  if (!user || !isAdmin(user.role) || user.deactivatedAt || user.anonymizedAt) return null;
  return user.id;
}

/**
 * Tildeling: avsenderidentitetens bruker → standardmottaker fra innstillinger →
 * ingen. Kalleren sørger for idempotens (kun ved første registrerte svar).
 */
export async function createReplyTask(send: ReplyTaskSend, inboundSubject?: string | null): Promise<void> {
  try {
    const [enabled, defaultAssignee, dueDays] = await Promise.all([
      getSetting('reply_create_task'),
      getSetting('reply_task_default_assignee'),
      getSetting('reply_task_due_days'),
    ]);
    if (enabled !== 'true') return;

    const contact = await prisma.contact.findUnique({
      where: { id: send.contactId },
      select: { name: true, organizationId: true },
    });
    if (!contact) return;

    let flowName: string | null = null;
    if (send.enrollmentId != null) {
      const enrollment = await prisma.flowEnrollment.findUnique({
        where: { id: send.enrollmentId },
        select: { flow: { select: { name: true } } },
      });
      flowName = enrollment?.flow.name ?? null;
    }

    let senderEmail: string | null = null;
    if (send.senderIdentityId != null) {
      const identity = await prisma.senderIdentity.findUnique({
        where: { id: send.senderIdentityId },
        select: { email: true },
      });
      senderEmail = identity?.email ?? null;
    }

    const assigneeId = (await findStaffUserId(senderEmail)) ?? (await findStaffUserId(defaultAssignee));
    const topic = inboundSubject?.trim() || send.subject.trim() || flowName || '';

    await prisma.task.create({
      data: {
        title: replyTaskTitle(contact.name, topic),
        contactId: send.contactId,
        organizationId: contact.organizationId,
        assigneeId,
        dueAt: replyTaskDueAt(new Date(), dueDays),
      },
    });
  } catch (error) {
    // Oppgaven er et hjelpemiddel — svar-registreringen skal aldri velte på den.
    logger.error('Kunne ikke opprette oppgave for e-postsvar', {
      messageSendId: send.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
