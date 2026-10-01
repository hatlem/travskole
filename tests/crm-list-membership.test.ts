import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, emitEvent } = vi.hoisted(() => ({
  prisma: {
    contactList: { findUnique: vi.fn() },
    contact: { findMany: vi.fn() },
    contactListMembership: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    contactActivity: { create: vi.fn() },
  },
  emitEvent: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/events/bus', () => ({ emitEvent }));

import { addContactsToList, membershipDedupeKey, removeContactsFromList } from '@/lib/crm/list-membership';

const LIST = { id: 3, name: 'Nyhetsbrev' };
const T1 = new Date('2026-10-01T10:00:00.000Z');
const T2 = new Date('2026-10-01T10:00:00.250Z');

beforeEach(() => {
  vi.clearAllMocks();
  prisma.contactList.findUnique.mockResolvedValue(LIST);
  prisma.contactListMembership.createMany.mockResolvedValue({ count: 0 });
  prisma.contactListMembership.deleteMany.mockResolvedValue({ count: 0 });
  prisma.contactActivity.create.mockResolvedValue({ id: 1 });
  emitEvent.mockResolvedValue(true);
});

describe('addContactsToList', () => {
  it('melder inn bare nye kontakter og sender list.member_added per ny', async () => {
    prisma.contact.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);
    prisma.contactListMembership.findMany
      .mockResolvedValueOnce([{ contactId: 2 }]) // eksisterende
      .mockResolvedValueOnce([
        { contactId: 1, addedAt: T1 },
        { contactId: 3, addedAt: T2 },
      ]);

    const result = await addContactsToList(3, [1, 2, 3, 9, 1], { source: 'manual', actorEmail: 'admin@bjerke.no' });

    expect(result).toEqual({ added: 2, alreadyMember: 1, missing: 1, addedContactIds: [1, 3] });
    expect(prisma.contactListMembership.createMany).toHaveBeenCalledWith({
      data: [
        { listId: 3, contactId: 1 },
        { listId: 3, contactId: 3 },
      ],
      skipDuplicates: true,
    });
    expect(emitEvent).toHaveBeenCalledTimes(2);
    expect(emitEvent).toHaveBeenCalledWith({
      type: 'list.member_added',
      source: 'server',
      contactId: 1,
      meta: { listId: 3, listName: 'Nyhetsbrev', source: 'manual' },
      dedupeKey: `list.member_added:3:1:${T1.getTime()}`,
    });
    expect(prisma.contactActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contactId: 1,
        type: 'list',
        title: 'Lagt til i listen Nyhetsbrev',
        actorEmail: 'admin@bjerke.no',
      }),
    });
  });

  it('ingen nye kontakter ⇒ ingen innsetting og ingen hendelser', async () => {
    prisma.contact.findMany.mockResolvedValue([{ id: 2 }]);
    prisma.contactListMembership.findMany.mockResolvedValueOnce([{ contactId: 2 }]);

    const result = await addContactsToList(3, [2], { source: 'manual' });

    expect(result).toEqual({ added: 0, alreadyMember: 1, missing: 0, addedContactIds: [] });
    expect(prisma.contactListMembership.createMany).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('dedup-treff i bussen (samtidig forespørsel) gir ingen dobbel tidslinje', async () => {
    prisma.contact.findMany.mockResolvedValue([{ id: 1 }]);
    prisma.contactListMembership.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ contactId: 1, addedAt: T1 }]);
    emitEvent.mockResolvedValue(false);

    await addContactsToList(3, [1], { source: 'import' });

    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ meta: expect.objectContaining({ source: 'import' }) }));
    expect(prisma.contactActivity.create).not.toHaveBeenCalled();
  });

  it('ukjent liste ⇒ null uten skriving', async () => {
    prisma.contactList.findUnique.mockResolvedValue(null);
    expect(await addContactsToList(99, [1], { source: 'manual' })).toBeNull();
    expect(prisma.contactListMembership.createMany).not.toHaveBeenCalled();
  });
});

describe('removeContactsFromList', () => {
  it('fjerner medlemskap og sender list.member_removed med medlemskapets nøkkel', async () => {
    prisma.contactListMembership.findMany.mockResolvedValueOnce([{ id: 11, contactId: 1, addedAt: T1 }]);

    const result = await removeContactsFromList(3, [1, 2], { source: 'manual', actorEmail: 'admin@bjerke.no' });

    expect(result).toEqual({ removed: 1, notMember: 1 });
    expect(prisma.contactListMembership.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [11] } } });
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'list.member_removed',
        contactId: 1,
        dedupeKey: `list.member_removed:3:1:${T1.getTime()}`,
      }),
    );
    expect(prisma.contactActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ title: 'Fjernet fra listen Nyhetsbrev' }),
    });
  });

  it('ikke medlem ⇒ ingen sletting eller hendelse', async () => {
    prisma.contactListMembership.findMany.mockResolvedValueOnce([]);
    expect(await removeContactsFromList(3, [1], { source: 'manual' })).toEqual({ removed: 0, notMember: 1 });
    expect(prisma.contactListMembership.deleteMany).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
  });
});

describe('membershipDedupeKey', () => {
  it('samme medlemskap gir samme nøkkel, ny innmelding etter fjerning gir ny', () => {
    const first = membershipDedupeKey('list.member_added', 3, 1, T1);
    expect(membershipDedupeKey('list.member_added', 3, 1, new Date(T1))).toBe(first);
    expect(membershipDedupeKey('list.member_added', 3, 1, T2)).not.toBe(first);
    expect(membershipDedupeKey('list.member_removed', 3, 1, T1)).not.toBe(first);
  });
});
