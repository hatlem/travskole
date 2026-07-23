/**
 * Integrasjonstest (ekte prisma mot dev-DB) for runner ↔ schedule-node ↔ send
 * -kjeden: en `schedule`-node skal løse LIVE kursdatoer fra enrollmentens
 * registrering, sove til (forfalt) anker, og videre e-post-node skal sende
 * med kurs-flettefelt løst via `registrationId`. Et kurs uten startdato skal
 * gi en rolig exit i stedet for en uendelig/feilende sleep.
 *
 * Bruker `.invalid`-adresser slik at ingen ekte SMTP fyres (SMTP er ikke
 * konfigurert i dev/test — `sendMailAs` degraderer da til en no-op og
 * `sendFlowEmail` returnerer fortsatt 'sent', se lib/mail.ts) og en unik
 * kontakt-e-post slik at ingen ekte Contact-rad matches.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { runFlowBatch } from '@/lib/flows/runner';
import { enrollCourseRegistration } from '@/lib/flows/enroll';

const hex = `${Date.now().toString(36)}${process.pid}`;

interface FixtureIds {
  flowId?: number;
  contactId?: number;
  courseId?: number;
  regId?: number;
  userId?: number;
  parentId?: number;
  senderId?: number;
}

async function cleanup(ids: FixtureIds): Promise<void> {
  if (ids.flowId) {
    const enrollmentIds = (
      await prisma.flowEnrollment.findMany({ where: { flowId: ids.flowId }, select: { id: true } })
    ).map((e) => e.id);
    await prisma.messageSend.deleteMany({ where: { enrollmentId: { in: enrollmentIds } } });
    await prisma.flowEnrollment.deleteMany({ where: { flowId: ids.flowId } });
    await prisma.flowEdge.deleteMany({ where: { flowId: ids.flowId } });
    await prisma.flowNode.deleteMany({ where: { flowId: ids.flowId } });
    await prisma.flow.deleteMany({ where: { id: ids.flowId } });
  }
  if (ids.regId) await prisma.registration.deleteMany({ where: { id: ids.regId } });
  if (ids.parentId) await prisma.parent.deleteMany({ where: { id: ids.parentId } });
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } });
  if (ids.courseId) await prisma.course.deleteMany({ where: { id: ids.courseId } });
  if (ids.contactId) await prisma.contact.deleteMany({ where: { id: ids.contactId } });
  if (ids.senderId) await prisma.senderIdentity.deleteMany({ where: { id: ids.senderId } });
}

/** Bygger en `start → schedule → email → end` flyt + kurs-registrering. Returnerer alle fixture-id'er. */
async function buildFixture(opts: {
  tag: string;
  offsetDays: number;
  startDate: Date | null;
  endDate: Date | null;
}): Promise<FixtureIds> {
  const ids: FixtureIds = {};
  const flow = await prisma.flow.create({ data: { name: `SCHED ${opts.tag}`, status: 'active', isMarketing: false } });
  ids.flowId = flow.id;
  const sender = await prisma.senderIdentity.create({ data: { email: `sched-${opts.tag}@bjerke.no`, displayName: 'Sched', active: true } });
  ids.senderId = sender.id;
  const start = await prisma.flowNode.create({ data: { flowId: flow.id, type: 'start', config: '{}' } });
  const sched = await prisma.flowNode.create({
    data: { flowId: flow.id, type: 'schedule', config: JSON.stringify({ anchor: 'course_start', offsetDays: opts.offsetDays }) },
  });
  const email = await prisma.flowNode.create({
    data: {
      flowId: flow.id,
      type: 'email',
      config: JSON.stringify({ subject: 'Hei {{barnets_navn}}', bodyHtml: '<p>{{kurs_navn}}</p>', senderIdentityId: sender.id }),
    },
  });
  const end = await prisma.flowNode.create({ data: { flowId: flow.id, type: 'end', config: '{}' } });
  await prisma.flowEdge.createMany({
    data: [
      { flowId: flow.id, fromNodeId: start.id, toNodeId: sched.id, branch: null },
      { flowId: flow.id, fromNodeId: sched.id, toNodeId: email.id, branch: null },
      { flowId: flow.id, fromNodeId: email.id, toNodeId: end.id, branch: null },
    ],
  });
  const contact = await prisma.contact.create({
    data: { name: 'Kari', email: `sched-c-${opts.tag}@example.invalid`, source: 'manual' },
  });
  ids.contactId = contact.id;
  const course = await prisma.course.create({
    data: { name: 'Ponni', type: 'kurs', slug: `sched-${opts.tag}`, audience: 'barn', startDate: opts.startDate, endDate: opts.endDate },
  });
  ids.courseId = course.id;
  const user = await prisma.user.create({ data: { email: `sched-u-${opts.tag}@example.invalid`, role: 'parent' } });
  ids.userId = user.id;
  const parent = await prisma.parent.create({ data: { userId: user.id, name: 'Kari', phone: '0' } });
  ids.parentId = parent.id;
  const reg = await prisma.registration.create({ data: { courseId: course.id, parentId: parent.id, childId: null } });
  ids.regId = reg.id;

  await enrollCourseRegistration(flow.id, contact.id, course.id, reg.id);
  return ids;
}

describe('runner: schedule node (integrasjon mot dev-DB)', () => {
  let ids: FixtureIds = {};

  afterEach(async () => {
    await cleanup(ids);
    ids = {};
  });

  it('forfalt kurs-anker → schedule sover til anker, deretter nøyaktig én e-post med kurs-flettefelt løst', async () => {
    ids = await buildFixture({
      tag: `a${hex}`,
      offsetDays: -3,
      startDate: new Date(Date.now() - 10 * 86400000),
      endDate: new Date(Date.now() - 2 * 86400000),
    });

    // Tick 1: start → schedule. Med et forfalt anker (offset -3 dager fra en
    // startdato 10 dager tilbake) blir `sleep.until` liggende i fortiden, så
    // enrollmenten er umiddelbart forfalt igjen for neste tick.
    const tick1 = await runFlowBatch(new Date());
    expect(tick1.processed).toBe(1);
    expect(tick1.sent).toBe(0);

    const afterTick1 = await prisma.flowEnrollment.findFirst({ where: { flowId: ids.flowId } });
    expect(afterTick1?.status).toBe('active');
    expect(afterTick1?.nextRunAt.getTime()).toBeLessThanOrEqual(Date.now());

    // Tick 2: schedule er forfalt → e-post-noden sendes → end fullfører.
    const tick2 = await runFlowBatch(new Date());
    expect(tick2.processed).toBe(1);
    expect(tick2.sent).toBe(1);
    expect(tick2.completed).toBe(1);

    const enrollmentIds = (
      await prisma.flowEnrollment.findMany({ where: { flowId: ids.flowId }, select: { id: true } })
    ).map((e) => e.id);
    const sends = await prisma.messageSend.findMany({ where: { enrollmentId: { in: enrollmentIds } } });

    // Nøyaktig én send/forsøk — ingen dobling (katch-opp-idempotens via
    // dedupeKey `flow:{enrollmentId}:{nodeId}`).
    expect(sends).toHaveLength(1);
    const [msg] = sends;
    expect(msg.status).toBe('sent');
    expect(msg.dedupeKey).toBe(`flow:${enrollmentIds[0]}:${msg.nodeId}`);
    // Kurs-flettefelt løst via registrationId → resolveCourseMergeContext:
    // barnets_navn faller til foreldrenavn (ingen barn på registreringen),
    // kurs_navn er kursets navn.
    expect(msg.subject).toBe('Hei Kari');
    expect(msg.bodyHtml).toContain('Ponni');

    // Enda en tick skal ikke doble sendingen (enrollment er allerede 'completed').
    const tick3 = await runFlowBatch(new Date());
    expect(tick3.processed).toBe(0);
    const sendsAfterTick3 = await prisma.messageSend.findMany({ where: { enrollmentId: { in: enrollmentIds } } });
    expect(sendsAfterTick3).toHaveLength(1);

    const finalEnrollment = await prisma.flowEnrollment.findFirst({ where: { flowId: ids.flowId } });
    expect(finalEnrollment?.status).toBe('completed');
  });

  it('kurs uten startdato → schedule-noden gir en rolig exit (ingen send)', async () => {
    ids = await buildFixture({ tag: `b${hex}`, offsetDays: -3, startDate: null, endDate: null });

    // Tick 1: start → schedule. Uten startdato kan planSchedule ikke beregne
    // et ankerdøgn → `act`-exit-terminal (nextNodeId: null) i samme tick.
    const tick1 = await runFlowBatch(new Date());
    expect(tick1.processed).toBe(1);
    expect(tick1.sent).toBe(0);

    const enrollment = await prisma.flowEnrollment.findFirst({ where: { flowId: ids.flowId } });
    expect(enrollment?.status).toBe('exited');

    const enrollmentIds = enrollment ? [enrollment.id] : [];
    const sends = await prisma.messageSend.findMany({ where: { enrollmentId: { in: enrollmentIds } } });
    expect(sends).toHaveLength(0);
  });
});
