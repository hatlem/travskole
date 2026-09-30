/**
 * Kvittering sendes nøyaktig én gang per betalt rad — kun når
 * payment.succeeded-dedupe-raden faktisk ble satt inn — og en feilet
 * utsending velter aldri betalingsanvendelsen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, emitEvent, sendMail } = vi.hoisted(() => ({
  prisma: {
    registration: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
    bookingRequest: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
    deal: { findUnique: vi.fn(async () => null) },
    contact: { findUnique: vi.fn(async () => null) },
  },
  emitEvent: vi.fn(async () => true),
  sendMail: vi.fn<(mail: Record<string, string>) => Promise<{ messageId: string }>>(async () => ({ messageId: 'x' })),
}));

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/events/bus', () => ({ emitEvent }));
vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/settings', () => ({
  getSetting: vi.fn(async (key: string) => (key === 'contact_email' ? 'ikke-en-epost' : 'Bjerke Registrering')),
  getSettings: vi.fn(async () => ({})),
  SETTING_DEFAULTS: { contact_email: 'registrering@bjerke.no' },
}));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));

import { applyPaymentEvent } from '@/lib/payments/apply';
import { buildPaymentReceiptEmail } from '@/lib/mail';
import type { PaymentEventInput } from '@/lib/payments/mapping';

const registrationRow = {
  id: 7,
  paymentStatus: 'pending',
  paymentRef: 'cs_test_1',
  paymentIntentRef: null,
  course: { name: 'Ponniskole høst', price: 1500 },
  child: { name: 'Emma' },
  parent: { name: 'Kari Nordmann', user: { email: 'kari@example.com' } },
};

const bookingRow = {
  id: 3,
  paymentStatus: 'pending',
  name: 'Ola Firma',
  email: 'ola@example.com',
  participants: 4,
  paymentRef: 'vipps-ref-3',
  paymentIntentRef: null,
  course: { name: 'Julebord', price: 500 },
};

function stripeSucceeded(): PaymentEventInput {
  return {
    type: 'payment.succeeded',
    provider: 'stripe',
    ref: 'cs_test_1',
    refKind: 'paymentRef',
    nextRef: 'pi_123',
    amountKr: 1500,
    eventId: 'evt_1',
  };
}

function vippsSucceeded(): PaymentEventInput {
  return {
    type: 'payment.succeeded',
    provider: 'vipps',
    ref: 'vipps-ref-3',
    refKind: 'paymentRef',
    amountKr: null,
    eventId: 'vipps-ref-3:AUTHORIZED',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SMTP_HOST = 'smtp.test';
  process.env.SMTP_USER = 'u';
  process.env.SMTP_PASS = 'p';
  process.env.SMTP_FROM = 'noreply@registrering.bjerke.no';
  emitEvent.mockResolvedValue(true);
  prisma.registration.findUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
    where.paymentRef === 'cs_test_1' || where.id === 7 ? registrationRow : null,
  );
  prisma.bookingRequest.findUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
    where.paymentRef === 'vipps-ref-3' || where.id === 3 ? bookingRow : null,
  );
});

describe('payment receipt', () => {
  it('sends a Norwegian receipt for a Stripe registration when the dedupe insert succeeded', async () => {
    await expect(applyPaymentEvent(stripeSucceeded())).resolves.toBe('applied');

    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: 'pay:succeeded:registration:7' }));
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('kari@example.com');
    expect(mail.from).toBe('Bjerke Registrering <noreply@registrering.bjerke.no>');
    expect(mail.replyTo).toBe('registrering@bjerke.no');
    expect(mail.subject).toBe('Kvittering for betaling — Ponniskole høst');
    expect(mail.text).toContain('Emma');
    expect(mail.text).toMatch(/1\s500 kr/);
    expect(mail.text).toContain('Kort (Stripe)');
    expect(mail.text).toContain('pi_123');
  });

  it('sends a receipt for a Vipps booking, falling back to price × participants', async () => {
    await applyPaymentEvent(vippsSucceeded());

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('ola@example.com');
    expect(mail.subject).toContain('Julebord');
    expect(mail.text).toMatch(/2\s000 kr/);
    expect(mail.text).toContain('Vipps');
    expect(mail.text).toContain('vipps-ref-3');
  });

  it('does not send when the payment.succeeded event was a dedupe hit (already receipted)', async () => {
    emitEvent.mockResolvedValue(false);
    await applyPaymentEvent(stripeSucceeded());
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('never sends for non-success events', async () => {
    await applyPaymentEvent({ ...stripeSucceeded(), type: 'payment.failed', refKind: 'metadata', registrationId: 7 });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('a failing SMTP send does not break payment application', async () => {
    sendMail.mockRejectedValueOnce(new Error('SMTP down'));
    await expect(applyPaymentEvent(stripeSucceeded())).resolves.toBe('applied');
    expect(prisma.registration.update).toHaveBeenCalled();
  });
});

describe('buildPaymentReceiptEmail', () => {
  it('escapes user data and omits unknown amounts', () => {
    const { html } = buildPaymentReceiptEmail(
      {
        to: 'x@example.com',
        payerName: '<b>Kari</b>',
        courseName: 'Kurs',
        participant: 'Emma',
        amountKr: null,
        paidAt: new Date('2026-09-30T10:00:00Z'),
        provider: 'vipps',
        reference: 'ref-1',
      },
      'Bjerke',
      'registrering@bjerke.no',
    );
    expect(html).toContain('&lt;b&gt;Kari&lt;/b&gt;');
    expect(html).not.toContain('Beløp');
    expect(html).toContain('30. september 2026');
  });
});
