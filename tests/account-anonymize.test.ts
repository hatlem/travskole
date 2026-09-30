import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, purgeReviewDraftsForContact } = vi.hoisted(() => {
  const model = () => ({
    findUnique: vi.fn(),
    count: vi.fn<(args?: unknown) => Promise<number>>(async () => 0),
    findMany: vi.fn(async (): Promise<unknown[]> => []),
    update: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({ count: 0 })),
    deleteMany: vi.fn(async () => ({ count: 0 })),
  });
  const prisma = {
    user: model(),
    child: model(),
    parent: model(),
    contact: model(),
    bookingRequest: model(),
    consent: model(),
    contactListMembership: model(),
    note: model(),
    visitor: model(),
    flowEnrollment: model(),
    messageSend: model(),
    contactActivity: model(),
    task: model(),
    appEvent: model(),
    deal: model(),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
  return { prisma, purgeReviewDraftsForContact: vi.fn(async () => 0) };
});

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/ai/review', () => ({ purgeReviewDraftsForContact }));

import { anonymizeAccount, piiNeedles, scrubText } from '@/lib/account-anonymize';

beforeEach(() => {
  vi.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue({
    email: 'Kari@Example.com',
    parent: {
      id: 4,
      name: 'Kari Nordmann',
      phone: '98765432',
      address: 'Storgata 1',
      children: [{ name: 'Emma Nordmann' }],
      registrations: [{ id: 30 }],
    },
  });
  prisma.contact.findMany.mockResolvedValue([{ id: 11, name: 'Kari Nordmann', email: 'kari@example.com', phone: '98765432' }]);
  prisma.bookingRequest.findMany.mockResolvedValue([{ id: 21, name: 'Kari N.', email: 'kari@example.com', phone: '98765432' }]);
  prisma.messageSend.findMany.mockResolvedValue([{ id: 41, subject: 'Hei Kari Nordmann!' }]);
  prisma.contactActivity.findMany.mockResolvedValue([
    { id: 51, title: 'Julebord — Kari N.: Ny → Vunnet', meta: '{"email":"kari@example.com","registrationId":30}' },
  ]);
  prisma.task.findMany.mockResolvedValue([{ id: 61, title: 'Svar til Kari Nordmann' }, { id: 62, title: 'Ring tilbake' }]);
  prisma.appEvent.findMany.mockResolvedValue([{ id: 71, meta: '{"email":"kari@example.com"}' }]);
  prisma.deal.findMany.mockResolvedValue([{ id: 81, title: 'Ponniskole — Kari Nordmann' }]);
});

describe('scrubText / piiNeedles', () => {
  it('replaces every case-insensitive occurrence, longest needle first', () => {
    const needles = piiNeedles(['Kari', 'Kari Nordmann', 'kari@example.com', '', null, 'ab']);
    expect(needles).toEqual(['kari@example.com', 'Kari Nordmann', 'Kari']);
    expect(scrubText('Mail fra KARI@example.com til Kari Nordmann', needles)).toBe('Mail fra Anonymisert til Anonymisert');
  });

  it('escapes regex characters in needles', () => {
    expect(scrubText('Ring (+47) 123', piiNeedles(['(+47) 123']))).toBe('Ring Anonymisert');
  });
});

describe('anonymizeAccount', () => {
  it('scrubs the CRM contact but keeps it (and its deals) for bookkeeping', async () => {
    await anonymizeAccount(9);

    expect(prisma.contact.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ userId: 9 }, { parentId: 4 }, { email: 'kari@example.com' }] },
    }));
    expect(prisma.contact.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: expect.objectContaining({
        name: 'Anonymisert', email: null, phone: null, tags: '[]', customFields: '{}', organizationId: null,
      }),
    });
    expect(prisma.consent.deleteMany).toHaveBeenCalledWith({ where: { contactId: { in: [11] } } });
    expect(prisma.note.deleteMany).toHaveBeenCalledWith({ where: { contactId: { in: [11] } } });
    expect(prisma.contactListMembership.deleteMany).toHaveBeenCalled();
    expect(prisma.visitor.updateMany).toHaveBeenCalledWith({ where: { contactId: { in: [11] } }, data: { contactId: null } });
    expect(prisma.flowEnrollment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { contactId: { in: [11] }, status: 'active' },
    }));
    expect(purgeReviewDraftsForContact).toHaveBeenCalledWith(11);
  });

  it('scrubs booking requests by user or email, keeping amounts/status untouched', async () => {
    await anonymizeAccount(9);
    expect(prisma.bookingRequest.findMany).toHaveBeenCalledWith({
      where: { OR: [{ userId: 9 }, { email: { equals: 'kari@example.com', mode: 'insensitive' } }] },
      select: { id: true, name: true, email: true, phone: true },
    });
    const call = prisma.bookingRequest.update.mock.calls[0] as unknown as [{ where: unknown; data: Record<string, unknown> }];
    expect(call[0].where).toEqual({ id: 21 });
    expect(call[0].data).toEqual({
      name: 'Anonymisert',
      email: 'anonymisert-booking-21@slettet.local',
      phone: '',
      message: null,
      userId: null,
    });
  });

  it('scrubs PII in timeline, sent mail, tasks, events and deal titles', async () => {
    await anonymizeAccount(9);
    expect(prisma.messageSend.update).toHaveBeenCalledWith({
      where: { id: 41 },
      data: { toEmail: 'anonymisert@slettet.local', subject: 'Hei Anonymisert!', bodyHtml: '' },
    });
    expect(prisma.contactActivity.update).toHaveBeenCalledWith({
      where: { id: 51 },
      data: { title: 'Julebord — Anonymisert: Ny → Vunnet', meta: '{"email":"Anonymisert","registrationId":30}', body: null },
    });
    expect(prisma.task.update).toHaveBeenCalledTimes(1);
    expect(prisma.task.update).toHaveBeenCalledWith({ where: { id: 61 }, data: { title: 'Svar til Anonymisert' } });
    expect(prisma.appEvent.update).toHaveBeenCalledWith({ where: { id: 71 }, data: { meta: '{"email":"Anonymisert"}' } });
    expect(prisma.deal.findMany).toHaveBeenCalledWith({
      where: { OR: [{ contactId: { in: [11] } }, { bookingRequestId: { in: [21] } }, { registrationId: { in: [30] } }] },
      select: { id: true, title: true, organizationId: true },
    });
    expect(prisma.deal.update).toHaveBeenCalledWith({ where: { id: 81 }, data: { title: 'Ponniskole — Anonymisert' } });
  });

  it('keeps a deal\'s organization when it has other contacts, drops it when the person was the only one', async () => {
    prisma.deal.findMany.mockResolvedValue([
      { id: 81, title: 'Julebord', organizationId: 5 },
      { id: 82, title: 'Firmafest', organizationId: 6 },
      { id: 83, title: 'Kurs', organizationId: null },
    ]);
    prisma.contact.count.mockImplementation(async (args) =>
      (args as { where: { organizationId: number } }).where.organizationId === 5 ? 3 : 0,
    );
    await anonymizeAccount(9);
    expect(prisma.contact.count).toHaveBeenCalledWith({ where: { organizationId: 5, id: { notIn: [11] } } });
    expect(prisma.contact.count).toHaveBeenCalledTimes(2);
    expect(prisma.deal.update).toHaveBeenCalledTimes(1);
    expect(prisma.deal.update).toHaveBeenCalledWith({ where: { id: 82 }, data: { title: 'Firmafest', organizationId: null } });
  });

  it('scrubs parent/children and closes the login', async () => {
    await anonymizeAccount(9);
    expect(prisma.parent.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: expect.objectContaining({ name: '[slettet]', phone: '', address: null }),
    });
    expect(prisma.child.updateMany).toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: expect.objectContaining({ email: 'anonymisert-9@slettet.local', passwordHash: null }),
    });
  });

  it('is a no-op for an unknown user', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await anonymizeAccount(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('scrubText word boundaries', () => {
  it('does not replace a short name inside another word', () => {
    expect(scrubText('Ola bestilte til Solan', piiNeedles(['Ola']))).toBe('Anonymisert bestilte til Solan');
    expect(scrubText('Åse og Åsebø', piiNeedles(['Åse']))).toBe('Anonymisert og Åsebø');
  });
});
