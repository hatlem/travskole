/** Lagrer svar fra kontakter (lest fra fellespostboksen), så de kan leses og besvares i CRM. */
import { prisma } from '@/lib/prisma';
import { cleanReplyText } from './text';

export interface InboundReplyInput {
  contactId: number;
  repliedToSendId: number;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  /** Rå tekst fra e-posten; ryddes for sitert historikk her. */
  body: string;
  internetMessageId: string | null;
  references: string | null;
  receivedAt: Date;
  taskId?: number | null;
}

/** Flyten samtalen hører til: fra e-posten det ble svart på, eller fra svaret vi sendte herfra. */
async function flowIdFor(sendId: number): Promise<number | null> {
  const send = await prisma.messageSend.findUnique({ where: { id: sendId }, select: { enrollmentId: true } });
  if (send?.enrollmentId != null) {
    const enrollment = await prisma.flowEnrollment.findUnique({ where: { id: send.enrollmentId }, select: { flowId: true } });
    if (enrollment) return enrollment.flowId;
  }
  const answered = await prisma.inboundReply.findFirst({ where: { answerSendId: sendId }, select: { flowId: true } });
  return answered?.flowId ?? null;
}

/** Lagrer svaret én gang (samme Message-ID gir samme rad). Returnerer id-en. */
export async function storeInboundReply(input: InboundReplyInput): Promise<number> {
  if (input.internetMessageId) {
    const existing = await prisma.inboundReply.findUnique({ where: { internetMessageId: input.internetMessageId }, select: { id: true, taskId: true } });
    if (existing) {
      if (existing.taskId == null && input.taskId != null) {
        await prisma.inboundReply.update({ where: { id: existing.id }, data: { taskId: input.taskId } });
      }
      return existing.id;
    }
  }
  const row = await prisma.inboundReply.create({
    data: {
      contactId: input.contactId,
      repliedToSendId: input.repliedToSendId,
      flowId: await flowIdFor(input.repliedToSendId),
      fromEmail: input.fromEmail.trim().toLowerCase(),
      fromName: input.fromName?.trim() || null,
      subject: input.subject.trim().slice(0, 500) || '(uten emne)',
      bodyText: cleanReplyText(input.body),
      internetMessageId: input.internetMessageId,
      references: input.references,
      receivedAt: input.receivedAt,
      taskId: input.taskId ?? null,
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * Svar sendt fra fellespostboksen i Outlook (ikke herfra): svaret de svarer på, merkes som besvart.
 * `ids` er In-Reply-To og References fra den sendte meldingen.
 */
export async function markAnsweredFromMailbox(ids: string[], mailbox: string, sentAt: Date): Promise<number> {
  const clean = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (clean.length === 0) return 0;
  const variants = clean.flatMap((id) => [id, id.replace(/^<|>$/g, ''), `<${id.replace(/^<|>$/g, '')}>`]);
  const open = await prisma.inboundReply.findMany({
    where: { status: 'open', internetMessageId: { in: variants } },
    select: { id: true, taskId: true },
  });
  for (const reply of open) {
    await closeReply(reply, 'answered', `${mailbox} (Outlook)`, sentAt);
  }
  return open.length;
}

/** Setter status og lukker (eller åpner igjen) oppgaven som hører til. */
export async function closeReply(
  reply: { id: number; taskId: number | null },
  status: 'answered' | 'no_reply' | 'open',
  by: string,
  at: Date = new Date(),
  answerSendId?: number,
): Promise<void> {
  await prisma.inboundReply.update({
    where: { id: reply.id },
    data: status === 'open'
      ? { status, handledAt: null, handledBy: null }
      : { status, handledAt: at, handledBy: by, ...(answerSendId !== undefined && { answerSendId }) },
  });
  if (reply.taskId != null) {
    await prisma.task.updateMany({
      where: { id: reply.taskId, status: status === 'open' ? 'done' : 'open' },
      data: { status: status === 'open' ? 'open' : 'done' },
    });
  }
}

/**
 * Lagrer et svar som kom før svarene ble lagret, uten å gjøre noe annet (stopp, oppgave og hendelse
 * ble gjort da det kom). Kobles til den åpne svar-oppgaven, så den lukkes når svaret behandles.
 * Returnerer true når en ny rad ble lagret.
 */
export async function backfillReply(
  matchedMessageId: string,
  details: { subject: string; fromEmail: string | null; fromName: string | null; body: string; internetMessageId: string | null; references: string | null; receivedAt: Date },
): Promise<boolean> {
  if (!details.fromEmail) return false;
  if (details.internetMessageId && (await prisma.inboundReply.findUnique({ where: { internetMessageId: details.internetMessageId }, select: { id: true } }))) {
    return false;
  }
  const send = await prisma.messageSend.findFirst({ where: { messageId: matchedMessageId }, orderBy: { sentAt: 'desc' }, select: { id: true, contactId: true, subject: true } });
  if (!send) return false;
  const task = await prisma.task.findFirst({
    where: { contactId: send.contactId, status: 'open', title: { startsWith: 'Svar fra' }, createdAt: { gte: new Date(details.receivedAt.getTime() - 60 * 60_000) } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  await storeInboundReply({
    contactId: send.contactId,
    repliedToSendId: send.id,
    fromEmail: details.fromEmail,
    fromName: details.fromName,
    subject: details.subject || send.subject,
    body: details.body,
    internetMessageId: details.internetMessageId,
    references: details.references,
    receivedAt: details.receivedAt,
    taskId: task?.id ?? null,
  });
  return true;
}
