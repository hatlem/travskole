import { NextRequest, NextResponse } from 'next/server';
import { isPublicCourse } from '@/lib/course-status';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, registrationLimiter } from '@/lib/rate-limiter';
import { getClientIpBucket } from '@/lib/client-ip';
import { getServerSession } from '@/lib/auth';
import { bookingConsentError } from '@/lib/booking';
import { sendBookingConfirmation, sendBookingAdminNotification } from '@/lib/mail';
import logger from '@/lib/logger';
import { syncBookingToCrm } from '@/lib/crm/bridge';
import { emitEvent, stitchVisitorToContact, VISITOR_COOKIE } from '@/lib/events/bus';
import { normalizeEmail } from '@/lib/crm/normalize';
import { recordMarketingOptIn } from '@/lib/crm/marketing-consent';
import { phoneSchema } from '@/lib/validation/phone';
import { preferredDateError } from '@/lib/validation/date';
import { getSetting } from '@/lib/settings';

const bookingSchema = z.object({
  courseId: z.coerce.number().int().positive(),
  name: z.string().min(1, 'Navn er påkrevd').max(200),
  email: z.string().email('Ugyldig e-postadresse'),
  phone: phoneSchema,
  participants: z.coerce.number().int().min(1).max(20).default(1),
  preferredDate: z
    .string()
    .nullable()
    .optional()
    .superRefine((value, ctx) => {
      const error = preferredDateError(value);
      if (error) ctx.addIssue({ code: 'custom', message: error });
    }),
  message: z.string().max(2000).nullable().optional(),
  consentRisk: z.boolean().default(false),
  consentTerms: z.boolean().default(false),
  consentMedia: z.boolean().default(false),
  consentActivities: z.boolean().default(false),
  marketingOptIn: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const rl = await checkRateLimit(registrationLimiter, `booking:${getClientIpBucket(request.headers)}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: rl.error ?? 'For mange forsøk. Prøv igjen senere.' }, { status: 429 });
  }

  const body = await request.json();
  const parsed = bookingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;

  const course = await prisma.course.findUnique({ where: { id: data.courseId } });
  if (!course || !isPublicCourse(course) || course.registrationMode !== 'request' || course.status === 'closed') {
    return NextResponse.json({ error: 'Forespørsel er ikke tilgjengelig for dette arrangementet' }, { status: 400 });
  }

  let userId: number | null = null;
  if (course.requestRequiresLogin) {
    const session = await getServerSession();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Du må være innlogget for å sende forespørsel.' }, { status: 401 });
    }
    const user = await prisma.user.findUnique({
      where: { email: session.user.email.toLowerCase() },
      select: { id: true },
    });
    userId = user?.id ?? null;
  }

  const consentErr = bookingConsentError(course, data);
  if (consentErr) {
    return NextResponse.json({ error: consentErr }, { status: 400 });
  }

  // Opt-in teller kun når avkrysningsboksen faktisk vises i skjemaet.
  const marketingOptIn =
    data.marketingOptIn === true && (await getSetting('marketing_optin_enabled')) === 'true';
  // Kun innlogget innsender med samme e-post kan oppheve en tidligere avmelding.
  const optInVerified =
    marketingOptIn &&
    normalizeEmail((await getServerSession())?.user?.email ?? '') === normalizeEmail(data.email);

  try {
    const booking = await prisma.bookingRequest.create({
      data: {
        courseId: course.id,
        userId,
        name: data.name,
        email: data.email,
        phone: data.phone,
        participants: data.participants,
        preferredDate: data.preferredDate ? new Date(data.preferredDate) : null,
        message: data.message || null,
        consentRisk: data.consentRisk,
        consentTerms: data.consentTerms,
        consentMedia: data.consentMedia,
        consentActivities: data.consentActivities,
      },
    });

    // CRM-bro: fire-and-forget — får aldri stoppe bookingen.
    // Hendelsesbuss-oppslaget kjeder seg PÅ syncen (ikke parallelt): syncBookingToCrm
    // oppretter/oppdaterer Contact-raden, så vi må vente til den er ferdig før vi
    // slår opp kontakten her — ellers finner findUnique intet for en helt ny e-post,
    // hendelsen lagres anonym, og stitchVisitorToContact får aldri kjørt. Fortsatt
    // helt frakoblet fra responsen (begge grener fanges).
    syncBookingToCrm(booking.id)
      .catch(() => {})
      .then(async () => {
        const email = normalizeEmail(booking.email);
        const contact = email
          ? await prisma.contact.findUnique({ where: { email }, select: { id: true } })
          : null;
        const publicId = request.cookies.get(VISITOR_COOKIE)?.value;
        if (contact && marketingOptIn) await recordMarketingOptIn(contact.id, 'booking_form', { verified: optInVerified });
        if (contact) await stitchVisitorToContact(publicId, contact.id);
        await emitEvent({
          type: 'booking.created',
          source: 'server',
          contactId: contact?.id ?? null,
          meta: { bookingRequestId: booking.id, eventType: course.type },
          dedupeKey: `booking.created:${booking.id}`,
        });
      })
      .catch(() => {});

    const emailData = {
      courseName: course.name,
      name: data.name,
      email: data.email,
      phone: data.phone,
      participants: booking.participants,
      preferredDate: data.preferredDate ?? null,
      message: data.message ?? null,
      priceKr: course.price,
    };
    await Promise.all([
      sendBookingConfirmation(emailData),
      sendBookingAdminNotification(emailData),
    ]).catch((err) => logger.error('Booking email error (booking saved)', { error: err }));

    // Kvitteringen tilbyr bare innloggingslenke når e-posten faktisk har en konto.
    const hasAccount = userId !== null || (await prisma.user
      .findUnique({ where: { email: data.email.toLowerCase().trim() }, select: { id: true } })
      .then((user) => user !== null, () => true));

    return NextResponse.json({ booking, hasAccount }, { status: 201 });
  } catch (error) {
    logger.error('Booking error', { error });
    return NextResponse.json({ error: 'Noe gikk galt' }, { status: 500 });
  }
}
