/**
 * Medlemskap i CRM-lister. All innmelding/utmelding skal gå hit, slik at
 * `list.member_added`/`list.member_removed` sendes på hendelsesbussen (og
 * starter flyter) og kontaktens tidslinje oppdateres.
 */

import { prisma } from '@/lib/prisma';
import { BULK_EVENT_CHUNK, emitEvents } from '@/lib/events/bus';

export type ListChangeSource = 'manual' | 'import';

export interface ListChangeOptions {
  source: ListChangeSource;
  actorEmail?: string | null;
}

export interface AddToListResult {
  added: number;
  alreadyMember: number;
  missing: number;
  addedContactIds: number[];
}

export interface RemoveFromListResult {
  removed: number;
  notMember: number;
}

// Nøkkelen bærer medlemskapets addedAt: dobbel forespørsel gir samme nøkkel
// (dedup i bussen), mens ny innmelding etter fjerning gir ny nøkkel.
export function membershipDedupeKey(
  type: 'list.member_added' | 'list.member_removed',
  listId: number,
  contactId: number,
  addedAt: Date,
): string {
  return `${type}:${listId}:${contactId}:${addedAt.getTime()}`;
}

/**
 * Sender hendelsene og skriver tidslinjen i bulk. Bare hendelser som faktisk
 * ble lagret nå (ikke dedup-treff) får et tidslinjeinnslag. Listeendringer er
 * admin-handlinger, ikke kontaktens egen aktivitet, så «Sist aktiv» står urørt.
 */
async function recordChanges(
  type: 'list.member_added' | 'list.member_removed',
  list: { id: number; name: string },
  memberships: { contactId: number; addedAt: Date }[],
  opts: ListChangeOptions,
): Promise<void> {
  if (memberships.length === 0) return;
  const inserted = await emitEvents(
    memberships.map((membership) => ({
      type,
      source: 'server' as const,
      contactId: membership.contactId,
      meta: { listId: list.id, listName: list.name, source: opts.source },
      dedupeKey: membershipDedupeKey(type, list.id, membership.contactId, membership.addedAt),
      touchActivity: false,
    })),
  );
  if (inserted.length === 0) return;

  const title = type === 'list.member_added' ? `Lagt til i listen ${list.name}` : `Fjernet fra listen ${list.name}`;
  const meta = JSON.stringify({ listId: list.id, source: opts.source });
  for (let start = 0; start < inserted.length; start += BULK_EVENT_CHUNK) {
    await prisma.contactActivity
      .createMany({
        data: inserted.slice(start, start + BULK_EVENT_CHUNK).map((event) => ({
          contactId: event.contactId,
          type: 'list',
          title,
          meta,
          actorEmail: opts.actorEmail ?? null,
        })),
      })
      .catch(() => {});
  }
}

/** Returnerer null når listen ikke finnes. Ukjente kontakt-ider telles som `missing`. */
export async function addContactsToList(
  listId: number,
  contactIds: number[],
  opts: ListChangeOptions,
): Promise<AddToListResult | null> {
  const list = await prisma.contactList.findUnique({ where: { id: listId }, select: { id: true, name: true } });
  if (!list) return null;

  const uniqueIds = [...new Set(contactIds)];
  const result: AddToListResult = { added: 0, alreadyMember: 0, missing: 0, addedContactIds: [] };
  if (uniqueIds.length === 0) return result;

  const [contacts, existing] = await Promise.all([
    prisma.contact.findMany({ where: { id: { in: uniqueIds } }, select: { id: true } }),
    prisma.contactListMembership.findMany({
      where: { listId, contactId: { in: uniqueIds } },
      select: { contactId: true },
    }),
  ]);
  const found = new Set(contacts.map((c) => c.id));
  const members = new Set(existing.map((m) => m.contactId));
  result.missing = uniqueIds.length - found.size;

  const candidates = uniqueIds.filter((id) => found.has(id) && !members.has(id));
  result.alreadyMember = found.size - candidates.length;
  if (candidates.length === 0) return result;

  await prisma.contactListMembership.createMany({
    data: candidates.map((contactId) => ({ listId, contactId })),
    skipDuplicates: true,
  });

  // addedAt hentes fra radene; en samtidig forespørsel som rakk å sette inn
  // samme rad får samme dedupeKey, så hendelsen sendes bare én gang.
  const created = await prisma.contactListMembership.findMany({
    where: { listId, contactId: { in: candidates } },
    select: { contactId: true, addedAt: true },
  });

  await recordChanges('list.member_added', list, created, opts);
  result.addedContactIds = created.map((m) => m.contactId);
  result.added = result.addedContactIds.length;
  result.alreadyMember += candidates.length - result.added;
  return result;
}

/** Returnerer null når listen ikke finnes. */
export async function removeContactsFromList(
  listId: number,
  contactIds: number[],
  opts: ListChangeOptions,
): Promise<RemoveFromListResult | null> {
  const list = await prisma.contactList.findUnique({ where: { id: listId }, select: { id: true, name: true } });
  if (!list) return null;

  const uniqueIds = [...new Set(contactIds)];
  if (uniqueIds.length === 0) return { removed: 0, notMember: 0 };

  const existing = await prisma.contactListMembership.findMany({
    where: { listId, contactId: { in: uniqueIds } },
    select: { id: true, contactId: true, addedAt: true },
  });
  if (existing.length > 0) {
    await prisma.contactListMembership.deleteMany({ where: { id: { in: existing.map((m) => m.id) } } });
  }

  await recordChanges('list.member_removed', list, existing, opts);
  return { removed: existing.length, notMember: uniqueIds.length - existing.length };
}
