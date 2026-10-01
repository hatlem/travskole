import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    flowEnrollment: { findFirst: vi.fn(), create: vi.fn() },
    flowTrigger: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));

import { enrollCourseRegistration, enrollFromEvent } from '@/lib/flows/enroll';

beforeEach(() => vi.clearAllMocks());

describe('enrollCourseRegistration', () => {
  it('oppretter enrollment med kurs-anker når ingen aktiv finnes', async () => {
    prisma.flowEnrollment.findFirst.mockResolvedValue(null);
    prisma.flowEnrollment.create.mockResolvedValue({ id: 1 });
    expect(await enrollCourseRegistration(3, 7, 9, 42)).toBe(true);
    expect(prisma.flowEnrollment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ flowId: 3, contactId: 7, courseId: 9, registrationId: 42, status: 'active' }) }),
    );
  });
  it('hopper over når aktiv enrollment for registreringen finnes (kode-sjekk)', async () => {
    prisma.flowEnrollment.findFirst.mockResolvedValue({ id: 1 });
    expect(await enrollCourseRegistration(3, 7, 9, 42)).toBe(false);
    expect(prisma.flowEnrollment.create).not.toHaveBeenCalled();
  });
  it('svelger P2002-race som «allerede påmeldt»', async () => {
    prisma.flowEnrollment.findFirst.mockResolvedValue(null);
    prisma.flowEnrollment.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5.0.0' }));
    expect(await enrollCourseRegistration(3, 7, 9, 42)).toBe(false);
  });
});

describe('enrollFromEvent: kurs-forankret gren', () => {
  it('course-flyt + meta med ids → kurs-forankret enroll', async () => {
    prisma.flowTrigger.findMany.mockResolvedValue([
      { flowId: 3, eventType: 'registration.created', filter: '{}', flow: { anchorMode: 'course' } },
    ]);
    prisma.flowEnrollment.findFirst.mockResolvedValue(null); // ingen aktiv
    prisma.flowEnrollment.create.mockResolvedValue({ id: 1 });
    await enrollFromEvent({ type: 'registration.created', contactId: 7, meta: { registrationId: 42, courseId: 9 } });
    // kurs-forankret create bærer courseId + registrationId
    expect(prisma.flowEnrollment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ flowId: 3, contactId: 7, courseId: 9, registrationId: 42 }) }),
    );
  });
  it('contact-flyt → kontakt-enroll (ingen course/registration-felt)', async () => {
    prisma.flowTrigger.findMany.mockResolvedValue([
      { flowId: 5, eventType: 'registration.created', filter: '{}', flow: { anchorMode: 'contact' } },
    ]);
    prisma.flowEnrollment.findFirst.mockResolvedValue(null);
    prisma.flowEnrollment.create.mockResolvedValue({ id: 2 });
    await enrollFromEvent({ type: 'registration.created', contactId: 7, meta: { registrationId: 42, courseId: 9 } });
    const arg = prisma.flowEnrollment.create.mock.calls.at(-1)?.[0]?.data;
    expect(arg.courseId).toBeUndefined();
    expect(arg.registrationId).toBeUndefined();
  });
  it('course-flyt men meta mangler ids → faller til kontakt-enroll', async () => {
    prisma.flowTrigger.findMany.mockResolvedValue([
      { flowId: 3, eventType: 'x.happened', filter: '{}', flow: { anchorMode: 'course' } },
    ]);
    prisma.flowEnrollment.findFirst.mockResolvedValue(null);
    prisma.flowEnrollment.create.mockResolvedValue({ id: 3 });
    await enrollFromEvent({ type: 'x.happened', contactId: 7, meta: {} });
    const arg = prisma.flowEnrollment.create.mock.calls.at(-1)?.[0]?.data;
    expect(arg.registrationId).toBeUndefined();
  });
});

describe('enrollFromEvent: listeutløser', () => {
  const triggers = [
    { flowId: 5, eventType: 'list.member_added', filter: '{"listId":3}', flow: { anchorMode: 'contact' } },
    { flowId: 6, eventType: 'list.member_added', filter: '{"listId":4}', flow: { anchorMode: 'contact' } },
  ];

  it('melder bare inn i flyten med samme listId (tall)', async () => {
    prisma.flowTrigger.findMany.mockResolvedValue(triggers);
    prisma.flowEnrollment.findFirst.mockResolvedValue(null);
    prisma.flowEnrollment.create.mockResolvedValue({ id: 9 });
    await enrollFromEvent({
      type: 'list.member_added',
      contactId: 7,
      meta: { listId: 3, listName: 'Nyhetsbrev', source: 'manual' },
    });
    const flows = prisma.flowEnrollment.create.mock.calls.map((c) => c[0].data.flowId);
    expect(flows).toEqual([5]);
  });

  it('listId som tekst matcher ikke', async () => {
    prisma.flowTrigger.findMany.mockResolvedValue(triggers);
    await enrollFromEvent({ type: 'list.member_added', contactId: 7, meta: { listId: '3' } });
    expect(prisma.flowEnrollment.create).not.toHaveBeenCalled();
  });
});

describe('enrollFromEvent: suppressFlows', () => {
  it('logs-only events (meta.suppressFlows) never enroll into any flow', async () => {
    prisma.flowTrigger.findMany.mockResolvedValue([
      { flowId: 3, eventType: 'registration.created', filter: '{}', flow: { anchorMode: 'course' } },
    ]);
    await enrollFromEvent({ type: 'registration.created', contactId: 7, meta: { registrationId: 42, courseId: 9, suppressFlows: true } });
    expect(prisma.flowTrigger.findMany).not.toHaveBeenCalled();
    expect(prisma.flowEnrollment.create).not.toHaveBeenCalled();
  });
});
