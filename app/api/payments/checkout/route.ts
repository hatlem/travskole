/**
 * POST /api/payments/checkout
 *
 * Starter en betalingsøkt (Stripe Checkout eller Vipps ePayment) for en
 * påmelding eller bestillingsforespørsel. Sesjonsbeskyttet + eierskapssjekket:
 * en bruker kan kun betale for sin EGEN rad (foresattes e-post for
 * påmelding, `email`-feltet for bestillingsforespørsel).
 *
 * Beløp hentes fra kurset (aldri fra klienten) — se lib/crm/bridge-mapping.ts
 * for de samme verdireglene (booking = pris × deltakere).
 */
import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { getSetting } from '@/lib/settings';
import { parsePaymentMethods, isTestMode, isStripeConfigured } from '@/lib/payments';
import { createStripeCheckout } from '@/lib/payments/stripe';
import { isVippsConfigured, createVippsPayment } from '@/lib/payments/vipps';

const checkoutSchema = z
  .object({
    registrationId: z.number().int().positive().optional(),
    bookingRequestId: z.number().int().positive().optional(),
    provider: z.enum(['stripe', 'vipps']),
  })
  .refine((data) => Boolean(data.registrationId) !== Boolean(data.bookingRequestId), {
    message: 'Oppgi enten registrationId eller bookingRequestId, ikke begge',
  });

interface CheckoutTarget {
  entity: 'registration' | 'booking';
  id: number;
  amountKr: number | null;
  title: string;
  paymentMethodsRaw: string;
}

type TargetResult = CheckoutTarget | 'not_found' | 'forbidden';

async function loadRegistrationTarget(id: number, sessionEmail: string): Promise<TargetResult> {
  const registration = await prisma.registration.findUnique({
    where: { id },
    include: {
      course: true,
      parent: { include: { user: { select: { email: true } } } },
    },
  });
  if (!registration) return 'not_found';
  if (registration.parent.user.email.toLowerCase() !== sessionEmail) return 'forbidden';

  return {
    entity: 'registration',
    id: registration.id,
    amountKr: registration.course.price,
    title: `${registration.course.name} — ${registration.parent.name}`,
    paymentMethodsRaw: registration.course.paymentMethods,
  };
}

async function loadBookingTarget(id: number, sessionEmail: string): Promise<TargetResult> {
  const booking = await prisma.bookingRequest.findUnique({
    where: { id },
    include: { course: true },
  });
  if (!booking || !booking.course) return 'not_found';
  if (booking.email.toLowerCase() !== sessionEmail) return 'forbidden';

  return {
    entity: 'booking',
    id: booking.id,
    amountKr: booking.course.price !== null ? booking.course.price * booking.participants : null,
    title: `${booking.course.name} — ${booking.name}`,
    paymentMethodsRaw: booking.course.paymentMethods,
  };
}

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }

  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { provider, registrationId } = parsed.data;
  const sessionEmail = session.user.email.toLowerCase();

  const target: TargetResult =
    registrationId !== undefined
      ? await loadRegistrationTarget(registrationId, sessionEmail)
      : await loadBookingTarget(parsed.data.bookingRequestId as number, sessionEmail);

  if (target === 'not_found') {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }
  if (target === 'forbidden') {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 });
  }

  const methods = parsePaymentMethods(target.paymentMethodsRaw);
  if (!methods.includes(provider)) {
    return NextResponse.json(
      { error: 'Betalingsmetoden er ikke aktivert for dette arrangementet' },
      { status: 400 }
    );
  }

  if (!target.amountKr) {
    return NextResponse.json({ error: 'Arrangementet har ingen pris' }, { status: 400 });
  }
  const amountKr = target.amountKr;

  const origin = request.nextUrl.origin;
  const testMode = isTestMode(await getSetting('payment_test_mode'));

  let providerResult: { url: string; ref: string } | null;
  if (provider === 'stripe') {
    if (!isStripeConfigured(testMode)) {
      return NextResponse.json({ error: 'Betaling er ikke konfigurert' }, { status: 503 });
    }
    providerResult = await createStripeCheckout({
      kind: target.entity,
      id: target.id,
      title: target.title,
      amountKr,
      // Stripe erstatter {CHECKOUT_SESSION_ID} med den faktiske sesjons-IDen ved
      // redirect — som også er `ref` vi lagrer som paymentRef under.
      successUrl: `${origin}/betaling/takk?ref={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/betaling/avbrutt`,
      testMode,
    });
  } else {
    if (!isVippsConfigured()) {
      return NextResponse.json({ error: 'Betaling er ikke konfigurert' }, { status: 503 });
    }
    const prefix = target.entity === 'registration' ? 'reg' : 'book';
    const reference = `${prefix}-${target.id}-${crypto.randomBytes(4).toString('hex')}`;
    providerResult = await createVippsPayment({
      reference,
      amountKr,
      description: target.title,
      returnUrl: `${origin}/betaling/takk?ref=${reference}`,
    });
  }

  if (!providerResult) {
    return NextResponse.json({ error: 'Betaling er ikke konfigurert' }, { status: 503 });
  }

  try {
    if (target.entity === 'registration') {
      await prisma.registration.update({
        where: { id: target.id },
        data: { paymentRef: providerResult.ref, paymentProvider: provider, paymentStatus: 'pending' },
      });
    } else {
      await prisma.bookingRequest.update({
        where: { id: target.id },
        data: { paymentRef: providerResult.ref, paymentProvider: provider, paymentStatus: 'pending' },
      });
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'Betaling er allerede startet' }, { status: 409 });
    }
    throw error;
  }

  logActivity({
    action: 'checkout_started',
    entity: target.entity,
    entityId: target.id,
    userEmail: session.user.email,
  }).catch(() => {});

  return NextResponse.json({ url: providerResult.url });
}
