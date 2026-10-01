/**
 * Runner-wiring for sendetider (mocket Prisma og send-lag): riktig vindu per
 * flyt (global / egne / når som helst), parkering PÅ e-post-noden uten å gå
 * videre, gjenopptak når vinduet åpner, og at andre noder kjører som før.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({ $queryRaw: vi.fn(async () => [{ id: 1 }]), flowEnrollment: { updateMany: vi.fn() } }),
    ),
    flowEnrollment: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    flowNode: { findMany: vi.fn() },
    flowEdge: { findMany: vi.fn() },
    segment: { findMany: vi.fn(async () => []) },
    contact: { findUnique: vi.fn(), update: vi.fn() },
    registration: { findUnique: vi.fn() },
    setting: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/flows/send', () => ({ sendFlowEmail: vi.fn() }));
vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/mail', () => ({ sendAdminEmail: vi.fn() }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn() }));

import { runFlowBatch } from '@/lib/flows/runner';
import { sendFlowEmail } from '@/lib/flows/send';
import { DEFAULT_SEND_WINDOW, type SendWindow } from '@/lib/flows/send-window';

const mockedSend = vi.mocked(sendFlowEmail);
const NIGHT = new Date('2026-10-01T23:30:00Z');
const MORNING = new Date('2026-10-02T06:04:00Z');

// 10=start, 11=action(add_tag), 12=email, 13=wait(1 dag), 14=end
const NODES = [
  { id: 10, flowId: 5, type: 'start', config: '{}' },
  { id: 11, flowId: 5, type: 'action', config: JSON.stringify({ kind: 'add_tag', value: 'natt' }) },
  { id: 12, flowId: 5, type: 'email', config: JSON.stringify({ subject: 'S', bodyHtml: '<p>B</p>', senderIdentityId: 4 }) },
  { id: 13, flowId: 5, type: 'wait', config: JSON.stringify({ days: 1 }) },
  { id: 14, flowId: 5, type: 'end', config: '{}' },
];
const EDGES = [
  { id: 1, flowId: 5, fromNodeId: 10, toNodeId: 11, branch: null },
  { id: 2, flowId: 5, fromNodeId: 11, toNodeId: 12, branch: null },
  { id: 3, flowId: 5, fromNodeId: 12, toNodeId: 13, branch: null },
  { id: 4, flowId: 5, fromNodeId: 13, toNodeId: 14, branch: null },
];

function enrollment(over: Record<string, unknown> = {}) {
  return { id: 1, flowId: 5, contactId: 7, currentNodeId: null, registrationId: null, flow: { status: 'active', isMarketing: true }, ...over };
}

function settings(rows: Record<string, string>) {
  prisma.setting.findMany.mockResolvedValue(Object.entries(rows).map(([key, value]) => ({ key, value })));
}

function windowPassedToSend(): SendWindow | null | undefined {
  return mockedSend.mock.calls[0][0].sendWindow;
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.flowNode.findMany.mockResolvedValue(NODES);
  prisma.flowEdge.findMany.mockResolvedValue(EDGES);
  prisma.contact.findUnique.mockResolvedValue({
    id: 7, name: 'Kari', email: 'k@example.invalid', stage: 'lead', source: 'manual',
    organizationId: null, lastActivityAt: null, tags: '[]', deals: [],
  });
  prisma.flowEnrollment.findMany.mockResolvedValue([enrollment()]);
  settings({});
  mockedSend.mockResolvedValue('sent');
});

describe('runFlowBatch: effektivt sendevindu per flyt', () => {
  it('uten innstillinger brukes standarden 08–20 alle dager', async () => {
    await runFlowBatch(NIGHT);
    expect(windowPassedToSend()).toEqual(DEFAULT_SEND_WINDOW);
  });

  it('globalt avslått ⇒ når som helst', async () => {
    settings({ send_window_enabled: 'false' });
    await runFlowBatch(NIGHT);
    expect(windowPassedToSend()).toBeNull();
  });

  it('globalt egendefinert vindu brukes', async () => {
    settings({ send_window: '09:00-17:00 man,tir,ons,tor,fre' });
    await runFlowBatch(NIGHT);
    expect(windowPassedToSend()).toMatchObject({ startHour: 9, endHour: 17, days: ['man', 'tir', 'ons', 'tor', 'fre'] });
  });

  it('flytens egne tider vinner over den globale', async () => {
    settings({ send_window: '09:00-17:00 man', flow_send_window_5: '10:00-14:00 lør,søn', flow_send_window_6: 'anytime' });
    await runFlowBatch(NIGHT);
    expect(windowPassedToSend()).toMatchObject({ startHour: 10, endHour: 14, days: ['lør', 'søn'] });
  });

  it('«når som helst» på flyten gjelder selv om standarden er på', async () => {
    settings({ flow_send_window_5: 'anytime' });
    await runFlowBatch(NIGHT);
    expect(windowPassedToSend()).toBeNull();
  });

  it('feiler lesingen, brukes standardvinduet (heller vente enn å sende om natten)', async () => {
    prisma.setting.findMany.mockRejectedValue(new Error('db nede'));
    await runFlowBatch(NIGHT);
    expect(windowPassedToSend()).toEqual(DEFAULT_SEND_WINDOW);
  });

  it('leser sendetidene én gang per batch', async () => {
    prisma.flowEnrollment.findMany.mockResolvedValue([enrollment(), enrollment({ id: 2, contactId: 8 })]);
    await runFlowBatch(NIGHT);
    expect(prisma.setting.findMany).toHaveBeenCalledTimes(1);
    expect(mockedSend).toHaveBeenCalledTimes(2);
  });
});

describe('runFlowBatch: parkering og gjenopptak', () => {
  it('utenfor vinduet: handlingsnoden kjører, e-posten parkeres PÅ e-post-noden til åpning', async () => {
    mockedSend.mockResolvedValue({ kind: 'outside_window', resumeAt: MORNING });
    const result = await runFlowBatch(NIGHT);

    expect(prisma.contact.update).toHaveBeenCalledTimes(1); // add_tag kjørte som normalt
    expect(prisma.flowEnrollment.update).toHaveBeenCalledTimes(1);
    expect(prisma.flowEnrollment.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { currentNodeId: 12, nextRunAt: MORNING },
    });
    expect(result).toEqual({ processed: 1, sent: 0, failed: 0, completed: 0 });
  });

  it('gjenopptak: står på e-post-noden, vinduet er åpent ⇒ sender og går videre til vent-noden', async () => {
    prisma.flowEnrollment.findMany.mockResolvedValue([enrollment({ currentNodeId: 12 })]);
    const result = await runFlowBatch(MORNING);

    expect(mockedSend).toHaveBeenCalledWith(expect.objectContaining({ enrollmentId: 1, nodeId: 12, now: MORNING }));
    expect(prisma.contact.update).not.toHaveBeenCalled(); // handlingen kjøres ikke på nytt
    expect(prisma.flowEnrollment.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { currentNodeId: 14, nextRunAt: new Date(MORNING.getTime() + 86_400_000) },
    });
    expect(result.sent).toBe(1);
  });

  it('allerede sendt (dedupe) ved gjenopptak ⇒ ingen dobbel sending, flyten går videre', async () => {
    prisma.flowEnrollment.findMany.mockResolvedValue([enrollment({ currentNodeId: 12 })]);
    mockedSend.mockResolvedValue('already_sent');
    const result = await runFlowBatch(MORNING);
    expect(result.sent).toBe(0);
    expect(prisma.flowEnrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currentNodeId: 14 }) }),
    );
  });

  it('vent-noder følger ikke sendetiden — de sover som før', async () => {
    prisma.flowEnrollment.findMany.mockResolvedValue([enrollment({ currentNodeId: 13 })]);
    await runFlowBatch(NIGHT);
    expect(mockedSend).not.toHaveBeenCalled();
    expect(prisma.flowEnrollment.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { currentNodeId: 14, nextRunAt: new Date(NIGHT.getTime() + 86_400_000) },
    });
  });
});
