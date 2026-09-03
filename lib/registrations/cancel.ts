import { prisma } from '@/lib/prisma';
import { emitEvent } from '@/lib/events/bus';
import { normalizeEmail } from '@/lib/crm/normalize';

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
 * Etter en kansellering: rykk opp første på venteliste hvis kurset nå har plass,
 * og gjenåpne et kurs som sto som fullt.
 */
export async function promoteFromWaitlist(registrationId: number): Promise<void> {
  const cancelledReg = await prisma.registration.findUnique({
    where: { id: registrationId },
    include: { course: true },
  });
  if (!cancelledReg) return;

  const course = cancelledReg.course;
  const activeCount = await prisma.registration.count({
    where: {
      courseId: course.id,
      status: { in: ['pending', 'confirmed'] },
    },
  });

  if (!course.maxParticipants || activeCount >= course.maxParticipants) return;

  const firstWaitlist = await prisma.registration.findFirst({
    where: { courseId: course.id, status: 'waitlist' },
    orderBy: { createdAt: 'asc' },
    include: {
      parent: { include: { user: true } },
      child: true,
      course: true,
    },
  });

  if (firstWaitlist) {
    await prisma.registration.update({
      where: { id: firstWaitlist.id },
      data: { status: 'pending' },
    });

    const { sendWaitlistPromotionEmail } = await import('@/lib/mail');
    await sendWaitlistPromotionEmail({
      parentName: firstWaitlist.parent.name,
      parentEmail: firstWaitlist.parent.user.email,
      childName: firstWaitlist.child?.name ?? firstWaitlist.parent.name,
      courseName: firstWaitlist.course.name,
    }).catch(() => {});
  }

  // Kurset var merket fullt — åpne det igjen nå som en plass er ledig.
  if (course.status === 'full') {
    await prisma.course.update({
      where: { id: course.id },
      data: { status: 'open' },
    });
  }
}
