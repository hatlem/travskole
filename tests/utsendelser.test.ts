/** Utsendelser: e-postrekkefølge, oppsett, sending uten dobbeltutsending, pause og redigering. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { prisma, enroll } = vi.hoisted(() => ({
  prisma: {
    flow: { findUnique: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    flowNode: { findUnique: vi.fn(), update: vi.fn() },
    flowEnrollment: { findMany: vi.fn() },
    setting: { findUnique: vi.fn(), upsert: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    segment: { findMany: vi.fn() },
    contactList: { findMany: vi.fn(async () => []) },
  },
  enroll: {
    enrollContacts: vi.fn(),
    activateDraftFlow: vi.fn(),
    loadAudience: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/flows/enroll', () => ({
  enrollContacts: enroll.enrollContacts,
  SEGMENT_ENROLL_CAP: 500,
}));
vi.mock('@/lib/utsendelser/audience', () => ({ loadAudience: enroll.loadAudience }));
vi.mock('@/lib/flows/activation', () => ({ activateDraftFlow: enroll.activateDraftFlow }));
const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireAdmin }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));

import { emailSteps, stepTimingLabel } from '@/lib/utsendelser/steps';
import { parseUtsendelser, type Utsendelse } from '@/lib/utsendelser/config';
import { sendGroup, setPaused, updateEmailStep, UtsendelseError } from '@/lib/utsendelser/actions';
import { utsendelseStatus } from '@/lib/utsendelser/overview';
import { POST as sendRoute } from '@/app/api/admin/utsendelser/[id]/send/route';

const UTSENDELSE: Utsendelse = {
  id: 'juletrav-2026',
  navn: 'Juletrav 2026',
  flyter: [{ flowId: 22, navn: 'Til personer' }],
  grupper: [{ id: 'prio-1', navn: 'Prioritet 1', segmentId: 2, flowId: 22 }],
};

const emailNode = (id: number, subject: string) => ({ id, type: 'email', config: { subject, bodyHtml: `<p>${subject}</p>` } });

const linearFlow = {
  nodes: [
    { id: 1, type: 'start', config: {} },
    emailNode(2, 'Første'),
    { id: 3, type: 'wait', config: { days: 7 } },
    emailNode(4, 'Andre'),
    { id: 5, type: 'wait', config: { days: 13 } },
    emailNode(6, 'Tredje'),
    { id: 7, type: 'end', config: {} },
  ],
  edges: [[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7]].map(([fromNodeId, toNodeId]) => ({ fromNodeId, toNodeId })),
};

const audienceOf = (ids: number[], reachable: number[] = ids) =>
  new Map([['prio-1', { ids, reachable: new Set(reachable) }]]);

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ user: { email: 'hilde@bjerke.no', role: 'admin' } });
  prisma.setting.create.mockResolvedValue({});
  prisma.setting.deleteMany.mockResolvedValue({ count: 1 });
});

describe('emailSteps', () => {
  it('følger flyten fra start og regner ventetid mellom e-postene', () => {
    const steps = emailSteps(linearFlow.nodes, linearFlow.edges);
    expect(steps.map((s) => [s.number, s.subject, s.hoursAfterPrevious])).toEqual([
      [1, 'Første', 0],
      [2, 'Andre', 168],
      [3, 'Tredje', 312],
    ]);
    expect(steps.map(stepTimingLabel)).toEqual(['Når du trykker Send', 'Én uke etter e-post 1', '13 dager etter e-post 2']);
  });

  it('forgrenet flyt: resten av e-postene listes etter plassering uten ventetid', () => {
    const nodes = [{ id: 1, type: 'start', config: {} }, { id: 2, type: 'condition', config: {} }, { ...emailNode(4, 'B'), posY: 300 }, { ...emailNode(3, 'A'), posY: 200 }];
    const steps = emailSteps(nodes, [{ fromNodeId: 1, toNodeId: 2 }, { fromNodeId: 2, toNodeId: 3 }, { fromNodeId: 2, toNodeId: 4 }]);
    expect(steps.map((s) => [s.subject, s.hoursAfterPrevious])).toEqual([['A', null], ['B', null]]);
  });
});

describe('parseUtsendelser', () => {
  it('hopper over ugyldige oppføringer og tåler søppel', () => {
    const bad = { ...UTSENDELSE, id: 'annen', grupper: [{ id: 'x', navn: 'X', segmentId: 1, flowId: 99 }] };
    expect(parseUtsendelser(JSON.stringify([UTSENDELSE, bad])).map((u) => u.id)).toEqual(['juletrav-2026']);
    expect(parseUtsendelser('ikke json')).toEqual([]);
    expect(parseUtsendelser(null)).toEqual([]);
  });
});

describe('utsendelseStatus', () => {
  it('pause vinner, ellers etter hvor mye som er sendt', () => {
    expect(utsendelseStatus(['paused'], { sent: 0, remaining: 5 })).toBe('pause');
    expect(utsendelseStatus(['draft'], { sent: 0, remaining: 5 })).toBe('ikke_startet');
    expect(utsendelseStatus(['active'], { sent: 3, remaining: 2 })).toBe('sender');
    expect(utsendelseStatus(['active'], { sent: 5, remaining: 0 })).toBe('ferdig');
  });
});

describe('sendGroup', () => {
  const summary = (enrolled: number) => ({ enrolled, skippedActive: 0, skippedSuppressed: 0, skippedNoConsent: 0, skippedMissing: 0, capped: 0 });

  it('aktiverer utkastet og sender bare til dem som aldri har vært med (også ferdige hoppes over)', async () => {
    enroll.loadAudience.mockResolvedValue(audienceOf([1, 2, 3, 4]));
    prisma.flow.findUnique.mockResolvedValueOnce({
      id: 22,
      status: 'draft',
      nodes: linearFlow.nodes.map((n) => ({ ...n, config: JSON.stringify({ ...n.config, ...(n.type === 'email' && { senderIdentityId: 2 }) }) })),
      edges: linearFlow.edges.map((e, i) => ({ id: i + 1, ...e, branch: null })),
    });
    prisma.flow.findUnique.mockResolvedValue({ status: 'active' });
    prisma.flowEnrollment.findMany.mockResolvedValue([{ contactId: 2 }, { contactId: 4 }]);
    enroll.enrollContacts.mockResolvedValue(summary(2));

    const result = await sendGroup(UTSENDELSE, 'prio-1');

    expect(enroll.activateDraftFlow).toHaveBeenCalledWith(22);
    expect(prisma.flowEnrollment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { flowId: 22, contactId: { in: [1, 2, 3, 4] } } }));
    expect(enroll.enrollContacts).toHaveBeenCalledWith(22, [1, 3]);
    expect(result).toEqual({ sent: 2, alreadySent: 2, skippedSuppressed: 0, skippedNoConsent: 0, skippedMissing: 0 });
  });

  it('deler opp i biter på 500, så store grupper går i én operasjon', async () => {
    const ids = Array.from({ length: 1218 }, (_, i) => i + 1);
    enroll.loadAudience.mockResolvedValue(audienceOf(ids));
    prisma.flow.findUnique.mockResolvedValue({ id: 22, status: 'active', nodes: [], edges: [] });
    prisma.flowEnrollment.findMany.mockResolvedValue([]);
    enroll.enrollContacts.mockImplementation(async (_flowId: number, chunk: number[]) => summary(chunk.length));

    const result = await sendGroup(UTSENDELSE, 'prio-1');

    expect(enroll.enrollContacts.mock.calls.map((c) => c[1].length)).toEqual([500, 500, 218]);
    expect(result.sent).toBe(1218);
    expect(enroll.activateDraftFlow).not.toHaveBeenCalled();
  });

  it('nekter å sende mens e-posten har eksempeltekst', async () => {
    prisma.flow.findUnique.mockResolvedValue({
      id: 22,
      status: 'draft',
      nodes: [
        { id: 1, type: 'start', config: '{}' },
        { id: 2, type: 'email', config: JSON.stringify({ subject: 'Skriv emnet her', bodyHtml: '<p>Hei</p>', senderIdentityId: 2 }) },
        { id: 3, type: 'end', config: '{}' },
      ],
      edges: [{ id: 1, fromNodeId: 1, toNodeId: 2, branch: null }, { id: 2, fromNodeId: 2, toNodeId: 3, branch: null }],
    });
    await expect(sendGroup(UTSENDELSE, 'prio-1')).rejects.toThrow(/eksempeltekst/);
    expect(enroll.activateDraftFlow).not.toHaveBeenCalled();
  });

  it('nekter å sende mens utsendelsen står på pause', async () => {
    prisma.flow.findUnique.mockResolvedValue({ id: 22, status: 'paused', nodes: [], edges: [] });
    await expect(sendGroup(UTSENDELSE, 'prio-1')).rejects.toThrow(UtsendelseError);
    expect(enroll.enrollContacts).not.toHaveBeenCalled();
  });

  it('sender ikke til dem uten adresse eller som har meldt seg av, og teller dem som hoppet over', async () => {
    enroll.loadAudience.mockResolvedValue(audienceOf([1, 2, 3], [1, 3]));
    prisma.flow.findUnique.mockResolvedValue({ id: 22, status: 'active', nodes: [], edges: [] });
    prisma.flowEnrollment.findMany.mockResolvedValue([]);
    enroll.enrollContacts.mockResolvedValue(summary(2));

    const result = await sendGroup(UTSENDELSE, 'prio-1');

    expect(enroll.enrollContacts).toHaveBeenCalledWith(22, [1, 3]);
    expect(result).toMatchObject({ sent: 2, skippedMissing: 1 });
  });

  it('to samtidige trykk: den andre får beskjed og melder ingen inn', async () => {
    prisma.flow.findUnique.mockResolvedValue({ id: 22, status: 'active', nodes: [], edges: [] });
    const { Prisma } = await import('@prisma/client');
    prisma.setting.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
    prisma.setting.updateMany.mockResolvedValue({ count: 0 });

    await expect(sendGroup(UTSENDELSE, 'prio-1')).rejects.toThrow(/pågår allerede/);
    expect(enroll.enrollContacts).not.toHaveBeenCalled();
    expect(prisma.setting.deleteMany).not.toHaveBeenCalled();
  });

  it('slipper låsen også når sendingen feiler', async () => {
    prisma.flow.findUnique.mockResolvedValue({ id: 22, status: 'active', nodes: [], edges: [] });
    enroll.loadAudience.mockResolvedValue(audienceOf([1]));
    prisma.flowEnrollment.findMany.mockRejectedValue(new Error('db nede'));
    await expect(sendGroup(UTSENDELSE, 'prio-1')).rejects.toThrow('db nede');
    expect(prisma.setting.deleteMany).toHaveBeenCalledWith({ where: { key: 'utsendelse_sender_22' } });
  });

  it('arkivert eller pauset mens vi ventet på låsen: melder ingen inn', async () => {
    prisma.flow.findUnique
      .mockResolvedValueOnce({ id: 22, status: 'active', nodes: [], edges: [] })
      .mockResolvedValueOnce({ status: 'archived' });
    await expect(sendGroup(UTSENDELSE, 'prio-1')).rejects.toThrow(/pause eller arkivert/);
    expect(enroll.enrollContacts).not.toHaveBeenCalled();
    expect(prisma.setting.deleteMany).toHaveBeenCalled();
  });

  it('ukjent gruppe gir 404', async () => {
    await expect(sendGroup(UTSENDELSE, 'finnes-ikke')).rejects.toMatchObject({ status: 404 });
  });
});

describe('setPaused', () => {
  it('setter bare aktive flyter på pause, og bare pausede tilbake', async () => {
    prisma.flow.updateMany.mockResolvedValue({ count: 1 });
    await setPaused(UTSENDELSE, true);
    expect(prisma.flow.updateMany).toHaveBeenLastCalledWith({ where: { id: { in: [22] }, status: 'active' }, data: { status: 'paused' } });
    await setPaused(UTSENDELSE, false);
    expect(prisma.flow.updateMany).toHaveBeenLastCalledWith({ where: { id: { in: [22] }, status: 'paused' }, data: { status: 'active' } });
  });
});

describe('updateEmailStep', () => {
  it('endrer emne og tekst også i en aktiv flyt, og beholder avsender', async () => {
    prisma.flowNode.findUnique.mockResolvedValue({
      id: 4, flowId: 22, type: 'email', flow: { status: 'active' },
      config: JSON.stringify({ subject: 'Gammel', bodyHtml: '<p>Gammel</p>', senderIdentityId: 2 }),
    });
    await updateEmailStep(UTSENDELSE, { flowId: 22, nodeId: 4, subject: ' Ny ', bodyHtml: '<p>Ny tekst</p><script>x</script>' });
    const saved = JSON.parse(prisma.flowNode.update.mock.calls[0][0].data.config);
    expect(saved).toMatchObject({ subject: 'Ny', senderIdentityId: 2 });
    expect(saved.bodyHtml).toContain('Ny tekst');
    expect(saved.bodyHtml).not.toContain('<script');
  });

  it('nekter tom tekst (også tomt avsnitt fra editoren)', async () => {
    prisma.flowNode.findUnique.mockResolvedValue({
      id: 4, flowId: 22, type: 'email', flow: { status: 'active' },
      config: JSON.stringify({ subject: 'Gammel', bodyHtml: '<p>Gammel</p>', senderIdentityId: 2 }),
    });
    await expect(updateEmailStep(UTSENDELSE, { flowId: 22, nodeId: 4, subject: 'Hei', bodyHtml: '<p></p>' })).rejects.toMatchObject({ status: 400 });
    expect(prisma.flowNode.update).not.toHaveBeenCalled();
  });

  it('nekter e-post fra en annen flyt', async () => {
    prisma.flowNode.findUnique.mockResolvedValue({ id: 9, flowId: 99, type: 'email', flow: { status: 'active' }, config: '{}' });
    await expect(updateEmailStep(UTSENDELSE, { flowId: 22, nodeId: 9, subject: 'x', bodyHtml: '<p>x</p>' })).rejects.toMatchObject({ status: 404 });
    expect(prisma.flowNode.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/utsendelser/[id]/send', () => {
  const call = () =>
    sendRoute(
      new NextRequest('http://localhost/api/admin/utsendelser/juletrav-2026/send', {
        method: 'POST',
        body: JSON.stringify({ gruppeId: 'prio-1' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'juletrav-2026' }) },
    );

  it('krever innlogget ansatt', async () => {
    requireAdmin.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(enroll.enrollContacts).not.toHaveBeenCalled();
  });

  it('ukjent utsendelse gir 404', async () => {
    prisma.setting.findUnique.mockResolvedValue({ value: '[]' });
    expect((await call()).status).toBe(404);
  });
});

describe('POST /api/admin/utsendelser (lagre oppsett)', async () => {
  const { POST: saveRoute } = await import('@/app/api/admin/utsendelser/route');
  const save = (body: unknown) =>
    saveRoute(new NextRequest('http://localhost/api/admin/utsendelser', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));
  const flow = (over: Record<string, unknown> = {}) => ({ id: 22, name: 'Juletrav', status: 'draft', anchorMode: 'contact', isMarketing: true, _count: { triggers: 0 }, ...over });

  beforeEach(() => {
    prisma.segment.findMany.mockResolvedValue([{ id: 2 }]);
    prisma.setting.findUnique.mockResolvedValue({ value: '[]' });
  });

  it('lagrer en gyldig utsendelse', async () => {
    prisma.flow.findMany.mockResolvedValue([flow()]);
    expect((await save(UTSENDELSE)).status).toBe(200);
    expect(prisma.setting.upsert).toHaveBeenCalled();
  });

  it('avviser flyt med startregel, så ingen meldes inn på nytt utenom utsendelsen', async () => {
    prisma.flow.findMany.mockResolvedValue([flow({ _count: { triggers: 1 } })]);
    const res = await save(UTSENDELSE);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('startregel');
    expect(prisma.setting.upsert).not.toHaveBeenCalled();
  });

  it('avviser flyter som ikke er markedsføring', async () => {
    prisma.flow.findMany.mockResolvedValue([flow({ isMarketing: false })]);
    expect((await save(UTSENDELSE)).status).toBe(400);
  });

  it('avviser en flyt som allerede hører til en annen utsendelse', async () => {
    prisma.flow.findMany.mockResolvedValue([flow()]);
    prisma.setting.findUnique.mockResolvedValue({ value: JSON.stringify([{ ...UTSENDELSE, id: 'annen', navn: 'Annen' }]) });
    const res = await save(UTSENDELSE);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Annen');
  });

  it('krever innlogget ansatt', async () => {
    requireAdmin.mockResolvedValue(null);
    expect((await save(UTSENDELSE)).status).toBe(401);
  });
});
