/**
 * Stripe-webhooken verifiseres mot både live- og test-secret, uavhengig av
 * dagens payment_test_mode.
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
    const event = verifyStripeWebhook(payload, header);
    expect(event?.id).toBe('evt_1');
    expect(event?.livemode).toBe(false);
  });

  it('godtar events signert med live-secret', () => {
    process.env.STRIPE_WEBHOOK_SECRET = LIVE;
    process.env.STRIPE_WEBHOOK_SECRET_TEST = TEST;
    const { payload, header } = signed(LIVE, true);
    expect(verifyStripeWebhook(payload, header)?.livemode).toBe(true);
  });

  it('virker når bare én secret er satt', () => {
    process.env.STRIPE_WEBHOOK_SECRET = LIVE;
    delete process.env.STRIPE_WEBHOOK_SECRET_TEST;
    const { payload, header } = signed(LIVE, true);
    expect(verifyStripeWebhook(payload, header)).not.toBeNull();
  });

  it('avviser ukjent secret, manglende signatur og manglende konfig', () => {
    process.env.STRIPE_WEBHOOK_SECRET = LIVE;
    process.env.STRIPE_WEBHOOK_SECRET_TEST = TEST;
    const { payload, header } = signed('whsec_annen', true);
    expect(verifyStripeWebhook(payload, header)).toBeNull();
    expect(verifyStripeWebhook(payload, null)).toBeNull();
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET_TEST;
    expect(verifyStripeWebhook(payload, header)).toBeNull();
  });
});

describe('stripeSessionTestMode', () => {
  it('leser modus fra sesjons-IDen', () => {
    expect(stripeSessionTestMode('cs_test_a1')).toBe(true);
    expect(stripeSessionTestMode('cs_live_a1')).toBe(false);
    expect(stripeSessionTestMode('reg-1-abcd')).toBeNull();
  });
});
