/**
 * Kvittering på e-post for en gjennomført betaling. Kalles fra applyPaymentEvent
 * kun når payment.succeeded-dedupe-raden ble satt inn nå — dermed nøyaktig én
 * kvittering per betalt rad uansett hvor mange webhooks/avstemminger som kommer.
 * Kaster aldri: en feilet kvittering skal ikke velte betalingsanvendelsen.
 */
import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';
import { sendPaymentReceiptEmail, type PaymentReceiptEmail } from '@/lib/mail';
import type { PaymentEventInput } from './mapping';

export interface ReceiptRow {
  kind: 'registration' | 'bookingRequest';
  id: number;
}

type ReceiptInput = Pick<PaymentEventInput, 'provider' | 'ref' | 'nextRef' | 'amountKr'>;

async function loadReceipt(row: ReceiptRow, input: ReceiptInput, paidAt: Date): Promise<PaymentReceiptEmail | null> {
  if (row.kind === 'registration') {
    const reg = await prisma.registration.findUnique({
      where: { id: row.id },
      select: {
        paymentRef: true,
        paymentIntentRef: true,
        course: { select: { name: true, price: true } },
        child: { select: { name: true } },
        parent: { select: { name: true, user: { select: { email: true } } } },
      },
    });
    if (!reg) return null;
    return {
      to: reg.parent.user.email,
      payerName: reg.parent.name,
      courseName: reg.course.name,
      participant: reg.child?.name ?? reg.parent.name,
      amountKr: input.amountKr ?? reg.course.price,
      paidAt,
      provider: input.provider,
      reference: input.nextRef ?? reg.paymentIntentRef ?? reg.paymentRef ?? input.ref,
    };
  }
  const booking = await prisma.bookingRequest.findUnique({
    where: { id: row.id },
    select: {
      name: true,
      email: true,
      participants: true,
      paymentRef: true,
      paymentIntentRef: true,
      course: { select: { name: true, price: true } },
    },
  });
  if (!booking) return null;
  const fallbackAmount = booking.course?.price != null ? booking.course.price * booking.participants : null;
  return {
    to: booking.email,
    payerName: booking.name,
    courseName: booking.course?.name ?? 'Booking',
    participant: `${booking.name} (${booking.participants} ${booking.participants === 1 ? 'deltaker' : 'deltakere'})`,
    amountKr: input.amountKr ?? fallbackAmount,
    paidAt,
    provider: input.provider,
    reference: input.nextRef ?? booking.paymentIntentRef ?? booking.paymentRef ?? input.ref,
  };
}

export async function sendPaymentReceipt(row: ReceiptRow, input: ReceiptInput, paidAt = new Date()): Promise<boolean> {
  try {
    const receipt = await loadReceipt(row, input, paidAt);
    if (!receipt) {
      logger.warn('sendPaymentReceipt: fant ikke raden for kvittering', row);
      return false;
    }
    await sendPaymentReceiptEmail(receipt);
    return true;
  } catch (error) {
    logger.error('sendPaymentReceipt: kvittering kunne ikke sendes', {
      ...row,
      provider: input.provider,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
