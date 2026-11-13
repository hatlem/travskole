/**
 * Valg per mottaker i en utsendelse: ta ut, ta med igjen, flytt til en annen gruppe eller legg til.
 * Valgene lagres i utsendelse_recipients og brukes av loadAudience, så telling og sending følger dem.
 */
import { prisma } from '@/lib/prisma';
import { exitActiveEnrollments } from '@/lib/flows/exit';
import { acquireSendLock, releaseSendLock, UtsendelseError } from './actions';
import { getUtsendelser, type Utsendelse } from './config';
import { loadAudience } from './audience';

const flowIdsOf = (u: Utsendelse) => [...new Set(u.flyter.map((f) => f.flowId))];

/** Holder sendelåsen for flytene, så et valg aldri krysser en utsending som pågår. */
async function withFlowLocks<T>(flowIds: number[], fn: () => Promise<T>): Promise<T> {
  const held: number[] = [];
  try {
    for (const flowId of flowIds) {
      if (!(await acquireSendLock(flowId))) {
        throw new UtsendelseError('En utsending pågår akkurat nå. Prøv igjen om litt.');
      }
      held.push(flowId);
    }
    return await fn();
  } finally {
    await Promise.all(held.map((id) => releaseSendLock(id).catch(() => {})));
  }
}

async function requireContact(contactId: number) {
  const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { id: true, source: true } });
  if (!contact || contact.source === 'system') throw new UtsendelseError('Fant ikke kontakten.', 404);
}

/** Personen får ingen (flere) e-poster fra utsendelsen. E-poster som er sendt, kan ikke hentes tilbake. */
export async function excludeRecipient(utsendelse: Utsendelse, contactId: number, by: string): Promise<{ stopped: number }> {
  await requireContact(contactId);
  const flowIds = flowIdsOf(utsendelse);
  return withFlowLocks(flowIds, async () => {
    await prisma.utsendelseRecipient.upsert({
      where: { utsendelseId_contactId: { utsendelseId: utsendelse.id, contactId } },
      create: { utsendelseId: utsendelse.id, contactId, excluded: true, updatedBy: by },
      update: { excluded: true, updatedBy: by },
    });
    const stopped = await exitActiveEnrollments({ flowId: { in: flowIds }, contactId });
    return { stopped };
  });
}

/** Angrer «ta ut»; en flytting beholdes. Den som allerede er stoppet midt i rekken, starter ikke opp igjen. */
export async function includeRecipient(utsendelse: Utsendelse, contactId: number, by: string): Promise<void> {
  const key = { utsendelseId: utsendelse.id, contactId };
  await prisma.$transaction([
    prisma.utsendelseRecipient.deleteMany({ where: { ...key, groupId: null } }),
    prisma.utsendelseRecipient.updateMany({ where: { ...key, groupId: { not: null } }, data: { excluded: false, updatedBy: by } }),
  ]);
}

/**
 * Flytter (eller legger til) en person i en gruppe. Bare før personen har fått noe fra utsendelsen.
 * Egne tekster for e-poster personen ikke lenger skal få, slettes.
 */
export async function moveRecipient(utsendelse: Utsendelse, contactId: number, groupId: string, by: string): Promise<void> {
  const group = utsendelse.grupper.find((g) => g.id === groupId);
  if (!group) throw new UtsendelseError('Fant ikke gruppen.', 404);
  await requireContact(contactId);
  const flowIds = flowIdsOf(utsendelse);
  await withFlowLocks(flowIds, async () => {
    const enrolled = await prisma.flowEnrollment.count({ where: { flowId: { in: flowIds }, contactId } });
    if (enrolled > 0) throw new UtsendelseError('Personen har allerede fått e-post fra utsendelsen og kan ikke flyttes.');
    await prisma.$transaction([
      prisma.utsendelseRecipient.upsert({
        where: { utsendelseId_contactId: { utsendelseId: utsendelse.id, contactId } },
        create: { utsendelseId: utsendelse.id, contactId, groupId, updatedBy: by },
        update: { groupId, excluded: false, updatedBy: by },
      }),
      prisma.flowMessageOverride.deleteMany({
        where: { contactId, node: { flowId: { in: flowIds.filter((id) => id !== group.flowId) } } },
      }),
    ]);
  });
}

export interface ContactUtsendelse {
  id: string;
  navn: string;
  groupId: string | null;
  groupNavn: string | null;
  /** ikke = ikke sendt ennå, sendt = har fått e-post, ut = tatt ut, ingen = ikke med. */
  status: 'ikke' | 'sendt' | 'ut' | 'ingen';
  grupper: { id: string; navn: string }[];
}

/** Hvilke utsendelser kontakten er med i, og i hvilken gruppe. For kontaktsiden i CRM. */
export async function contactUtsendelser(contactId: number): Promise<ContactUtsendelse[]> {
  const utsendelser = await getUtsendelser();
  const active = await prisma.flow.findMany({
    where: { id: { in: utsendelser.flatMap((u) => u.flyter.map((f) => f.flowId)) }, status: { not: 'archived' } },
    select: { id: true },
  });
  const activeFlows = new Set(active.map((f) => f.id));
  const enrolledFlows = new Set(
    (await prisma.flowEnrollment.findMany({ where: { contactId }, select: { flowId: true } })).map((e) => e.flowId),
  );

  const result: ContactUtsendelse[] = [];
  for (const u of utsendelser.filter((x) => x.flyter.some((f) => activeFlows.has(f.flowId)))) {
    const audience = await loadAudience(u);
    const excludedFrom = u.grupper.find((g) => audience.get(g.id)?.excluded.includes(contactId));
    const group = u.grupper.find((g) => audience.get(g.id)?.ids?.includes(contactId)) ?? excludedFrom;
    const excluded = Boolean(excludedFrom);
    const sent = u.flyter.some((f) => enrolledFlows.has(f.flowId));
    result.push({
      id: u.id,
      navn: u.navn,
      groupId: group?.id ?? null,
      groupNavn: group?.navn ?? null,
      status: excluded ? 'ut' : sent ? 'sendt' : group ? 'ikke' : 'ingen',
      grupper: u.grupper.map((g) => ({ id: g.id, navn: g.navn })),
    });
  }
  return result;
}
