/** Når én i en bedrift svarer, tas kollegene ut av utsendelsen. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, exitActiveEnrollments, loadAudience, getUtsendelser } = vi.hoisted(() => ({
  prisma: {
    contact: { findUnique: vi.fn(), findMany: vi.fn() },
    flowEnrollment: { findMany: vi.fn() },
    utsendelseRecipient: { findMany: vi.fn(), upsert: vi.fn(async () => ({})) },
  },
  exitActiveEnrollments: vi.fn(async () => 2),
  loadAudience: vi.fn(),
  getUtsendelser: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/flows/exit', () => ({ exitActiveEnrollments }));
vi.mock('@/lib/utsendelser/audience', () => ({ loadAudience }));
vi.mock('@/lib/utsendelser/config', () => ({ getUtsendelser }));

import { stopColleagues, stopColleaguesAfterReply } from '@/lib/utsendelser/colleagues';
import type { Utsendelse } from '@/lib/utsendelser/config';

const U: Utsendelse = {
  id: 'juletrav-2026',
  navn: 'Juletrav 2026',
  flyter: [{ flowId: 22, navn: 'Personer' }, { flowId: 23, navn: 'Funksjonsadresser' }],
  grupper: [{ id: 'prio-1', navn: 'Prioritet 1', segmentId: 2, flowId: 22 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  prisma.contact.findUnique.mockResolvedValue({ organizationId: 7 });
  // 670 og 669 er med (påmeldt/i gruppen), 671 er tatt ut fra før, 999 er ikke med i utsendelsen.
  prisma.contact.findMany.mockResolvedValue([{ id: 670 }, { id: 669 }, { id: 671 }, { id: 999 }]);
  prisma.flowEnrollment.findMany.mockResolvedValue([{ contactId: 668 }, { contactId: 670 }, { contactId: 671 }]);
  prisma.utsendelseRecipient.findMany.mockResolvedValue([{ contactId: 671 }]);
  loadAudience.mockResolvedValue(new Map([['prio-1', { ids: [668, 669, 670], reachable: new Set(), excluded: [], movedIn: new Set() }]]));
  getUtsendelser.mockResolvedValue([U]);
});

describe('stopColleagues', () => {
  it('tar ut kollegene som er med i utsendelsen, ikke de som er ute fra før eller ikke er med', async () => {
    expect(await stopColleagues(U, 668)).toEqual({ excluded: [670, 669] });
    expect(prisma.contact.findMany).toHaveBeenCalledWith({ where: { organizationId: 7, id: { not: 668 } }, select: { id: true } });
    expect(prisma.utsendelseRecipient.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.utsendelseRecipient.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { utsendelseId: 'juletrav-2026', contactId: 670, excluded: true, updatedBy: 'Kollega svarte (kontakt 668)' },
    }));
    expect(exitActiveEnrollments).toHaveBeenCalledWith({ flowId: { in: [22, 23] }, contactId: { in: [670, 669] } });
  });

  it('uten bedrift: ingen kolleger', async () => {
    prisma.contact.findUnique.mockResolvedValue({ organizationId: null });
    expect(await stopColleagues(U, 668)).toEqual({ excluded: [] });
    expect(prisma.utsendelseRecipient.upsert).not.toHaveBeenCalled();
    expect(exitActiveEnrollments).not.toHaveBeenCalled();
  });

  it('ingen kolleger igjen: ingenting skjer', async () => {
    prisma.contact.findMany.mockResolvedValue([{ id: 671 }]);
    expect(await stopColleagues(U, 668)).toEqual({ excluded: [] });
    expect(exitActiveEnrollments).not.toHaveBeenCalled();
  });
});

describe('stopColleaguesAfterReply', () => {
  it('finner utsendelsen fra flyten', async () => {
    await stopColleaguesAfterReply(23, 668);
    expect(exitActiveEnrollments).toHaveBeenCalled();
  });

  it('flyt utenfor utsendelser: ingenting skjer', async () => {
    await stopColleaguesAfterReply(99, 668);
    expect(prisma.contact.findUnique).not.toHaveBeenCalled();
  });

  it('en feil stopper aldri svaret', async () => {
    prisma.contact.findUnique.mockRejectedValue(new Error('db nede'));
    await expect(stopColleaguesAfterReply(22, 668)).resolves.toBeUndefined();
  });
});
