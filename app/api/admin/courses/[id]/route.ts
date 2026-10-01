import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { serializePaymentMethods } from '@/lib/payments';
import { SETTLED_PAYMENT_STATUSES } from '@/lib/payments/transitions';
import { releaseSeats } from '@/lib/registrations/cancel';
import { deleteDealsForRegistrations } from '@/lib/crm/source-deals';
import { draftTransitionError, isCourseStatus } from '@/lib/course-status';
import logger from '@/lib/logger';

/** Hindrer at et kurs kunder allerede har meldt seg på (eller spurt om), blir et skjult utkast. */
async function draftGuard(courseId: number, from: string, to: string): Promise<string | null> {
  if (to !== 'draft' || from === 'draft') return null;
  const [registrations, requests] = await Promise.all([
    prisma.registration.count({ where: { courseId } }),
    prisma.bookingRequest.count({ where: { courseId } }),
  ]);
  return draftTransitionError(from, to, registrations + requests);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Du må være logget inn som administrator.' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const course = await prisma.course.findUnique({
      where: { id: Number(id) },
      include: {
        _count: { select: { registrations: true } },
      },
    });

    if (!course) {
      return NextResponse.json({ error: 'Kurs ikke funnet' }, { status: 404 });
    }

    return NextResponse.json({ course });
  } catch (error) {
    logger.error('Error fetching course', { error });
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Du må være logget inn som administrator.' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const { name, description, type, audience, startDate, endDate, ageMin, ageMax, price, minParticipants, maxParticipants, status, slug, imageUrl, registrationMode, requestRequiresLogin, requestConsentRisk, requestConsentTerms, requestConsentMedia, requestConsentActivities, paymentMethods } = body;

    const mode = registrationMode === 'request' ? 'request' : 'standard';

    if (!name || !type || !status || (mode === 'standard' && !startDate)) {
      return NextResponse.json({ error: 'Manglende pakrevde felter' }, { status: 400 });
    }
    if (!isCourseStatus(status)) {
      return NextResponse.json({ error: 'Ugyldig status' }, { status: 400 });
    }

    const existing = await prisma.course.findUnique({ where: { id: Number(id) }, select: { status: true } });
    if (!existing) {
      return NextResponse.json({ error: 'Kurs ikke funnet' }, { status: 404 });
    }
    const draftError = await draftGuard(Number(id), existing.status, status);
    if (draftError) {
      return NextResponse.json({ error: draftError }, { status: 409 });
    }

    const { generateSlug } = await import('@/lib/slug');
    const courseSlug = slug?.trim() || generateSlug(name);

    const course = await prisma.course.update({
      where: { id: Number(id) },
      data: {
        name,
        slug: courseSlug,
        description: description || null,
        type,
        audience: audience === 'voksen' ? 'voksen' : 'barn',
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        ageMin: ageMin != null ? Number(ageMin) : null,
        ageMax: ageMax != null ? Number(ageMax) : null,
        price: price != null ? Number(price) : null,
        minParticipants: minParticipants != null ? Number(minParticipants) : null,
        maxParticipants: maxParticipants != null ? Number(maxParticipants) : null,
        status,
        imageUrl: imageUrl || null,
        registrationMode: mode,
        paymentMethods: serializePaymentMethods(paymentMethods),
        requestRequiresLogin: !!requestRequiresLogin,
        requestConsentRisk: requestConsentRisk !== false,
        requestConsentTerms: requestConsentTerms !== false,
        requestConsentMedia: !!requestConsentMedia,
        requestConsentActivities: !!requestConsentActivities,
      },
    });

    // Endret maks-antall kan fylle eller frigjøre plasser: samme regel som ved avbestilling
    // (stengte kurs og kurs uten maks røres ikke).
    const settledStatus = await releaseSeats(course.id);
    if (settledStatus) course.status = settledStatus;

    logActivity({ action: 'update', entity: 'course', entityId: Number(id), details: name, userEmail: session.user.email }).catch(() => {});

    return NextResponse.json({ course });
  } catch (error) {
    logger.error('Error updating course', { error });
    return NextResponse.json({ error: 'Kunne ikke oppdatere kurs' }, { status: 500 });
  }
}

/** Bare status — «Publiser» (utkast → åpen), «Åpne påmelding» og «Steng påmelding» uten å sende hele skjemaet. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Du må være logget inn som administrator.' }, { status: 401 });
  }

  const { id } = await params;
  const courseId = Number(id);
  const body = await request.json().catch(() => null);
  if (!Number.isInteger(courseId) || !isCourseStatus(body?.status)) {
    return NextResponse.json({ error: 'Ugyldig status' }, { status: 400 });
  }

  try {
    const existing = await prisma.course.findUnique({ where: { id: courseId }, select: { status: true } });
    if (!existing) {
      return NextResponse.json({ error: 'Kurs ikke funnet' }, { status: 404 });
    }
    const draftError = await draftGuard(courseId, existing.status, body.status);
    if (draftError) {
      return NextResponse.json({ error: draftError }, { status: 409 });
    }
    const course = await prisma.course.update({ where: { id: courseId }, data: { status: body.status } });
    // Et åpnet kurs kan allerede være fullt (eller ha venteliste som skal rykke opp).
    const settledStatus = await releaseSeats(course.id);
    if (settledStatus) course.status = settledStatus;

    logActivity({
      action: 'status_change',
      entity: 'course',
      entityId: courseId,
      details: JSON.stringify({ from: existing.status, to: course.status }),
      userEmail: session.user.email,
    }).catch(() => {});

    return NextResponse.json({ course });
  } catch (error) {
    logger.error('Error updating course status', { error });
    return NextResponse.json({ error: 'Kunne ikke endre status' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Du må være logget inn som administrator.' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const courseId = Number(id);
    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
    if (!course) {
      return NextResponse.json({ error: 'Kurs ikke funnet' }, { status: 404 });
    }

    const settled = await prisma.registration.count({
      where: { courseId, paymentStatus: { in: [...SETTLED_PAYMENT_STATUSES] } },
    });
    if (settled > 0) {
      return NextResponse.json(
        {
          error: `Kurset kan ikke slettes fordi ${settled === 1 ? 'én påmelding har' : `${settled} påmeldinger har`} betalt (eller fått refusjon), og betalingshistorikken må bevares. Sett status til «Stengt» i stedet for å stoppe påmeldingen.`,
        },
        { status: 409 },
      );
    }

    // Påmeldingene slettes med kurset (cascade); kortene deres på salgstavla må fjernes eksplisitt.
    const registrations = await prisma.registration.findMany({ where: { courseId }, select: { id: true } });
    const [deals] = await prisma.$transaction([
      deleteDealsForRegistrations(registrations.map((r) => r.id)),
      prisma.course.delete({ where: { id: courseId } }),
    ]);

    logActivity({
      action: 'delete',
      entity: 'course',
      entityId: courseId,
      details: JSON.stringify({ registrations: registrations.length, dealsRemoved: deals.count }),
      userEmail: session.user.email,
    }).catch(() => {});

    return NextResponse.json({ success: true, dealsRemoved: deals.count });
  } catch (error) {
    logger.error('Error deleting course', { error });
    return NextResponse.json({ error: 'Kunne ikke slette kurs' }, { status: 500 });
  }
}
