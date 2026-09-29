import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    flowEnrollment: { findFirst: vi.fn(), create: vi.fn() },
    contact: { findMany: vi.fn() },
    suppression: { findMany: vi.fn() },
    segment: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));

import { enrollContacts, enrollSegment, SEGMENT_ENROLL_CAP } from '@/lib/flows/enroll';

beforeEach(() => {
  vi.clearAllMocks();
  prisma.flowEnrollment.create.mockResolvedValue({ id: 1 });
  prisma.suppression.findMany.mockResolvedValue([]);
});

describe('enrollContacts', () => {
  it('teller innmeldte, allerede aktive, suppresserte og manglende', async () => {
    prisma.contact.findMany.mockResolvedValue([
      { id: 1, email: 'ny@example.no' },
      { id: 2, email: 'Aktiv@Example.no' },
      { id: 3, email: 'AVMELDT@example.no' },
      { id: 4, email: null },
    ]);
    prisma.suppression.findMany.mockResolvedValue([{ email: 'avmeldt@example.no' }]);
    prisma.flowEnrollment.findFirst.mockImplementation(async ({ where }: { where: { contactId: number } }) =>
      where.contactId === 2 ? { id: 99 } : null,
    );

    const summary = await enrollContacts(5, [1, 2, 3, 4, 9, 1]);

    expect(summary).toEqual({ enrolled: 2, skippedActive: 1, skippedSuppressed: 1, skippedMissing: 1, capped: 0 });
    // suppresjonsoppslaget bruker normaliserte adresser
    expect(prisma.suppression.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: { in: ['ny@example.no', 'aktiv@example.no', 'avmeldt@example.no'] } } }),
    );
    const createdFor = prisma.flowEnrollment.create.mock.calls.map((c) => c[0].data.contactId);
    expect(createdFor).toEqual([1, 4]);
  });

  it('tom liste gjør ingen oppslag', async () => {
    expect(await enrollContacts(5, [])).toEqual({ enrolled: 0, skippedActive: 0, skippedSuppressed: 0, skippedMissing: 0, capped: 0 });
    expect(prisma.contact.findMany).not.toHaveBeenCalled();
  });
});

describe('enrollSegment', () => {
  it('melder inn treff og rapporterer overskudd over taket', async () => {
    prisma.segment.findUnique.mockResolvedValue({ id: 1, rules: '{"all":[]}' });
    const total = SEGMENT_ENROLL_CAP + 3;
    const contacts = Array.from({ length: total }, (_, i) => ({
      id: i + 1,
      email: null,
      stage: 'lead',
      source: 'manual',
      organizationId: null,
      lastActivityAt: null,
      tags: '[]',
      deals: [],
    }));
    prisma.contact.findMany
      .mockResolvedValueOnce(contacts) // segment-evaluering
      .mockResolvedValueOnce(contacts.slice(0, SEGMENT_ENROLL_CAP).map((c) => ({ id: c.id, email: null })));
    prisma.flowEnrollment.findFirst.mockResolvedValue(null);

    const summary = await enrollSegment(5, 1);
    expect(summary.enrolled).toBe(SEGMENT_ENROLL_CAP);
    expect(summary.capped).toBe(3);
  });

  it('ukjent segment gir tom oppsummering', async () => {
    prisma.segment.findUnique.mockResolvedValue(null);
    expect((await enrollSegment(5, 1)).enrolled).toBe(0);
  });
});
