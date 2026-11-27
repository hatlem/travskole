/**
 * «Skulle gått til en annen adresse»: legger adressen inn i CRM (samme bedrift) og sender den
 * samme utsendelsen dit, med egen avmeldingslenke og sporing. Gjelder svar på en utsendelse.
 */
import { prisma } from '@/lib/prisma';
import { normalizeEmail } from '@/lib/crm/normalize';
import { logActivity } from '@/lib/activity';
import { getUtsendelser } from '@/lib/utsendelser/config';
import { loadAudience } from '@/lib/utsendelser/audience';
import { sendOne, UtsendelseError } from '@/lib/utsendelser/actions';
import { moveRecipient } from '@/lib/utsendelser/recipients';
import { ReplyError } from './answer';

const EMAIL_IN_TEXT = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
/** Våre egne adresser (fra sitert tekst og signaturer) skal aldri foreslås. */
const OWN_DOMAINS = ['bjerke.no'];
/** Innebygde bilder i Outlook («image001.png@01DD7686.DFCF») ser ut som adresser. */
const INLINE_IMAGE = /^image\d*\.(png|jpe?g|gif)@|@[0-9a-f]{8}\.[0-9a-f]{4,8}$/i;

/** Første adresse i svaret som ikke er avsenderens egen eller vår (f.eks. «skulle gått til postmottak@…»). */
export function suggestedForwardEmail(bodyText: string, own: string[]): string | null {
  const skip = new Set(own.map((e) => e.trim().toLowerCase()));
  for (const match of bodyText.match(EMAIL_IN_TEXT) ?? []) {
    const email = normalizeEmail(match.replace(/\.$/, ''));
    if (!email || skip.has(email) || INLINE_IMAGE.test(email)) continue;
    const domain = email.split('@')[1];
    if (OWN_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) continue;
    return email;
  }
  return null;
}

export async function forwardToAddress(
  replyId: number,
  input: { email: string; name?: string | null },
  by: string,
): Promise<{ contactId: number; created: boolean; utsendelse: string }> {
  const email = normalizeEmail(input.email);
  if (!email) throw new ReplyError('Sjekk e-postadressen.');

  const reply = await prisma.inboundReply.findUnique({
    where: { id: replyId },
    select: { id: true, flowId: true, fromEmail: true, contactId: true, contact: { select: { name: true, email: true, organizationId: true, organization: { select: { name: true } } } } },
  });
  if (!reply) throw new ReplyError('Fant ikke svaret.', 404);
  if ([reply.fromEmail, reply.contact.email].some((e) => normalizeEmail(e) === email)) {
    throw new ReplyError('Det er samme adresse som svarte. Skriv den nye adressen.');
  }
  const utsendelse = reply.flowId != null ? (await getUtsendelser()).find((u) => u.flyter.some((f) => f.flowId === reply.flowId)) : undefined;
  if (!utsendelse) throw new ReplyError('Svaret hører ikke til en utsendelse, så det er ingen e-post å sende videre.');

  // Samme gruppe som den som svarte, så den nye adressen får nøyaktig de samme e-postene.
  const audience = await loadAudience(utsendelse);
  const groups = utsendelse.grupper.filter((g) => g.flowId === reply.flowId);
  const group = groups.find((g) => audience.get(g.id)?.ids?.includes(reply.contactId) || audience.get(g.id)?.excluded.includes(reply.contactId)) ?? groups[0];
  if (!group) throw new ReplyError('Fant ikke gruppen i utsendelsen.');

  const existing = await prisma.contact.findUnique({ where: { email }, select: { id: true, source: true } });
  if (existing?.source === 'system') throw new ReplyError('Den adressen kan ikke brukes.');
  const contactId = existing?.id ?? (await prisma.contact.create({
    data: {
      name: input.name?.trim() || reply.contact.organization?.name || email,
      email,
      organizationId: reply.contact.organizationId,
      source: 'manual',
      stage: 'lead',
    },
    select: { id: true },
  })).id;

  try {
    await moveRecipient(utsendelse, contactId, group.id, by);
    await sendOne(utsendelse, group.id, contactId);
  } catch (error) {
    if (error instanceof UtsendelseError) throw new ReplyError(error.message, error.status);
    throw error;
  }

  await prisma.note.create({
    data: { contactId, authorEmail: by, body: `${utsendelse.navn} sendt hit fordi ${reply.contact.name} svarte at e-posten skulle gått til denne adressen.` },
  });
  logActivity({ action: 'reply_forwarded', entity: 'contact', entityId: contactId, userEmail: by, details: JSON.stringify({ replyId, utsendelse: utsendelse.id, created: !existing }) }).catch(() => {});
  return { contactId, created: !existing, utsendelse: utsendelse.navn };
}
