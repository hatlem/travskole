import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { selfCancelRegistrationError } from '@/lib/registrations/cancel-rules';
import {
  emitRegistrationStatusEvent,
  promoteFromWaitlist,
} from '@/lib/registrations/cancel';
import logger from '@/lib/logger';

/**
 * Forelderen avbestiller sin egen påmelding.
 *
 * Kjører nøyaktig samme etterarbeid som admin sin kansellering — hendelsesbuss
 * og ventelisteopprykk — slik at en frigjort plass tilbys neste på lista.
 * Betalte påmeldinger og arrangementer som har startet stoppes av reglene i
 * cancel-rules og må tas med et menneske.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  try {
    // Eierskap: påmeldingen må høre til den innloggede brukerens profil.
    const registration = await prisma.registration.findFirst({
      where: { id, parent: { user: { email: session.user.email } } },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        courseId: true,
        course: { select: { startDate: true, endDate: true } },
      },
    });
    if (!registration) {
      return NextResponse.json({ error: 'Påmeldingen ble ikke funnet' }, { status: 404 });
    }

    const blocked = selfCancelRegistrationError({
      status: registration.status,
      paymentStatus: registration.paymentStatus,
      courseStart: registration.course.startDate ?? registration.course.endDate,
    });
    if (blocked) {
      return NextResponse.json({ error: blocked }, { status: 409 });
    }

    await prisma.registration.update({ where: { id }, data: { status: 'cancelled' } });

    logActivity({
      action: 'status_change',
      entity: 'registration',
      entityId: id,
      details: JSON.stringify({ from: registration.status, to: 'cancelled', selfService: true }),
      userEmail: session.user.email,
    }).catch(() => {});

    emitRegistrationStatusEvent(id, registration.courseId, 'cancelled').catch(() => {});
    await promoteFromWaitlist(id);

    return NextResponse.json({ ok: true, status: 'cancelled' });
  } catch (error) {
    logger.error('[dashboard:cancel] registration cancel failed', { error });
    return NextResponse.json({ error: 'Kunne ikke avbestille' }, { status: 500 });
  }
}
