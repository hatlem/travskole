import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit coverage for tjenestelaget bak barneredigering (lib/children.ts) — det
 * som deles av selvbetjeningen og admin: eierskapssjekk, validering av den
 * sammenslåtte tilstanden ved delvise oppdateringer, og soft delete med vern
 * mot å fjerne barn som har aktive påmeldinger.
 *
 * Kun prisma er mocket; valideringsreglene som kjøres er de ekte.
 */

const { prisma } = vi.hoisted(() => ({
  prisma: {
    child: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    registration: { count: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma }));

import {
  createChildForParent,
  updateChildForParent,
  removeChildForParent,
} from '@/lib/children';

const existingChild = {
  id: 7,
  name: 'Kari Nordmann',
  birthdate: new Date('2016-05-04T00:00:00Z'),
  allergies: 'Nøtter',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createChildForParent', () => {
  it('creates the child on the given parent', async () => {
    prisma.child.create.mockResolvedValue({
      id: 11,
      name: 'Ola Nordmann',
      birthdate: new Date('2018-01-02T00:00:00Z'),
      allergies: null,
    });

    const result = await createChildForParent(3, {
      name: 'Ola Nordmann',
      birthdate: '2018-01-02',
      allergies: '  ',
    });

    expect(result).toEqual({
      ok: true,
      child: {
        id: 11,
        name: 'Ola Nordmann',
        birthdate: '2018-01-02T00:00:00.000Z',
        allergies: null,
      },
    });
    expect(prisma.child.create).toHaveBeenCalledWith({
      data: { parentId: 3, name: 'Ola Nordmann', birthdate: new Date('2018-01-02'), allergies: null },
    });
  });

  it('rejects invalid input without touching the database', async () => {
    const result = await createChildForParent(3, { name: 'O' });

    expect(result).toEqual({ ok: false, status: 400, error: 'Barnets navn må være minst 2 tegn' });
    expect(prisma.child.create).not.toHaveBeenCalled();
  });
});

describe('updateChildForParent', () => {
  it('404s when the child does not belong to the parent', async () => {
    prisma.child.findFirst.mockResolvedValue(null);

    const result = await updateChildForParent(3, 7, { name: 'Nytt navn' });

    expect(result).toEqual({ ok: false, status: 404, error: 'Barnet ble ikke funnet' });
    expect(prisma.child.update).not.toHaveBeenCalled();
  });

  it('scopes the lookup to the parent so foreign ids cannot be edited', async () => {
    prisma.child.findFirst.mockResolvedValue(null);

    await updateChildForParent(3, 7, { name: 'Nytt navn' });

    expect(prisma.child.findFirst).toHaveBeenCalledWith({
      where: { id: 7, parentId: 3, deletedAt: null },
      select: { id: true, name: true, birthdate: true, allergies: true },
    });
  });

  it('updates only the supplied fields', async () => {
    prisma.child.findFirst.mockResolvedValue(existingChild);
    prisma.child.update.mockResolvedValue({ ...existingChild, allergies: 'Melk' });

    const result = await updateChildForParent(3, 7, { allergies: 'Melk' });

    expect(result.ok).toBe(true);
    expect(prisma.child.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { allergies: 'Melk' },
    });
  });

  it('clears the birthdate when an empty string is sent', async () => {
    prisma.child.findFirst.mockResolvedValue(existingChild);
    prisma.child.update.mockResolvedValue({ ...existingChild, birthdate: null });

    await updateChildForParent(3, 7, { birthdate: '' });

    expect(prisma.child.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { birthdate: null },
    });
  });

  it('validates the merged state, not just the sent fields', async () => {
    prisma.child.findFirst.mockResolvedValue(existingChild);

    const result = await updateChildForParent(3, 7, { name: 'A' });

    expect(result).toEqual({ ok: false, status: 400, error: 'Barnets navn må være minst 2 tegn' });
    expect(prisma.child.update).not.toHaveBeenCalled();
  });
});

describe('removeChildForParent', () => {
  it('refuses while active registrations exist', async () => {
    prisma.child.findFirst.mockResolvedValue({ id: 7 });
    prisma.registration.count.mockResolvedValue(2);

    const result = await removeChildForParent(3, 7);

    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(prisma.child.update).not.toHaveBeenCalled();
  });

  it('soft-deletes so the registration history survives', async () => {
    prisma.child.findFirst.mockResolvedValue({ id: 7 });
    prisma.registration.count.mockResolvedValue(0);
    prisma.child.update.mockResolvedValue({ ...existingChild, deletedAt: new Date() });

    const result = await removeChildForParent(3, 7);

    expect(result).toEqual({ ok: true, child: null });
    const call = prisma.child.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 7 });
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });

  it('only counts non-cancelled registrations as blocking', async () => {
    prisma.child.findFirst.mockResolvedValue({ id: 7 });
    prisma.registration.count.mockResolvedValue(0);
    prisma.child.update.mockResolvedValue(existingChild);

    await removeChildForParent(3, 7);

    expect(prisma.registration.count).toHaveBeenCalledWith({
      where: { childId: 7, status: { in: ['pending', 'confirmed', 'waitlist'] } },
    });
  });
});
