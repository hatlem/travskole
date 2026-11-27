/** «Skulle gått til en annen adresse»: utsendelsen sendes dit, i samme gruppe som den som svarte. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, getUtsendelser, loadAudience, sendOne, moveRecipient } = vi.hoisted(() => ({
  prisma: {
    inboundReply: { findUnique: vi.fn() },
    contact: { findUnique: vi.fn(), create: vi.fn(async () => ({ id: 900 })) },
    note: { create: vi.fn(async () => ({})) },
  },
  getUtsendelser: vi.fn(),
  loadAudience: vi.fn(),
  sendOne: vi.fn(async () => {}),
  moveRecipient: vi.fn(async () => {}),
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/utsendelser/config', () => ({ getUtsendelser }));
vi.mock('@/lib/utsendelser/audience', () => ({ loadAudience }));
vi.mock('@/lib/utsendelser/recipients', () => ({ moveRecipient }));
vi.mock('@/lib/utsendelser/actions', async () => {
  class UtsendelseError extends Error { constructor(message: string, readonly status = 409) { super(message); } }
  return { sendOne, UtsendelseError };
});

import { forwardToAddress, suggestedForwardEmail } from '@/lib/replies/forward';
import { UtsendelseError } from '@/lib/utsendelser/actions';

const U = {
  id: 'juletrav-2026',
  navn: 'Juletrav 2026',
  flyter: [{ flowId: 22, navn: 'Personer' }, { flowId: 23, navn: 'Funksjonsadresser' }],
  grupper: [
    { id: 'prio-1', navn: 'Prioritet 1', segmentId: 2, flowId: 22 },
    { id: 'prio-2', navn: 'Prioritet 2', segmentId: 3, flowId: 22 },
  ],
};
const reply = {
  id: 93, flowId: 22, fromEmail: 'presse@reg.oslo.kommune.no', contactId: 5,
  contact: { name: 'Jørgen', email: 'presse@reg.oslo.kommune.no', organizationId: 7, organization: { name: 'Oslo kommune' } },
};

beforeEach(() => {
  vi.clearAllMocks();
  prisma.inboundReply.findUnique.mockResolvedValue(reply);
  prisma.contact.findUnique.mockResolvedValue(null);
  getUtsendelser.mockResolvedValue([U]);
  loadAudience.mockResolvedValue(new Map([
    ['prio-1', { ids: [1, 2], excluded: [] }],
    ['prio-2', { ids: [5], excluded: [] }],
  ]));
});

describe('suggestedForwardEmail', () => {
  it('finner adressen i teksten, ikke avsenderens egen', () => {
    const body = 'Nei, denne skulle nok gått til postmottak@reg.oslo.kommune.no.\nHilsen presse@reg.oslo.kommune.no';
    expect(suggestedForwardEmail(body, ['presse@reg.oslo.kommune.no'])).toBe('postmottak@reg.oslo.kommune.no');
    expect(suggestedForwardEmail('Ingen adresse her', [])).toBeNull();
    expect(suggestedForwardEmail('Skriv til PRESSE@reg.oslo.kommune.no', ['presse@reg.oslo.kommune.no'])).toBeNull();
  });
});

describe('forwardToAddress', () => {
  it('legger adressen inn i samme bedrift og sender i samme gruppe som den som svarte', async () => {
    const result = await forwardToAddress(93, { email: ' Postmottak@reg.oslo.kommune.no ' }, 'hilde@bjerke.no');
    expect(result).toEqual({ contactId: 900, created: true, utsendelse: 'Juletrav 2026' });
    expect(prisma.contact.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: 'postmottak@reg.oslo.kommune.no', organizationId: 7, name: 'Oslo kommune' }),
    }));
    expect(moveRecipient).toHaveBeenCalledWith(U, 900, 'prio-2', 'hilde@bjerke.no');
    expect(sendOne).toHaveBeenCalledWith(U, 'prio-2', 900);
    expect(prisma.note.create).toHaveBeenCalled();
  });

  it('bruker en kontakt som finnes fra før', async () => {
    prisma.contact.findUnique.mockResolvedValue({ id: 44, source: 'import' });
    expect(await forwardToAddress(93, { email: 'postmottak@reg.oslo.kommune.no' }, 'h')).toMatchObject({ contactId: 44, created: false });
    expect(prisma.contact.create).not.toHaveBeenCalled();
  });

  it('avviser samme adresse som svarte', async () => {
    await expect(forwardToAddress(93, { email: 'presse@reg.oslo.kommune.no' }, 'h')).rejects.toThrow('samme adresse');
    expect(sendOne).not.toHaveBeenCalled();
  });

  it('avviser svar som ikke hører til en utsendelse', async () => {
    prisma.inboundReply.findUnique.mockResolvedValue({ ...reply, flowId: 99 });
    await expect(forwardToAddress(93, { email: 'a@b.no' }, 'h')).rejects.toThrow('ikke til en utsendelse');
  });

  it('gir utsendelsens feilmelding videre (f.eks. allerede sendt)', async () => {
    moveRecipient.mockRejectedValueOnce(new UtsendelseError('Personen har allerede fått e-post fra utsendelsen og kan ikke flyttes.'));
    await expect(forwardToAddress(93, { email: 'a@b.no' }, 'h')).rejects.toMatchObject({ message: expect.stringContaining('allerede'), status: 409 });
  });
});
