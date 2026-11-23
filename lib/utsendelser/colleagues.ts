/**
 * Når én i en bedrift svarer, får ikke kollegene resten av utsendelsen: bedriften har svart.
 * Kollegene tas ut av utsendelsen (kan angres under «Ta med igjen»).
 */
import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';
import { exitActiveEnrollments } from '@/lib/flows/exit';
import { getUtsendelser, type Utsendelse } from './config';
import { loadAudience } from './audience';

export const colleagueReplyLabel = (contactId: number) => `Kollega svarte (kontakt ${contactId})`;

/**
 * Tar ut kollegene (samme bedrift) til den som svarte, fra utsendelsen. Uten sendelås: et svar stopper også
 * avsenderens eget løp uten lås, og kollegene skal stoppes like raskt.
 */
export async function stopColleagues(utsendelse: Utsendelse, contactId: number): Promise<{ excluded: number[] }> {
  const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { organizationId: true } });
  if (contact?.organizationId == null) return { excluded: [] };

  const flowIds = [...new Set(utsendelse.flyter.map((f) => f.flowId))];
  const [colleagues, enrolled, alreadyOut, audience] = await Promise.all([
    prisma.contact.findMany({ where: { organizationId: contact.organizationId, id: { not: contactId } }, select: { id: true } }),
    prisma.flowEnrollment.findMany({
      where: { flowId: { in: flowIds }, contact: { organizationId: contact.organizationId } },
      select: { contactId: true },
    }),
    prisma.utsendelseRecipient.findMany({ where: { utsendelseId: utsendelse.id, excluded: true }, select: { contactId: true } }),
    loadAudience(utsendelse),
  ]);

  const inUtsendelse = new Set([...enrolled.map((e) => e.contactId), ...[...audience.values()].flatMap((g) => g.ids ?? [])]);
  const out = new Set(alreadyOut.map((r) => r.contactId));
  const targets = colleagues.map((c) => c.id).filter((id) => inUtsendelse.has(id) && !out.has(id));
  if (targets.length === 0) return { excluded: [] };

  const by = colleagueReplyLabel(contactId);
  for (const id of targets) {
    await prisma.utsendelseRecipient.upsert({
      where: { utsendelseId_contactId: { utsendelseId: utsendelse.id, contactId: id } },
      create: { utsendelseId: utsendelse.id, contactId: id, excluded: true, updatedBy: by },
      update: { excluded: true, updatedBy: by },
    });
  }
  await exitActiveEnrollments({ flowId: { in: flowIds }, contactId: { in: targets } });
  return { excluded: targets };
}

/** Etter et svar i en flyt: stopp kollegene hvis flyten hører til en utsendelse. Feil stopper aldri svaret. */
export async function stopColleaguesAfterReply(flowId: number, contactId: number): Promise<void> {
  try {
    const utsendelse = (await getUtsendelser()).find((u) => u.flyter.some((f) => f.flowId === flowId));
    if (!utsendelse) return;
    const { excluded } = await stopColleagues(utsendelse, contactId);
    if (excluded.length > 0) logger.info('Kolleger tatt ut etter svar', { utsendelse: utsendelse.id, contactId, excluded });
  } catch (error) {
    logger.error('Kunne ikke stoppe kollegene etter svar', { flowId, contactId, error: error instanceof Error ? error.message : String(error) });
  }
}
