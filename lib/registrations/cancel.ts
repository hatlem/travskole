import { prisma } from '@/lib/prisma';
import { emitEvent } from '@/lib/events/bus';
import { normalizeEmail } from '@/lib/crm/normalize';
import { planSeatRelease } from '@/lib/registration-rules';
import { countOccupiedPlaces } from '@/lib/registrations/capacity';

/**
 * Sideeffektene av en statusendring på en påmelding, delt av admin-ruten og den
 * selvbetjente avbestillingen: hendelsesbussen og ventelisteopprykket.
 *
 * Lå tidligere inline i PUT /api/admin/registrations/[id]. Da en forelder fikk
 * avbestille selv måtte den samme opprykkslogikken kjøre der også — ellers ville
 * en plass blitt stående tom med folk på venteliste.
 */

/** Sender registration.confirmed / registration.cancelled på hendelsesbussen. */
export async function emitRegistrationStatusEvent(
  registrationId: number,
  courseId: number,
  status: 'confirmed' | 'cancelled'
): Promise<void> {
  // Registration har ingen egen e-post — den ligger på parent.user, som i CRM-broen.
  const regWithParent = await prisma.registration.findUnique({
    where: { id: registrationId },
    select: { parent: { select: { user: { select: { email: true } } } } },
  });
  const email = normalizeEmail(regWithParent?.parent.user.email);
  const contact = email
    ? await prisma.contact.findUnique({ where: { email }, select: { id: true } })
    : null;

  // Ingen dedupeKey her: statusendringer er tilsiktet append-only — samme status
  // kan settes flere ganger og skal hver gang gi et eget hendelses-innslag.
  await emitEvent({
    type: status === 'confirmed' ? 'registration.confirmed' : 'registration.cancelled',
    source: 'server',
    contactId: contact?.id ?? null,
    meta: { registrationId, courseId },
  });
}

/**
 * Etter en kansellering eller sletting: rykk opp fra ventelisten så langt det er
 * ledige plasser, og sett kursstatus ut fra belegget etterpå (fullt ↔ åpent).
 */
export async function promoteFromWaitlist(registrationId: number): Promise<void> {
  const reg = await prisma.registration.findUnique({
    where: { id: registrationId },
    select: { courseId: true },
  });
  if (reg) await releaseSeats(reg.courseId);
}

export async function releaseSeats(courseId: number): Promise<void> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, name: true, status: true, maxParticipants: true },
  });
  if (!course) return;

  const [occupied, waitlisted] = await Promise.all([
    countOccupiedPlaces(course.id),
    prisma.registration.count({ where: { courseId: course.id, status: 'waitlist' } }),
  ]);
  const plan = planSeatRelease({
    courseStatus: course.status,
    maxParticipants: course.maxParticipants,
    occupied,
    waitlisted,
  });

  let promotedCount = 0;
  if (plan.promote > 0) {
    const candidates = await prisma.registration.findMany({
      where: { courseId: course.id, status: 'waitlist' },
      orderBy: { createdAt: 'asc' },
      take: plan.promote,
      include: { parent: { include: { user: true } }, child: true },
    });
    const { sendWaitlistPromotionEmail } = await import('@/lib/mail');
    for (const reg of candidates) {
      // Betinget: ved samtidige avbestillinger rykker bare én kaller opp samme rad.
      const { count } = await prisma.registration.updateMany({
        where: { id: reg.id, status: 'waitlist' },
        data: { status: 'pending' },
      });
      if (count !== 1) continue;
      promotedCount++;
      await sendWaitlistPromotionEmail({
        parentName: reg.parent.name,
        parentEmail: reg.parent.user.email,
        childName: reg.child?.name ?? reg.parent.name,
        courseName: course.name,
      }).catch(() => {});
    }
  }

  const { nextStatus } = planSeatRelease({
    courseStatus: course.status,
    maxParticipants: course.maxParticipants,
    occupied: occupied + promotedCount,
    waitlisted: 0,
  });
  if (nextStatus) {
    await prisma.course.update({ where: { id: course.id }, data: { status: nextStatus } });
  }
}
