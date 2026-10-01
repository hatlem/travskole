import { NextRequest, NextResponse } from 'next/server';
import DOMPurify from 'isomorphic-dompurify';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parsePaymentMethods } from '@/lib/payments';
import { validateProfileInput } from '@/lib/profile';
import { serializeChild } from '@/lib/children';
import { selfCancelBookingError, selfCancelRegistrationError } from '@/lib/registrations/cancel-rules';
import { selfCancelledRegistrationIds } from '@/lib/registrations/self-cancelled';
import { customerWithdrawnBookingIds } from '@/lib/bookings/withdrawn';
import { bookingOwnershipWhere } from '@/lib/bookings/ownership';
import { normalizeEmail } from '@/lib/crm/normalize';
import { isUnpaidStatus } from '@/lib/payments/badge';

type OnlineMethod = 'stripe' | 'vipps';

/** Forespørslene (bookinger) til den innloggede brukeren — samme eierskapsregel som resten av booking-flyten. */
async function loadBookings(email: string, userId: number) {
  const normalized = normalizeEmail(email);
  if (!normalized) return [];
  const bookings = await prisma.bookingRequest.findMany({
    where: bookingOwnershipWhere(normalized, userId),
    include: { course: { select: { name: true, price: true, paymentMethods: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const withdrawn = await customerWithdrawnBookingIds(bookings.filter((b) => b.status === 'cancelled').map((b) => b.id));
  return bookings.map((b) => {
    const amountKr = b.course?.price != null ? b.course.price * b.participants : null;
    const providers = parsePaymentMethods(b.course?.paymentMethods ?? '').filter(
      (m): m is OnlineMethod => m === 'stripe' || m === 'vipps'
    );
    const requiresPayment = b.status === 'confirmed' && providers.length > 0 && amountKr != null && amountKr > 0;
    return {
      id: b.id,
      courseName: b.course?.name ?? 'Forespørsel',
      participants: b.participants,
      preferredDate: b.preferredDate?.toISOString() ?? null,
      createdAt: b.createdAt.toISOString(),
      status: b.status,
      withdrawnBySelf: withdrawn.has(b.id),
      paymentStatus: b.paymentStatus,
      amountKr,
      requiresPayment,
      providers: requiresPayment && isUnpaidStatus(b.paymentStatus) ? providers : [],
      cancellable: selfCancelBookingError(b) === null,
    };
  });
}

/**
 * Oppretter eller oppdaterer forelderprofilen til den innloggede brukeren.
 *
 * Brukere som er opprettet av en admin (eller via magic link) har ingen
 * Parent-rad før de har meldt på noen. Da opprettes profilen her, slik at de
 * kan fylle den ut selv i stedet for å måtte melde på et kurs først.
 */
export async function PUT(request: NextRequest) {
  const session = await getServerSession();

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Du må være logget inn.' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { name, phone, address } = body;

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: { parent: true },
  });

  if (!user) {
    return NextResponse.json({ error: 'Profil ikke funnet' }, { status: 404 });
  }

  const storedPhone = user.parent && !user.parent.deletedAt ? user.parent.phone : undefined;
  const validationError = validateProfileInput({ name, phone, address }, { storedPhone });
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const data = {
    name: DOMPurify.sanitize(name.trim()),
    phone: phone.trim(),
    address: typeof address === 'string' && address.trim() ? DOMPurify.sanitize(address.trim()) : null,
  };

  const parent = user.parent
    ? await prisma.parent.update({
        where: { id: user.parent.id },
        // Var profilen soft-slettet, gjenopprettes den med de nye opplysningene
        // i stedet for å lage en ny rad (Parent.userId er unik).
        data: user.parent.deletedAt ? { ...data, deletedAt: null } : data,
      })
    : await prisma.parent.create({ data: { ...data, userId: user.id } });

  return NextResponse.json({
    profile: {
      name: parent.name,
      email: user.email,
      phone: parent.phone,
      address: parent.address,
    },
  });
}

export async function GET() {
  const session = await getServerSession();

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Du må være logget inn.' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: {
      parent: {
        include: {
          children: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
          },
          registrations: {
            include: {
              course: true,
              child: true,
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: 'Fant ikke brukeren.' }, { status: 404 });
  }

  // hasPassword styrer om passord-seksjonen ber om det nåværende passordet:
  // magic-link-kontoer setter sitt første passord uten.
  const hasPassword = Boolean(user.passwordHash);

  // GDPR-slettede profiler behandles som «ingen profil» — brukeren kan fylle ut
  // en ny via PUT ovenfor.
  const bookings = await loadBookings(user.email, user.id).catch(() => []);

  if (!user.parent || user.parent.deletedAt) {
    return NextResponse.json({
      profile: null,
      children: [],
      registrations: [],
      bookings,
      role: user.role,
      // E-posten er kontoens, ikke profilens — den finnes også uten Parent-rad.
      email: user.email,
      hasPassword,
    });
  }

  const { parent } = user;
  const selfCancelled = await selfCancelledRegistrationIds(
    parent.registrations.filter((r) => r.status === 'cancelled').map((r) => r.id)
  ).catch(() => new Set<number>());

  return NextResponse.json({
    role: user.role,
    email: user.email,
    hasPassword,
    profile: {
      name: parent.name,
      email: user.email,
      phone: parent.phone,
      address: parent.address,
    },
    children: parent.children.map(serializeChild),
    bookings,
    registrations: parent.registrations.map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      courseName: r.course.name,
      courseType: r.course.type,
      courseStartDate: r.course.startDate?.toISOString() ?? null,
      courseEndDate: r.course.endDate?.toISOString() ?? null,
      childName: r.child?.name ?? null,
      participantName: r.child?.name ?? parent.name,
      cancelledBySelf: selfCancelled.has(r.id),
      paymentStatus: r.paymentStatus,
      priceKr: r.course.price,
      // Kun online-betalbare metoder — faktura krever ingen handling fra brukeren.
      payableMethods: parsePaymentMethods(r.course.paymentMethods).filter((m) => m !== 'faktura'),
      // Reglene for selvbetjent avbestilling bor ett sted; klienten viser bare
      // knappen når serveren sier at den ville godtatt den.
      cancellable:
        selfCancelRegistrationError({
          status: r.status,
          paymentStatus: r.paymentStatus,
          courseStart: r.course.startDate ?? r.course.endDate,
        }) === null,
    })),
  });
}
