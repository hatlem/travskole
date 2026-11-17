/** «Riktig kontaktperson er …»: legger personen Claude fant i svaret, inn i CRM i samme bedrift. */
import { prisma } from '@/lib/prisma';
import { normalizeEmail } from '@/lib/crm/normalize';
import { logActivity } from '@/lib/activity';
import { ReplyError } from './answer';

export async function addSuggestedContact(replyId: number, input: { name: string; email: string | null }, by: string): Promise<{ contactId: number; existed: boolean }> {
  const name = input.name.trim();
  if (!name) throw new ReplyError('Skriv navnet på personen.');
  const email = normalizeEmail(input.email);

  const reply = await prisma.inboundReply.findUnique({
    where: { id: replyId },
    select: { id: true, aiContactId: true, contact: { select: { id: true, name: true, organizationId: true } } },
  });
  if (!reply) throw new ReplyError('Fant ikke svaret.', 404);
  if (reply.aiContactId != null) return { contactId: reply.aiContactId, existed: true };

  const existing = email ? await prisma.contact.findUnique({ where: { email }, select: { id: true } }) : null;
  const contact = existing ?? (await prisma.contact.create({
    data: { name, email, organizationId: reply.contact.organizationId, source: 'manual', stage: 'lead' },
    select: { id: true },
  }));
  await prisma.inboundReply.update({ where: { id: reply.id }, data: { aiContactId: contact.id, aiContactName: name, aiContactEmail: email } });
  await prisma.note.create({
    data: { contactId: contact.id, authorEmail: by, body: `Lagt til fordi ${reply.contact.name} svarte at ${name} er riktig kontaktperson.` },
  });
  if (!existing) logActivity({ action: 'create', entity: 'contact', entityId: contact.id, userEmail: by, details: JSON.stringify({ fromReplyId: replyId }) }).catch(() => {});
  return { contactId: contact.id, existed: existing != null };
}
