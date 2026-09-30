/**
 * Stripe-webhooken verifiseres mot både live- og test-secret, uavhengig av
 * dagens payment_test_mode, og eventets livemode må matche secreten.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import Stripe from 'stripe';

vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { verifyStripeWebhook, stripeSessionTestMode } from '@/lib/payments/stripe';

const LIVE = 'whsec_live_secret';
const TEST = 'whsec_test_secret';
const orig = { live: process.env.STRIPE_WEBHOOK_SECRET, test: process.env.STRIPE_WEBHOOK_SECRET_TEST };

function signed(secret: string, livemode: boolean) {
  const payload = JSON.stringify({
    id: 'evt_1',
    type: 'checkout.session.completed',
    livemode,
    data: { object: { id: 'cs_test_1' } },
  });
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  return { payload, header };
}

afterEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = orig.live;
  process.env.STRIPE_WEBHOOK_SECRET_TEST = orig.test;
});

describe('verifyStripeWebhook', () => {
  it('godtar events signert med test-secret', () => {
    process.env.STRIPE_WEBHOOK_SECRET = LIVE;
    process.env.STRIPE_WEBHOOK_SECRET_TEST = TEST;
    const { payload, header } = signed(TEST, false);
    const result = verifyStripeWebhook(payload, header);
    expect(result.ok && result.event.id).toBe('evt_1');
    expect(result.ok && result.event.livemode).toBe(false);
  });

  it('godtar events signert med live-secret', () => {
    process.env.STRIPE_WEBHOOK_SECRET = LIVE;
    process.env.STRIPE_WEBHOOK_SECRET_TEST = TEST;
    const { payload, header } = signed(LIVE, true);
    const result = verifyStripeWebhook(payload, header);
    expect(result.ok && result.event.livemode).toBe(true);
  });

  it('virker når bare én secret er satt', () => {
    process.env.STRIPE_WEBHOOK_SECRET = LIVE;
    delete process.env.STRIPE_WEBHOOK_SECRET_TEST;
    const { payload, header } = signed(LIVE, true);
    expect(verifyStripeWebhook(payload, header).ok).toBe(true);
  });

  it('avviser ukjent secret, manglende signatur og manglende konfig', () => {
    process.env.STRIPE_WEBHOOK_SECRET = LIVE;
    process.env.STRIPE_WEBHOOK_SECRET_TEST = TEST;
    const { payload, header } = signed('whsec_annen', true);
    const invalid = { ok: false, reason: 'invalid_signature' };
    expect(verifyStripeWebhook(payload, header)).toEqual(invalid);
    expect(verifyStripeWebhook(payload, null)).toEqual(invalid);
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET_TEST;
    expect(verifyStripeWebhook(payload, header)).toEqual(invalid);
  });

  it('avviser live-event signert med test-secret', () => {
    process.env.STRIPE_WEBHOOK_SECRET = LIVE;
    process.env.STRIPE_WEBHOOK_SECRET_TEST = TEST;
    const { payload, header } = signed(TEST, true);
    expect(verifyStripeWebhook(payload, header)).toEqual({ ok: false, reason: 'mode_mismatch' });
  });

  it('avviser test-event signert med live-secret', () => {
    process.env.STRIPE_WEBHOOK_SECRET = LIVE;
    process.env.STRIPE_WEBHOOK_SECRET_TEST = TEST;
    const { payload, header } = signed(LIVE, false);
    expect(verifyStripeWebhook(payload, header)).toEqual({ ok: false, reason: 'mode_mismatch' });
  });

  it('godtar riktig modus når samme secret er satt for begge', () => {
    process.env.STRIPE_WEBHOOK_SECRET = TEST;
    process.env.STRIPE_WEBHOOK_SECRET_TEST = TEST;
    const { payload, header } = signed(TEST, false);
    expect(verifyStripeWebhook(payload, header).ok).toBe(true);
  });
});

describe('stripeSessionTestMode', () => {
  it('leser modus fra sesjons-IDen', () => {
    expect(stripeSessionTestMode('cs_test_a1')).toBe(true);
    expect(stripeSessionTestMode('cs_live_a1')).toBe(false);
    expect(stripeSessionTestMode('reg-1-abcd')).toBeNull();
  });
});
