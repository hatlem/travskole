/**
 * Takk-sidens avstemming: Stripe-sesjon/Vipps-status hentes fra leverandøren
 * når webhooken ikke har kommet, og anvendes med samme idempotente sti som
 * webhooken (én payment.succeeded per rad uansett kilde).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, emitEvent, retrieve, getVippsPayment, row } = vi.hoisted(() => {
  const row = { status: 'pending', provider: 'stripe' as string | null, ref: 'cs_test_abc' };
  const findByRef = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    if (where.paymentRef === row.ref) {
      return { id: 5, paymentStatus: row.status, paymentProvider: row.provider };
    }
    return null;
  });
  return {
    row,
    prisma: {
      registration: {
        findUnique: findByRef,
        update: vi.fn(async ({ data }: { data: { paymentStatus?: string } }) => {
          if (data.paymentStatus) row.status = data.paymentStatus;
          return {};
        }),
      },
      bookingRequest: { findUnique: vi.fn(async () => null), update: vi.fn() },
      deal: { findUnique: vi.fn(async () => null) },
      contact: { findUnique: vi.fn(async () => null) },
    },
    emitEvent: vi.fn(async () => {}),
    retrieve: vi.fn(),
    getVippsPayment: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/events/bus', () => ({ emitEvent }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async () => 'false') }));
vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('stripe', () => {
  class Stripe {
    checkout = { sessions: { retrieve } };
  }
  return { default: Stripe };
});
vi.mock('@/lib/payments/vipps', () => ({
  getVippsPayment,
  isVippsConfigured: () => true,
}));

import { resolveThankYouStatus } from '@/lib/payments/reconcile';
import { applyPaymentEvent } from '@/lib/payments/apply';
import { mapStripeEvent, mapVippsEvent } from '@/lib/payments/mapping';

function paidSession(id = 'cs_test_abc') {
  return {
    id,
    payment_status: 'paid',
    amount_total: 150000,
    payment_intent: 'pi_123',
    metadata: { registrationId: '5' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  row.status = 'pending';
  row.provider = 'stripe';
  row.ref = 'cs_test_abc';
  process.env.STRIPE_SECRET_KEY_TEST = 'sk_test_x';
  process.env.STRIPE_SECRET_KEY = 'sk_live_x';
});

describe('resolveThankYouStatus — Stripe', () => {
  it('markerer betalt når Stripe bekrefter sesjonen, selv uten webhook', async () => {
    retrieve.mockResolvedValue(paidSession());
    await expect(resolveThankYouStatus('cs_test_abc')).resolves.toBe('paid');
    expect(retrieve).toHaveBeenCalledWith('cs_test_abc');
    expect(row.status).toBe('paid');
    expect(emitEvent).toHaveBeenCalledTimes(1);
  });

  it('lar status stå når Stripe ikke har betalingen', async () => {
    retrieve.mockResolvedValue({ ...paidSession(), payment_status: 'unpaid' });
    await expect(resolveThankYouStatus('cs_test_abc')).resolves.toBe('pending');
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('spør ikke Stripe når raden allerede er betalt', async () => {
    row.status = 'paid';
    await expect(resolveThankYouStatus('cs_test_abc')).resolves.toBe('paid');
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('webhook etter avstemming gir samme dedupe-nøkkel (én kvittering)', async () => {
    retrieve.mockResolvedValue(paidSession());
    await resolveThankYouStatus('cs_test_abc');
    const webhook = mapStripeEvent({
      id: 'evt_real',
      type: 'checkout.session.completed',
      data: { object: paidSession() },
    });
    await applyPaymentEvent(webhook!);
    const keys = emitEvent.mock.calls.map((c) => (c as unknown as [{ dedupeKey: string }])[0].dedupeKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(prisma.registration.update).toHaveBeenCalledTimes(2);
    expect(row.status).toBe('paid');
  });

  it('ukjent ref gir not_found', async () => {
    await expect(resolveThankYouStatus('cs_test_finnes_ikke')).resolves.toBe('not_found');
    await expect(resolveThankYouStatus(undefined)).resolves.toBe('not_found');
  });
});

describe('resolveThankYouStatus — Vipps', () => {
  beforeEach(() => {
    row.provider = 'vipps';
    row.ref = 'reg-5-abcd1234';
  });

  it('avbrutt i Vipps vises som avbrutt, ikke «behandles»', async () => {
    getVippsPayment.mockResolvedValue({ state: 'ABORTED', amountOre: 150000 });
    await expect(resolveThankYouStatus('reg-5-abcd1234')).resolves.toBe('aborted');
    expect(row.status).toBe('failed');
  });

  it('AUTHORIZED anvendes som betalt', async () => {
    getVippsPayment.mockResolvedValue({ state: 'AUTHORIZED', amountOre: 150000 });
    await expect(resolveThankYouStatus('reg-5-abcd1234')).resolves.toBe('paid');
    expect(emitEvent).toHaveBeenCalledTimes(1);
  });

  it('CREATED vises som under behandling', async () => {
    getVippsPayment.mockResolvedValue({ state: 'CREATED', amountOre: 150000 });
    await expect(resolveThankYouStatus('reg-5-abcd1234')).resolves.toBe('pending');
  });

  it('prøver den andre modusen når betalingen ikke finnes i gjeldende', async () => {
    getVippsPayment.mockResolvedValueOnce('not_found').mockResolvedValueOnce({ state: 'AUTHORIZED', amountOre: 1 });
    await expect(resolveThankYouStatus('reg-5-abcd1234')).resolves.toBe('paid');
    expect(getVippsPayment.mock.calls.map((c) => c[1])).toEqual([false, true]);
  });

  it('AUTHORIZED og CAPTURED gir samme dedupe-nøkkel', async () => {
    await applyPaymentEvent(mapVippsEvent({ reference: 'reg-5-abcd1234', name: 'AUTHORIZED' })!);
    await applyPaymentEvent(mapVippsEvent({ reference: 'reg-5-abcd1234', name: 'CAPTURED' })!);
    const keys = emitEvent.mock.calls.map((c) => (c as unknown as [{ dedupeKey: string }])[0].dedupeKey);
    expect(new Set(keys).size).toBe(1);
  });
});
