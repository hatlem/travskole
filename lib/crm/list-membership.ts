/**
 * Medlemskap i CRM-lister. All innmelding/utmelding skal gå hit, slik at
 * `list.member_added`/`list.member_removed` sendes på hendelsesbussen (og
 * starter flyter) og kontaktens tidslinje oppdateres.
 */

import { prisma } from '@/lib/prisma';
import { emitEvent } from '@/lib/events/bus';

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

async function recordChange(
  type: 'list.member_added' | 'list.member_removed',
  list: { id: number; name: string },
  membership: { contactId: number; addedAt: Date },
  opts: ListChangeOptions,
): Promise<void> {
  const inserted = await emitEvent({
    type,
    source: 'server',
    contactId: membership.contactId,
    meta: { listId: list.id, listName: list.name, source: opts.source },
    dedupeKey: membershipDedupeKey(type, list.id, membership.contactId, membership.addedAt),
  });
  if (!inserted) return;

  await prisma.contactActivity
    .create({
      data: {
        contactId: membership.contactId,
        type: 'list',
        title: type === 'list.member_added' ? `Lagt til i listen ${list.name}` : `Fjernet fra listen ${list.name}`,
        meta: JSON.stringify({ listId: list.id, source: opts.source }),
        actorEmail: opts.actorEmail ?? null,
      },
    })
    .catch(() => {});
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

  for (const membership of created) {
    await recordChange('list.member_added', list, membership, opts);
    result.addedContactIds.push(membership.contactId);
  }
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

  for (const membership of existing) {
    await recordChange('list.member_removed', list, membership, opts);
  }
  return { removed: existing.length, notMember: uniqueIds.length - existing.length };
}
