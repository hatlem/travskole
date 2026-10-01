/**
 * Segmentmedlemskap mot databasen. Medlemskap lagres ikke — det beregnes fra
 * reglene ved lesing, med samme evaluering for én kontakt og for alle.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { parseJsonArray } from '@/lib/crm/normalize';
import { addContactsToList } from '@/lib/crm/list-membership';
import {
  contactMatchesSegment,
  describeSegmentRules,
  parseSegmentRules,
  segmentsForContact,
  type SegmentContact,
} from '@/lib/crm/segments';

export const SEGMENT_CONVERT_CAP = 2000;

const segmentContactSelect = {
  id: true,
  stage: true,
  source: true,
  email: true,
  organizationId: true,
  lastActivityAt: true,
  tags: true,
  deals: { select: { eventType: true, eventDate: true, status: true } },
} satisfies Prisma.ContactSelect;

type SegmentContactRow = Prisma.ContactGetPayload<{ select: typeof segmentContactSelect }>;

export function toSegmentContact(row: Omit<SegmentContactRow, 'id'>): SegmentContact {
  return {
    stage: row.stage,
    source: row.source,
    email: row.email,
    organizationId: row.organizationId,
    lastActivityAt: row.lastActivityAt,
    tags: parseJsonArray(row.tags),
    deals: row.deals,
  };
}

async function loadAllSegmentContacts(): Promise<Array<{ id: number; contact: SegmentContact }>> {
  const rows = await prisma.contact.findMany({
    where: { source: { not: 'system' } },
    select: segmentContactSelect,
  });
  return rows.map((row) => ({ id: row.id, contact: toSegmentContact(row) }));
}

export interface ContactSegmentMatch {
  id: number;
  name: string;
  reasons: string[];
}

/** Segmentene én kontakt treffer, med reglene i klartekst. null når kontakten ikke finnes. */
export async function segmentsForContactId(contactId: number): Promise<ContactSegmentMatch[] | null> {
  const [row, segments] = await Promise.all([
    prisma.contact.findUnique({ where: { id: contactId }, select: segmentContactSelect }),
    prisma.segment.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, rules: true } }),
  ]);
  if (!row) return null;
  if (row.source === 'system') return [];

  return segmentsForContact(toSegmentContact(row), segments).map((segment) => ({
    id: segment.id,
    name: segment.name,
    reasons: describeSegmentRules(parseSegmentRules(segment.rules)),
  }));
}

/** Kontakt-idene som treffer segmentet (system-kontakter utelatt). null når segmentet ikke finnes. */
export async function segmentMemberIds(segmentId: number): Promise<number[] | null> {
  const segment = await prisma.segment.findUnique({ where: { id: segmentId }, select: { rules: true } });
  if (!segment) return null;
  const rules = parseSegmentRules(segment.rules);
  const contacts = await loadAllSegmentContacts();
  return contacts.filter((c) => contactMatchesSegment(c.contact, rules)).map((c) => c.id);
}

/** Antall medlemmer per segment — én kontaktspørring for alle segmentene. */
export async function segmentMemberCounts(
  segments: ReadonlyArray<{ id: number; rules: string }>,
): Promise<Record<number, number>> {
  if (segments.length === 0) return {};
  const contacts = await loadAllSegmentContacts();
  const counts: Record<number, number> = {};
  for (const segment of segments) {
    const rules = parseSegmentRules(segment.rules);
    counts[segment.id] = contacts.reduce((n, c) => n + (contactMatchesSegment(c.contact, rules) ? 1 : 0), 0);
  }
  return counts;
}

export type ConvertSegmentResult =
  | { ok: true; list: { id: number; name: string }; added: number }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'too_many'; count: number };

export function defaultListName(segmentName: string, now: Date): string {
  const suffix = ` (liste ${now.toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' })})`;
  return `${segmentName.slice(0, 200 - suffix.length)}${suffix}`;
}

/**
 * Øyeblikksbilde av segmentet som ny manuell liste. Innmelding går via
 * addContactsToList, så flyter med utløseren «Lagt til i CRM-liste» starter.
 */
export async function convertSegmentToList(
  segmentId: number,
  opts: { name?: string; actorEmail?: string | null; now?: Date },
): Promise<ConvertSegmentResult> {
  const segment = await prisma.segment.findUnique({ where: { id: segmentId }, select: { name: true } });
  if (!segment) return { ok: false, reason: 'not_found' };

  const ids = await segmentMemberIds(segmentId);
  if (!ids) return { ok: false, reason: 'not_found' };
  if (ids.length > SEGMENT_CONVERT_CAP) return { ok: false, reason: 'too_many', count: ids.length };

  const name = opts.name?.trim() || defaultListName(segment.name, opts.now ?? new Date());
  const list = await prisma.contactList.create({ data: { name }, select: { id: true, name: true } });
  const result = await addContactsToList(list.id, ids, { source: 'manual', actorEmail: opts.actorEmail ?? null });
  return { ok: true, list, added: result?.added ?? 0 };
}
