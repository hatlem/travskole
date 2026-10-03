import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    flowEnrollment: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    contact: { findMany: vi.fn() },
    suppression: { findMany: vi.fn() },
    segment: { findUnique: vi.fn() },
    contactList: { findUnique: vi.fn() },
    contactListMembership: { findMany: vi.fn() },
    flow: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
const { settings } = vi.hoisted(() => ({ settings: {} as Record<string, string> }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async (key: string) => settings[key] ?? '') }));

import { enrollContacts, enrollList, enrollSegment, SEGMENT_ENROLL_CAP } from '@/lib/flows/enroll';

beforeEach(() => {
  vi.clearAllMocks();
  prisma.flowEnrollment.create.mockResolvedValue({ id: 1 });
  prisma.suppression.findMany.mockResolvedValue([]);
  prisma.flow.findUnique.mockResolvedValue({ isMarketing: false });
  for (const key of Object.keys(settings)) delete settings[key];
});

describe('enrollContacts', () => {
  it('teller innmeldte, allerede aktive, suppresserte og manglende', async () => {
    prisma.contact.findMany.mockResolvedValue([
      { id: 1, email: 'ny@example.no' },
      { id: 2, email: 'Aktiv@Example.no' },
      { id: 3, email: 'AVMELDT@example.no' },
      { id: 4, email: null },
    ]);
    prisma.suppression.findMany.mockResolvedValue([{ email: 'avmeldt@example.no', reason: 'bounce' }]);
    prisma.flowEnrollment.findFirst.mockImplementation(async ({ where }: { where: { contactId: number } }) =>
      where.contactId === 2 ? { id: 99 } : null,
    );

    const summary = await enrollContacts(5, [1, 2, 3, 4, 9, 1]);

    expect(summary).toEqual({ enrolled: 2, skippedActive: 1, skippedSuppressed: 1, skippedNoConsent: 0, skippedMissing: 1, capped: 0 });
    // suppresjonsoppslaget bruker normaliserte adresser
    expect(prisma.suppression.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: { in: ['ny@example.no', 'aktiv@example.no', 'avmeldt@example.no'] } } }),
    );
    const createdFor = prisma.flowEnrollment.create.mock.calls.map((c) => c[0].data.contactId);
    expect(createdFor).toEqual([1, 4]);
  });

  it('tom liste gjør ingen oppslag', async () => {
    expect(await enrollContacts(5, [])).toEqual({ enrolled: 0, skippedActive: 0, skippedSuppressed: 0, skippedNoConsent: 0, skippedMissing: 0, capped: 0 });
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

describe('enrollList', () => {
  it('melder inn listens medlemmer; aktive og suppresserte hoppes over', async () => {
    prisma.contactList.findUnique.mockResolvedValue({ id: 3 });
    prisma.contactListMembership.findMany.mockResolvedValue([{ contactId: 1 }, { contactId: 2 }, { contactId: 3 }]);
    prisma.flowEnrollment.findMany.mockResolvedValue([{ contactId: 2 }]);
    prisma.contact.findMany.mockResolvedValue([
      { id: 1, email: 'a@example.no' },
      { id: 3, email: 'avmeldt@example.no' },
    ]);
    prisma.suppression.findMany.mockResolvedValue([{ email: 'avmeldt@example.no', reason: 'bounce' }]);
    prisma.flowEnrollment.findFirst.mockResolvedValue(null);

    const summary = await enrollList(5, 3);

    expect(summary).toEqual({ enrolled: 1, skippedActive: 1, skippedSuppressed: 1, skippedNoConsent: 0, skippedMissing: 0, capped: 0 });
    expect(prisma.contact.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [1, 3] } } }));
  });

  it('allerede aktive tas ut før taket, så en ny kjøring når resten', async () => {
    const total = SEGMENT_ENROLL_CAP + 10;
    prisma.contactList.findUnique.mockResolvedValue({ id: 3 });
    prisma.contactListMembership.findMany.mockResolvedValue(Array.from({ length: total }, (_, i) => ({ contactId: i + 1 })));
    prisma.flowEnrollment.findMany.mockResolvedValue(
      Array.from({ length: SEGMENT_ENROLL_CAP }, (_, i) => ({ contactId: i + 1 })),
    );
    prisma.contact.findMany.mockImplementation(async ({ where }: { where: { id: { in: number[] } } }) =>
      where.id.in.map((id) => ({ id, email: null })),
    );
    prisma.flowEnrollment.findFirst.mockResolvedValue(null);

    const summary = await enrollList(5, 3);

    expect(summary).toMatchObject({ enrolled: 10, skippedActive: SEGMENT_ENROLL_CAP, capped: 0 });
  });

  it('ukjent liste ⇒ null', async () => {
    prisma.contactList.findUnique.mockResolvedValue(null);
    expect(await enrollList(5, 99)).toBeNull();
  });
});

describe('enrollContacts: samtykke og avmelding', () => {
  beforeEach(() => {
    prisma.flowEnrollment.findFirst.mockResolvedValue(null);
  });

  it('markedsføringsflyt: kontakter uten samtykke meldes ikke inn og telles som «mangler samtykke»', async () => {
    prisma.flow.findUnique.mockResolvedValue({ isMarketing: true });
    prisma.contact.findMany.mockResolvedValue([
      { id: 1, email: 'ja@example.no', organizationId: null, consent: { marketing: true, lawfulBasis: 'consent', consentAt: new Date() } },
      { id: 2, email: 'nei@example.no', organizationId: null, consent: null },
      { id: 3, email: 'bedrift@example.no', organizationId: 9, consent: null },
    ]);

    const summary = await enrollContacts(5, [1, 2, 3]);

    expect(summary).toMatchObject({ enrolled: 1, skippedNoConsent: 2 });
    expect(prisma.flowEnrollment.create.mock.calls.map((c) => c[0].data.contactId)).toEqual([1]);
  });

  it('markedsføringsflyt: berettiget interesse for bedriftskontakter når innstillingen er på', async () => {
    settings.marketing_allow_legitimate_interest = 'true';
    prisma.flow.findUnique.mockResolvedValue({ isMarketing: true });
    prisma.contact.findMany.mockResolvedValue([{ id: 3, email: 'bedrift@example.no', organizationId: 9, consent: null }]);
    expect(await enrollContacts(5, [3])).toMatchObject({ enrolled: 1, skippedNoConsent: 0 });
  });

  it('tjenesteflyt: avmeldt kontakt meldes inn (avmelding gjelder bare markedsføring), bounce gjør det ikke', async () => {
    prisma.contact.findMany.mockResolvedValue([
      { id: 1, email: 'avmeldt@example.no', organizationId: null, consent: null },
      { id: 2, email: 'bounce@example.no', organizationId: null, consent: null },
    ]);
    prisma.suppression.findMany.mockResolvedValue([
      { email: 'avmeldt@example.no', reason: 'unsubscribe' },
      { email: 'bounce@example.no', reason: 'bounce' },
    ]);
    expect(await enrollContacts(5, [1, 2])).toMatchObject({ enrolled: 1, skippedSuppressed: 1, skippedNoConsent: 0 });
  });
});
