/** Hvem i en gruppe som kan få e-post – samme regel for oversikten og «Send». */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, settings } = vi.hoisted(() => ({
  prisma: {
    segment: { findMany: vi.fn() },
    flow: { findMany: vi.fn() },
    contact: { findMany: vi.fn() },
    suppression: { findMany: vi.fn() },
    contactList: { findMany: vi.fn(async () => [{ id: 5 }]) },
    contactListMembership: { findMany: vi.fn(async () => [{ listId: 5, contactId: 1 }, { listId: 5, contactId: 6 }]) },
    utsendelseRecipient: { findMany: vi.fn() },
  },
  settings: { marketing_allow_legitimate_interest: 'true' } as Record<string, string>,
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async (k: string) => settings[k] ?? '') }));

import { loadAudience } from '@/lib/utsendelser/audience';
import type { Utsendelse } from '@/lib/utsendelser/config';

const U: Utsendelse = {
  id: 'u',
  navn: 'U',
  flyter: [{ flowId: 22, navn: 'Til personer' }],
  grupper: [
    { id: 'p1', navn: 'P1', segmentId: 2, flowId: 22 },
    { id: 'borte', navn: 'Borte', segmentId: 99, flowId: 22 },
  ],
};

const contact = (id: number, over: Record<string, unknown> = {}) => ({
  id, email: `k${id}@firma.no`, stage: 'lead', source: 'import', organizationId: 7, lastActivityAt: null,
  tags: '["juletrav-2026","prio-1"]', deals: [], consent: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  settings.marketing_allow_legitimate_interest = 'true';
  prisma.segment.findMany.mockResolvedValue([{ id: 2, rules: JSON.stringify({ all: [{ field: 'tags', op: 'contains', value: 'prio-1' }] }) }]);
  prisma.flow.findMany.mockResolvedValue([{ id: 22, isMarketing: true }]);
  prisma.utsendelseRecipient.findMany.mockResolvedValue([]);
  prisma.suppression.findMany.mockResolvedValue([{ email: 'k3@firma.no' }]);
  prisma.contact.findMany.mockResolvedValue([
    contact(1),
    contact(2, { email: null }),
    contact(3),
    contact(4, { consent: { marketing: false, lawfulBasis: null, consentAt: null } }),
    contact(5, { organizationId: null }),
    contact(6, { tags: '["prio-2"]' }),
  ]);
});

describe('loadAudience', () => {
  it('medlemmer etter segmentet; bare de med adresse, ikke avmeldt og med grunnlag kan få e-post', async () => {
    const a = await loadAudience(U);
    expect(a.get('p1')?.ids).toEqual([1, 2, 3, 4, 5]);
    expect([...(a.get('p1')?.reachable ?? [])]).toEqual([1]);
  });

  it('slettet segment gir ids = null', async () => {
    expect((await loadAudience(U)).get('borte')).toEqual({ ids: null, reachable: new Set(), excluded: [], movedIn: new Set() });
  });

  it('uten B2B berettiget interesse når ingen uten samtykke fram', async () => {
    settings.marketing_allow_legitimate_interest = 'false';
    expect((await loadAudience(U)).get('p1')?.reachable.size).toBe(0);
  });

  it('liste-gruppe: medlemmene i lista', async () => {
    const withList: Utsendelse = { ...U, grupper: [{ id: 'l', navn: 'L', listId: 5, flowId: 22 }] };
    const a = (await loadAudience(withList)).get('l');
    expect(a?.ids).toEqual([1, 6]);
    expect([...(a?.reachable ?? [])]).toEqual([1, 6]);
  });

  it('laster kontaktene én gang uansett antall grupper', async () => {
    await loadAudience(U);
    expect(prisma.contact.findMany).toHaveBeenCalledTimes(1);
  });

  it('tatt ut: borte fra gruppen og telles ikke, men vises som tatt ut', async () => {
    prisma.utsendelseRecipient.findMany.mockResolvedValue([{ contactId: 1, groupId: null, excluded: true }]);
    const a = (await loadAudience(U)).get('p1');
    expect(a?.ids).toEqual([2, 3, 4, 5]);
    expect(a?.reachable.has(1)).toBe(false);
    expect(a?.excluded).toEqual([1]);
  });

  it('flyttet: ut av den gamle gruppen og inn i den nye', async () => {
    const two: Utsendelse = {
      ...U,
      grupper: [
        { id: 'p1', navn: 'P1', segmentId: 2, flowId: 22 },
        { id: 'l', navn: 'L', listId: 5, flowId: 22 },
      ],
    };
    prisma.utsendelseRecipient.findMany.mockResolvedValue([{ contactId: 5, groupId: 'l', excluded: false }, { contactId: 1, groupId: 'l', excluded: false }]);
    const a = await loadAudience(two);
    expect(a.get('p1')?.ids).toEqual([2, 3, 4]);
    expect(a.get('l')?.ids).toEqual([6, 1, 5]);
    expect([...(a.get('l')?.movedIn ?? [])].sort()).toEqual([1, 5]);
    expect(a.get('l')?.excluded).toEqual([]);
  });

  it('henter valgene for riktig utsendelse', async () => {
    await loadAudience(U);
    expect(prisma.utsendelseRecipient.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { utsendelseId: 'u' } }));
  });

  it('flyttet til en gruppe som er fjernet: tilbake i sin vanlige gruppe', async () => {
    prisma.utsendelseRecipient.findMany.mockResolvedValue([{ contactId: 1, groupId: 'fjernet', excluded: false }]);
    expect((await loadAudience(U)).get('p1')?.ids).toEqual([1, 2, 3, 4, 5]);
  });

  it('flyttet og så tatt ut: vises som tatt ut i den nye gruppen, ikke i den gamle', async () => {
    const two: Utsendelse = {
      ...U,
      grupper: [
        { id: 'p1', navn: 'P1', segmentId: 2, flowId: 22 },
        { id: 'l', navn: 'L', listId: 5, flowId: 22 },
      ],
    };
    prisma.utsendelseRecipient.findMany.mockResolvedValue([{ contactId: 5, groupId: 'l', excluded: true }]);
    const a = await loadAudience(two);
    expect(a.get('p1')?.ids).not.toContain(5);
    expect(a.get('p1')?.excluded).toEqual([]);
    expect(a.get('l')?.ids).not.toContain(5);
    expect(a.get('l')?.excluded).toEqual([5]);
  });
});
