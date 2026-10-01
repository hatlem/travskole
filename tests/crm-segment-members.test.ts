import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, addContactsToList } = vi.hoisted(() => ({
  prisma: {
    contact: { findMany: vi.fn(), findUnique: vi.fn() },
    segment: { findMany: vi.fn(), findUnique: vi.fn() },
    contactList: { create: vi.fn() },
  },
  addContactsToList: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/crm/list-membership', () => ({ addContactsToList }));

import {
  SEGMENT_CONVERT_CAP,
  convertSegmentToList,
  defaultListName,
  segmentMemberCounts,
  segmentMemberIds,
  segmentsForContactId,
} from '@/lib/crm/segment-members';

const row = (id: number, o: Record<string, unknown> = {}) => ({
  id,
  stage: 'customer',
  source: 'booking',
  email: `k${id}@acme.no`,
  organizationId: 1,
  lastActivityAt: new Date('2026-06-01'),
  tags: '[]',
  deals: [] as { eventType: string | null; eventDate: Date | null; status: string }[],
  ...o,
});

const CONTACTS = [
  row(1, { deals: [{ eventType: 'julebord', eventDate: new Date('2025-12-12'), status: 'won' }] }),
  row(2, { stage: 'lead', tags: '["vip"]' }),
  row(3, { deals: [{ eventType: 'julebord', eventDate: new Date('2026-12-12'), status: 'open' }], tags: '["vip"]' }),
  row(4, { stage: 'lead' }),
];

const SEGMENTS = [
  { id: 10, name: 'Julebord før 2026', rules: '{"all":[{"field":"deal.eventType","op":"eq","value":"julebord"},{"field":"deal.eventDate","op":"lt","value":"2026-01-01"}]}' },
  { id: 11, name: 'Interessenter', rules: '{"all":[{"field":"stage","op":"eq","value":"lead"}]}' },
  { id: 12, name: 'VIP', rules: '{"all":[{"field":"tags","op":"contains","value":"vip"}]}' },
];

beforeEach(() => {
  vi.clearAllMocks();
  prisma.contact.findMany.mockResolvedValue(CONTACTS);
  prisma.contact.findUnique.mockImplementation(async ({ where }: { where: { id: number } }) =>
    CONTACTS.find((c) => c.id === where.id) ?? null);
  prisma.segment.findMany.mockResolvedValue(SEGMENTS);
  prisma.segment.findUnique.mockImplementation(async ({ where }: { where: { id: number } }) =>
    SEGMENTS.find((s) => s.id === where.id) ?? null);
});

describe('segmentsForContactId', () => {
  it('gir segmentene med regler i klartekst', async () => {
    expect(await segmentsForContactId(1)).toEqual([
      { id: 10, name: 'Julebord før 2026', reasons: ['Har en avtale der type er julebord og dato er før 01.01.2026'] },
    ]);
  });

  it('ukjent kontakt ⇒ null, system-kontakt ⇒ ingen segmenter', async () => {
    expect(await segmentsForContactId(99)).toBeNull();
    prisma.contact.findUnique.mockResolvedValueOnce(row(5, { source: 'system', stage: 'lead' }));
    expect(await segmentsForContactId(5)).toEqual([]);
  });

  it('er enig med bulk-evalueringen for alle kontakter og segmenter', async () => {
    for (const segment of SEGMENTS) {
      const bulk = await segmentMemberIds(segment.id);
      const single: number[] = [];
      for (const c of CONTACTS) {
        if ((await segmentsForContactId(c.id))!.some((s) => s.id === segment.id)) single.push(c.id);
      }
      expect(single).toEqual(bulk);
    }
  });
});

describe('segmentMemberIds / segmentMemberCounts', () => {
  it('teller medlemmer per segment med én kontaktspørring', async () => {
    expect(await segmentMemberCounts(SEGMENTS)).toEqual({ 10: 1, 11: 2, 12: 2 });
    expect(prisma.contact.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { source: { not: 'system' } } }),
    );
  });

  it('ukjent segment ⇒ null', async () => {
    expect(await segmentMemberIds(99)).toBeNull();
  });

  it('ingen segmenter ⇒ ingen spørring', async () => {
    expect(await segmentMemberCounts([])).toEqual({});
    expect(prisma.contact.findMany).not.toHaveBeenCalled();
  });
});

describe('convertSegmentToList', () => {
  const now = new Date('2026-10-01T12:00:00Z');

  it('lager liste og melder inn via addContactsToList (utløser flyter)', async () => {
    prisma.contactList.create.mockResolvedValue({ id: 7, name: 'VIP (liste 01.10.2026)' });
    addContactsToList.mockResolvedValue({ added: 2, alreadyMember: 0, missing: 0, addedContactIds: [2, 3] });

    const result = await convertSegmentToList(12, { actorEmail: 'admin@bjerke.no', now });

    expect(result).toEqual({ ok: true, list: { id: 7, name: 'VIP (liste 01.10.2026)' }, added: 2 });
    expect(prisma.contactList.create).toHaveBeenCalledWith({
      data: { name: 'VIP (liste 01.10.2026)' },
      select: { id: true, name: true },
    });
    expect(addContactsToList).toHaveBeenCalledWith(7, [2, 3], { source: 'manual', actorEmail: 'admin@bjerke.no' });
  });

  it('bruker oppgitt navn', async () => {
    prisma.contactList.create.mockResolvedValue({ id: 8, name: 'Sommerfest' });
    addContactsToList.mockResolvedValue({ added: 2, alreadyMember: 0, missing: 0, addedContactIds: [2, 4] });
    await convertSegmentToList(11, { name: '  Sommerfest ', now });
    expect(prisma.contactList.create).toHaveBeenCalledWith(expect.objectContaining({ data: { name: 'Sommerfest' } }));
  });

  it('ukjent segment ⇒ not_found uten å lage liste', async () => {
    expect(await convertSegmentToList(99, { now })).toEqual({ ok: false, reason: 'not_found' });
    expect(prisma.contactList.create).not.toHaveBeenCalled();
  });

  it('for store segmenter avvises uten å lage liste', async () => {
    prisma.contact.findMany.mockResolvedValue(
      Array.from({ length: SEGMENT_CONVERT_CAP + 1 }, (_, i) => row(i + 1, { stage: 'lead' })),
    );
    expect(await convertSegmentToList(11, { now })).toEqual({
      ok: false, reason: 'too_many', count: SEGMENT_CONVERT_CAP + 1,
    });
    expect(prisma.contactList.create).not.toHaveBeenCalled();
    expect(addContactsToList).not.toHaveBeenCalled();
  });
});

describe('defaultListName', () => {
  it('holder seg innenfor 200 tegn', () => {
    const name = defaultListName('x'.repeat(250), new Date('2026-10-01T12:00:00Z'));
    expect(name).toHaveLength(200);
    expect(name.endsWith(' (liste 01.10.2026)')).toBe(true);
  });
});
