/** Svar fra kontakter til visning: «Svar»-siden, utsendelsen og kontakten i CRM. */
import { prisma } from '@/lib/prisma';
import { getUtsendelser } from '@/lib/utsendelser/config';
import { tidyReplyText } from './text';
import { CATEGORY_LABELS, REPLY_CATEGORIES, type ReplyCategory } from './classify';

export type ReplyStatus = 'open' | 'answered' | 'no_reply';

export interface ReplyItem {
  id: number;
  contactId: number;
  contactName: string;
  organization: string | null;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  bodyText: string;
  receivedAt: string;
  status: ReplyStatus;
  handledAt: string | null;
  handledBy: string | null;
  /** Emnet på e-posten de svarte på. */
  inReplyToSubject: string | null;
  utsendelse: { id: string; navn: string } | null;
  /** Vårt svar, når det ble sendt herfra. */
  answer: { text: string; sentAt: string; from: string } | null;
  /** Hvem svaret herfra sendes fra (avsenderen av e-posten de svarte på), hvis kjent. */
  replyFrom: { name: string; email: string } | null;
  /** Claude sin sortering, når svaret er sjekket. */
  ai: { category: ReplyCategory; label: string; reason: string | null } | null;
  /** Spart til neste års julebord. */
  saved: { navn: string; by: string | null; at: string } | null;
  /** Annen kontaktperson Claude fant i svaret; contactId når den er lagt inn i CRM. */
  newContact: { name: string; email: string | null; contactId: number | null } | null;
}

/** Teksten vi skrev, uten det siterte svaret under (se replyBodyHtml). */
export function answerTextFromHtml(html: string): string {
  const own = html.split('<p style="margin-top:24px')[0];
  const body = own.includes('<body') ? own.slice(own.indexOf('>', own.indexOf('<body')) + 1) : own;
  return body
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .trim();
}

export interface ReplyFilter {
  status: 'open' | 'handled' | 'all';
  contactId?: number;
  flowIds?: number[];
  take?: number;
}

export async function listReplies(filter: ReplyFilter): Promise<ReplyItem[]> {
  const rows = await prisma.inboundReply.findMany({
    where: {
      ...(filter.status === 'open' && { status: 'open' }),
      ...(filter.status === 'handled' && { status: { in: ['answered', 'no_reply'] } }),
      ...(filter.contactId !== undefined && { contactId: filter.contactId }),
      ...(filter.flowIds !== undefined && { flowId: { in: filter.flowIds } }),
    },
    orderBy: filter.status === 'handled' ? { handledAt: 'desc' } : { receivedAt: filter.status === 'open' ? 'asc' : 'desc' },
    take: filter.take ?? 200,
    include: { contact: { select: { name: true, organization: { select: { name: true } } } } },
  });
  const sendIds = [...new Set(rows.flatMap((r) => [r.repliedToSendId, r.answerSendId]).filter((id): id is number => id != null))];
  const [sends, utsendelser] = await Promise.all([
    sendIds.length
      ? prisma.messageSend.findMany({
          where: { id: { in: sendIds } },
          select: { id: true, subject: true, bodyHtml: true, sentAt: true, senderIdentity: { select: { displayName: true, email: true, active: true } } },
        })
      : [],
    getUtsendelser(),
  ]);
  const listIds = [...new Set(rows.map((r) => r.savedListId).filter((id): id is number => id != null))];
  const lists = listIds.length ? await prisma.contactList.findMany({ where: { id: { in: listIds } }, select: { id: true, name: true } }) : [];
  const listName = new Map(lists.map((l) => [l.id, l.name]));
  const sendById = new Map(sends.map((s) => [s.id, s]));
  const utsendelseByFlow = new Map<number, { id: string; navn: string }>();
  for (const u of utsendelser) for (const f of u.flyter) utsendelseByFlow.set(f.flowId, { id: u.id, navn: u.navn });

  return rows.map((r) => {
    const original = r.repliedToSendId != null ? sendById.get(r.repliedToSendId) : undefined;
    const answer = r.answerSendId != null ? sendById.get(r.answerSendId) : undefined;
    return {
      id: r.id,
      contactId: r.contactId,
      contactName: r.contact.name,
      organization: r.contact.organization?.name ?? null,
      fromEmail: r.fromEmail,
      fromName: r.fromName,
      subject: r.subject,
      bodyText: tidyReplyText(r.bodyText),
      receivedAt: r.receivedAt.toISOString(),
      status: r.status as ReplyStatus,
      handledAt: r.handledAt?.toISOString() ?? null,
      handledBy: r.handledBy,
      inReplyToSubject: original?.subject ?? null,
      utsendelse: r.flowId != null ? utsendelseByFlow.get(r.flowId) ?? null : null,
      answer: answer
        ? { text: answerTextFromHtml(answer.bodyHtml), sentAt: answer.sentAt.toISOString(), from: answer.senderIdentity?.displayName ?? '' }
        : null,
      replyFrom: original?.senderIdentity?.active ? { name: original.senderIdentity.displayName, email: original.senderIdentity.email } : null,
      ai: isCategory(r.aiCategory) ? { category: r.aiCategory, label: CATEGORY_LABELS[r.aiCategory], reason: r.aiReason } : null,
      saved: r.savedListId != null && r.savedAt
        ? { navn: listName.get(r.savedListId) ?? 'neste år', by: r.savedBy, at: r.savedAt.toISOString() }
        : null,
      newContact: r.aiContactName ? { name: r.aiContactName, email: r.aiContactEmail, contactId: r.aiContactId } : null,
    };
  });
}

const isCategory = (v: string | null): v is ReplyCategory => (REPLY_CATEGORIES as readonly string[]).includes(v ?? '');

export function countOpenReplies(): Promise<number> {
  return prisma.inboundReply.count({ where: { status: 'open' } });
}
