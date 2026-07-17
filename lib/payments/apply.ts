/**
 * Betalings-event-anvendelse (DB-laget) — kalt fra webhook-rutene etter at
 * signatur er verifisert og eventet er mappet til `PaymentEventInput`.
 *
 * MERK — dette er MOTSATT feilkontrakt av hendelsesbussen (bus.ts) og
 * CRM-broen (bridge.ts), som ALDRI kaster utad. Her SKAL DB-feil på
 * kjerneflyten (rad-oppdatering, deal-flytting til vunnet) kastes videre til
 * kalleren: webhook-ruten oversetter det til HTTP 500, slik at Stripe/Vipps
 * gjenforsøker leveransen. Å svelge feil her ville gitt en betaling som
 * aldri får rett `paymentStatus/paymentRef` uten at noen part vet om det.
 * Kun kontakt-oppslag og tidslinje-/puls-bivirkninger (steg 3–5, utenom selve
 * deal-flyttingen) er best-effort og fanges med `.catch(() => {})`.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';
import { emitEvent } from '@/lib/events/bus';
import { normalizeEmail } from '@/lib/crm/normalize';
import type { PaymentEventInput } from './mapping';
import { planStatusTransition, type PaymentStatus } from './transitions';

const STATUS_MAP: Record<PaymentEventInput['type'], string> = {
  'payment.succeeded': 'paid',
  'payment.failed': 'failed',
  'payment.refunded': 'refunded',
};

type ResolvedRow =
  | { kind: 'registration'; id: number; paymentStatus: string }
  | { kind: 'bookingRequest'; id: number; paymentStatus: string };

async function resolveRow(input: PaymentEventInput): Promise<ResolvedRow | null> {
  if (input.refKind === 'paymentRef') {
    const registration = await prisma.registration.findUnique({
      where: { paymentRef: input.ref },
      select: { id: true, paymentStatus: true },
    });
    if (registration) return { kind: 'registration', id: registration.id, paymentStatus: registration.paymentStatus };

    // Stripe skriver om paymentRef fra checkout-sesjon (cs_) til payment
    // intent (pi_) ved payment.succeeded (se applyPaymentEvent) — senere
    // events nøkla på PI-en (f.eks. charge.refunded) må derfor også kunne
    // slå opp via den stabile paymentIntentRef-kolonnen.
    const registrationByPi = await prisma.registration.findUnique({
      where: { paymentIntentRef: input.ref },
      select: { id: true, paymentStatus: true },
    });
    if (registrationByPi) {
      return { kind: 'registration', id: registrationByPi.id, paymentStatus: registrationByPi.paymentStatus };
    }

    const booking = await prisma.bookingRequest.findUnique({
      where: { paymentRef: input.ref },
      select: { id: true, paymentStatus: true },
    });
    if (booking) return { kind: 'bookingRequest', id: booking.id, paymentStatus: booking.paymentStatus };

    const bookingByPi = await prisma.bookingRequest.findUnique({
      where: { paymentIntentRef: input.ref },
      select: { id: true, paymentStatus: true },
    });
    if (bookingByPi) {
      return { kind: 'bookingRequest', id: bookingByPi.id, paymentStatus: bookingByPi.paymentStatus };
    }

    return null;
  }

  // refKind === 'metadata'
  if (input.registrationId) {
    const registration = await prisma.registration.findUnique({
      where: { id: input.registrationId },
      select: { id: true, paymentStatus: true },
    });
    if (registration) return { kind: 'registration', id: registration.id, paymentStatus: registration.paymentStatus };
  }
  if (input.bookingRequestId) {
    const booking = await prisma.bookingRequest.findUnique({
      where: { id: input.bookingRequestId },
      select: { id: true, paymentStatus: true },
    });
    if (booking) return { kind: 'bookingRequest', id: booking.id, paymentStatus: booking.paymentStatus };
  }
  return null;
}

/** Henter normalisert kontakt-e-post for raden — brukes til CRM-oppslag. */
async function resolveContactEmail(row: ResolvedRow): Promise<string | null> {
  if (row.kind === 'registration') {
    const reg = await prisma.registration.findUnique({
      where: { id: row.id },
      select: { parent: { include: { user: { select: { email: true } } } } },
    });
    return normalizeEmail(reg?.parent.user.email);
  }
  const booking = await prisma.bookingRequest.findUnique({
    where: { id: row.id },
    select: { email: true },
  });
  return normalizeEmail(booking?.email);
}

/**
 * Flytter en deal koblet til registrering/booking til pipelinens
 * "vunnet"-stadium — speiler semantikken i kanban-PATCH-en
 * (`app/api/admin/crm/deals/[id]/route.ts`): status/closedAt styres av
 * stadiets `isWon`, closedAt settes kun første gang (fra null), og et
 * `deal_change`-innslag skrives til tidslinjen.
 *
 * Del av kjerneflyten — kaster videre ved DB-feil.
 */
async function moveWonDeal(row: ResolvedRow): Promise<void> {
  const deal = await prisma.deal.findUnique({
    where: row.kind === 'registration' ? { registrationId: row.id } : { bookingRequestId: row.id },
    select: {
      id: true,
      title: true,
      pipelineId: true,
      stageId: true,
      closedAt: true,
      contactId: true,
      organizationId: true,
      stage: { select: { name: true } },
    },
  });
  if (!deal) return;

  const wonStage = await prisma.stage.findFirst({
    where: { pipelineId: deal.pipelineId, isWon: true },
  });
  if (!wonStage) {
    logger.warn('applyPaymentEvent: pipeline mangler vunnet-stadium', {
      dealId: deal.id,
      pipelineId: deal.pipelineId,
    });
    return;
  }

  // Allerede i vunnet-stadiet — ingenting å gjøre (idempotent).
  if (wonStage.id === deal.stageId) return;

  const updated = await prisma.deal.update({
    where: { id: deal.id },
    data: {
      stageId: wonStage.id,
      status: 'won',
      ...(deal.closedAt === null && { closedAt: new Date() }),
    },
  });

  if (deal.contactId || deal.organizationId) {
    await prisma.contactActivity
      .create({
        data: {
          contactId: deal.contactId,
          organizationId: deal.organizationId,
          type: 'deal_change',
          title: `${updated.title}: ${deal.stage.name} → ${wonStage.name}`,
        },
      })
      .catch(() => {});
  }
}

/**
 * Anvender et betalings-webhook-event: oppdaterer registrerings-/
 * booking-raden, emitter en hendelse på bussen og flytter en tilknyttet
 * deal til vunnet ved vellykket betaling.
 */
export async function applyPaymentEvent(input: PaymentEventInput): Promise<'applied' | 'not_found'> {
  const row = await resolveRow(input);
  if (!row) {
    logger.warn('applyPaymentEvent: fant ikke rad for betalingsevent', {
      provider: input.provider,
      refKind: input.refKind,
      ref: input.ref,
      eventId: input.eventId,
    });
    return 'not_found';
  }

  const newStatus = STATUS_MAP[input.type];
  const { write, downgrade: isDowngrade } = planStatusTransition(row.paymentStatus, newStatus as PaymentStatus);

  // nextRef er kun satt av Stripe checkout.session.completed (payment.succeeded)
  // og bærer den faktiske payment-intent-IDen. Vi lagrer den i den dedikerte
  // paymentIntentRef-kolonnen og lar paymentRef (cs_-IDen) stå urørt, slik at
  // takk-sidens `?ref=cs_...`-oppslag fortsatt treffer etter webhooken kjører.
  const updateData: Prisma.RegistrationUpdateInput | Prisma.BookingRequestUpdateInput = {
    ...(write && { paymentStatus: newStatus }),
    ...(input.nextRef && { paymentIntentRef: input.nextRef }),
  };

  if (isDowngrade) {
    logger.info('applyPaymentEvent: ignorert nedgradering av betalingsstatus', {
      provider: input.provider,
      eventId: input.eventId,
      fraStatus: row.paymentStatus,
      tilStatus: newStatus,
      ...(row.kind === 'registration' ? { registrationId: row.id } : { bookingRequestId: row.id }),
    });
  }

  if (Object.keys(updateData).length > 0) {
    if (row.kind === 'registration') {
      await prisma.registration.update({ where: { id: row.id }, data: updateData });
    } else {
      await prisma.bookingRequest.update({ where: { id: row.id }, data: updateData });
    }
  }

  // Ignorerte nedgraderinger endrer ikke terminal status — ingen bussevent,
  // ingen deal-flytting. Bokføring av nextRef/paymentIntentRef over gjelder
  // uansett (best-effort-uavhengig, gjort før denne returen).
  if (isDowngrade) {
    return 'applied';
  }

  // Kontakt-oppslag og hendelsesemisjon: best-effort, felter for CRM/tidslinje.
  const contactId = await resolveContactEmail(row)
    .then((email) => (email ? prisma.contact.findUnique({ where: { email }, select: { id: true } }) : null))
    .then((contact) => contact?.id ?? null)
    .catch(() => null);

  await emitEvent({
    type: input.type,
    source: 'webhook',
    contactId,
    meta: {
      provider: input.provider,
      amountKr: input.amountKr,
      ...(row.kind === 'registration' ? { registrationId: row.id } : { bookingRequestId: row.id }),
    },
    dedupeKey: `pay:${input.provider}:${input.eventId}`,
  }).catch(() => {});

  if (input.type === 'payment.succeeded') {
    await moveWonDeal(row);
  }

  return 'applied';
}
