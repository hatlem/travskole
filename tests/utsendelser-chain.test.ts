/** «Start etter»: neste gruppe starter av seg selv når den forrige har fått e-post 1. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, getUtsendelser, loadAudience, sendGroup } = vi.hoisted(() => ({
  prisma: {
    flow: { findMany: vi.fn() },
    flowEnrollment: { findMany: vi.fn() },
    messageSend: { groupBy: vi.fn() },
  },
  getUtsendelser: vi.fn(),
  loadAudience: vi.fn(),
  sendGroup: vi.fn(async () => ({ sent: 611 })),
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/utsendelser/config', async (orig) => ({ ...(await orig<object>()), getUtsendelser }));
vi.mock('@/lib/utsendelser/audience', () => ({ loadAudience }));
vi.mock('@/lib/utsendelser/actions', () => ({ sendGroup }));

import { readyToStart, resetChainThrottle, startChainedGroups } from '@/lib/utsendelser/chain';
import { startOrderCycle, type Utsendelse } from '@/lib/utsendelser/config';

const U: Utsendelse = {
  id: 'juletrav-2026',
  navn: 'Juletrav 2026',
  flyter: [{ flowId: 22, navn: 'Til personer' }],
  grupper: [
    { id: 'prio-1', navn: 'Prioritet 1', segmentId: 1, flowId: 22 },
    { id: 'prio-2', navn: 'Prioritet 2', segmentId: 2, flowId: 22, startEtter: 'prio-1' },
  ],
};

const audience = new Map([
  ['prio-1', { ids: [1, 2], reachable: new Set([1, 2]), excluded: [], movedIn: new Set() }],
  ['prio-2', { ids: [3, 4], reachable: new Set([3, 4]), excluded: [], movedIn: new Set() }],
]);

/** prio-1: begge startet; `sentTo` har fått e-post 1. prio-2: ingen startet. */
function setup(sentTo: number[]) {
  prisma.flowEnrollment.findMany.mockImplementation(async ({ where }: { where: { contactId: { in: number[] } } }) =>
    where.contactId.in.includes(1) ? [{ id: 11, contactId: 1, status: 'active' }, { id: 12, contactId: 2, status: 'active' }] : [],
  );
  prisma.messageSend.groupBy.mockResolvedValue(sentTo.map((c) => ({ enrollmentId: c + 10 })));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetChainThrottle();
  getUtsendelser.mockResolvedValue([U]);
  loadAudience.mockResolvedValue(audience);
  prisma.flow.findMany.mockResolvedValue([{ status: 'active' }]);
});

describe('readyToStart', () => {
  it('starter når forrige er ferdig og denne ikke er startet', () => {
    expect(readyToStart({ enrolled: 447, waiting: 0, pending: 0 }, { enrolled: 0, waiting: 0, pending: 611 })).toBe(true);
  });
  it('venter mens noen i forrige står i kø', () => {
    expect(readyToStart({ enrolled: 447, waiting: 420, pending: 0 }, { enrolled: 0, waiting: 0, pending: 611 })).toBe(false);
  });
  it('forrige ikke startet, eller denne alt startet: ingenting', () => {
    expect(readyToStart({ enrolled: 0, waiting: 0, pending: 447 }, { enrolled: 0, waiting: 0, pending: 611 })).toBe(false);
    expect(readyToStart({ enrolled: 447, waiting: 0, pending: 0 }, { enrolled: 5, waiting: 0, pending: 606 })).toBe(false);
  });
});

describe('startChainedGroups', () => {
  it('starter prio-2 når alle i prio-1 har fått e-post 1', async () => {
    setup([1, 2]);
    expect(await startChainedGroups()).toEqual({ started: ['juletrav-2026/prio-2'] });
    expect(sendGroup).toHaveBeenCalledWith(U, 'prio-2');
  });

  it('venter så lenge noen i prio-1 står i kø', async () => {
    setup([1]);
    expect(await startChainedGroups()).toEqual({ started: [] });
    expect(sendGroup).not.toHaveBeenCalled();
  });

  it('starter ingenting mens utsendelsen står på pause', async () => {
    setup([1, 2]);
    prisma.flow.findMany.mockResolvedValue([{ status: 'paused' }]);
    await startChainedGroups();
    expect(sendGroup).not.toHaveBeenCalled();
  });

  it('sjekker høyst hvert femte minutt', async () => {
    setup([1, 2]);
    await startChainedGroups(1_000_000);
    await startChainedGroups(1_000_000 + 60_000);
    expect(sendGroup).toHaveBeenCalledTimes(1);
  });
});

describe('startOrderCycle', () => {
  it('finner ringer og selvreferanser', () => {
    expect(startOrderCycle([{ id: 'a', startEtter: 'b' }, { id: 'b', startEtter: 'a' }])).toBe(true);
    expect(startOrderCycle([{ id: 'a', startEtter: 'a' }])).toBe(true);
    expect(startOrderCycle([{ id: 'a' }, { id: 'b', startEtter: 'a' }, { id: 'c', startEtter: 'b' }])).toBe(false);
  });
});
