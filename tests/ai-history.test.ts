import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, settings } = vi.hoisted(() => ({
  prisma: {
    contact: { findUnique: vi.fn() },
    deal: { findMany: vi.fn() },
    bookingRequest: { findMany: vi.fn() },
    registration: { findMany: vi.fn() },
  },
  settings: {} as Record<string, string>,
}));

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async (key: string) => settings[key] ?? '') }));

import {
  buildRecipientContext, formatNok, formatOsloDate, formatRecipientContext, loadRecipientHistory,
  getAiContextSettings, HISTORY_LIMIT,
} from '@/lib/ai/history';

// 23:30 UTC 11. des = 00:30 Oslo 12. des — datoen skal følge Oslo, ikke UTC.
const JULEBORD = new Date('2025-12-11T23:30:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(settings)) delete settings[key];
  prisma.deal.findMany.mockResolvedValue([]);
  prisma.bookingRequest.findMany.mockResolvedValue([]);
  prisma.registration.findMany.mockResolvedValue([]);
});

describe('formatering', () => {
  it('formatOsloDate bruker Europe/Oslo og gir både lang og kort form', () => {
    expect(formatOsloDate(JULEBORD)).toBe('fredag 12. desember 2025 (12.12.2025)');
  });
  it('formatNok bruker vanlig mellomrom som tusenskille', () => {
    expect(formatNok(45000)).toBe('kr 45 000');
    expect(formatNok(1234567.4)).toBe('kr 1 234 567');
    expect(formatNok(500)).toBe('kr 500');
  });
});

describe('formatRecipientContext', () => {
  const history = {
    bookings: [{ eventType: 'julebord', eventDate: JULEBORD, participants: 20, value: 45000, status: 'won' }],
    courses: [{ name: 'Ponnikurs', year: 2024 }],
  };

  it('tar med historikk, men ikke verdi som standard', () => {
    const { contextText, factLines } = formatRecipientContext(
      { name: 'Kari', organizationName: 'Acme AS' }, history, { includeHistory: true, includeValue: false },
    );
    expect(contextText).toContain('Navn: Kari');
    expect(contextText).toContain('Organisasjon: Acme AS');
    expect(contextText).toContain('- julebord fredag 12. desember 2025 (12.12.2025): 20 gjester, gjennomført/bekreftet');
    expect(contextText).toContain('- Ponnikurs (2024)');
    expect(contextText).not.toContain('45');
    expect(factLines.join('\n')).toBe(contextText);
  });

  it('tar med verdi kun når innstillingen tillater det', () => {
    const { contextText } = formatRecipientContext(
      { name: 'Kari', organizationName: null }, history, { includeHistory: true, includeValue: true },
    );
    expect(contextText).toContain('verdi kr 45 000');
    expect(contextText).not.toContain('Organisasjon');
  });

  it('uten historikk-innstilling sendes kun navn og organisasjon', () => {
    const { contextText } = formatRecipientContext(
      { name: 'Kari', organizationName: 'Acme AS' }, history, { includeHistory: false, includeValue: true },
    );
    expect(contextText).toBe('Navn: Kari\nOrganisasjon: Acme AS');
  });

  it('håndterer manglende type/dato/deltakere og 1 gjest', () => {
    const { contextText } = formatRecipientContext(
      { name: 'Kari', organizationName: null },
      { bookings: [
        { eventType: null, eventDate: null, participants: 1, value: null, status: 'open' },
        { eventType: 'afterwork', eventDate: null, participants: null, value: null, status: 'won' },
      ], courses: [] },
      { includeHistory: true, includeValue: true },
    );
    expect(contextText).toContain('- arrangement: 1 gjest, under planlegging');
    expect(contextText).toContain('- afterwork: gjennomført/bekreftet');
  });
});

describe('getAiContextSettings', () => {
  it('historikk på og verdi av som standard (tomme innstillinger)', async () => {
    expect(await getAiContextSettings()).toEqual({ includeHistory: true, includeValue: false });
  });
  it('respekterer eksplisitte verdier', async () => {
    settings.ai_context_include_history = 'false';
    settings.ai_context_include_value = 'true';
    expect(await getAiContextSettings()).toEqual({ includeHistory: false, includeValue: true });
  });
});

describe('loadRecipientHistory', () => {
  it('henter kun kontaktens egne, ikke-tapte deals (maks HISTORY_LIMIT) og kobler deltakere via bookingRequestId', async () => {
    prisma.deal.findMany.mockResolvedValue([
      { eventType: 'julebord', eventDate: JULEBORD, value: 45000, status: 'won', bookingRequestId: 9 },
      { eventType: 'firmafest', eventDate: null, value: null, status: 'open', bookingRequestId: null },
    ]);
    prisma.bookingRequest.findMany.mockResolvedValue([{ id: 9, participants: 20 }]);

    const history = await loadRecipientHistory({ id: 3, parentId: null });

    const dealQuery = prisma.deal.findMany.mock.calls[0][0];
    expect(dealQuery.where).toEqual({ contactId: 3, status: { not: 'lost' } });
    expect(dealQuery.take).toBe(HISTORY_LIMIT);
    expect(prisma.bookingRequest.findMany.mock.calls[0][0].where).toEqual({ id: { in: [9] } });
    expect(history.bookings.map((b) => b.participants)).toEqual([20, null]);
    expect(prisma.registration.findMany).not.toHaveBeenCalled();
    expect(history.courses).toEqual([]);
  });

  it('henter kurspåmeldinger via kontaktens foresatt-kobling med år i Oslo-tid', async () => {
    prisma.registration.findMany.mockResolvedValue([
      { createdAt: new Date('2024-03-01T10:00:00Z'), course: { name: 'Ponnikurs', startDate: new Date('2024-12-31T23:30:00Z') } },
      { createdAt: new Date('2023-03-01T10:00:00Z'), course: { name: 'Sommerleir', startDate: null } },
    ]);

    const history = await loadRecipientHistory({ id: 3, parentId: 11 });

    const regQuery = prisma.registration.findMany.mock.calls[0][0];
    expect(regQuery.where).toEqual({ parentId: 11, status: { not: 'cancelled' } });
    expect(regQuery.take).toBe(HISTORY_LIMIT);
    expect(history.courses).toEqual([{ name: 'Ponnikurs', year: 2025 }, { name: 'Sommerleir', year: 2023 }]);
    expect(prisma.bookingRequest.findMany).not.toHaveBeenCalled();
  });
});

describe('buildRecipientContext', () => {
  it('null for ukjent kontakt', async () => {
    prisma.contact.findUnique.mockResolvedValue(null);
    expect(await buildRecipientContext(99)).toBeNull();
  });

  it('henter ikke historikk i det hele tatt når innstillingen er av (dataminimering)', async () => {
    settings.ai_context_include_history = 'false';
    prisma.contact.findUnique.mockResolvedValue({ id: 3, name: 'Kari', parentId: 11, organization: { name: 'Acme AS' } });
    const ctx = await buildRecipientContext(3);
    expect(ctx?.contextText).toBe('Navn: Kari\nOrganisasjon: Acme AS');
    expect(prisma.deal.findMany).not.toHaveBeenCalled();
    expect(prisma.registration.findMany).not.toHaveBeenCalled();
  });

  it('sender aldri e-post, telefon eller tagger til modellen', async () => {
    prisma.contact.findUnique.mockResolvedValue({ id: 3, name: 'Kari', parentId: null, organization: null });
    await buildRecipientContext(3);
    const select = prisma.contact.findUnique.mock.calls[0][0].select;
    expect(Object.keys(select).sort()).toEqual(['id', 'name', 'organization', 'parentId']);
  });
});
