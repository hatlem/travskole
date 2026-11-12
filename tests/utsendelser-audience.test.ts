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
    expect((await loadAudience(U)).get('borte')).toEqual({ ids: null, reachable: new Set() });
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
});
