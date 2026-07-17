import { describe, it, expect, afterEach } from 'vitest';
import {
  parsePaymentMethods,
  serializePaymentMethods,
  isTestMode,
  stripeSecretKey,
  stripePublishableKey,
  isStripeConfigured,
  kronerToOre,
  STRIPE_PUBLISHABLE_KEYS,
} from '@/lib/payments';

describe('parsePaymentMethods', () => {
  it('defaults to faktura when empty/invalid', () => {
    expect(parsePaymentMethods(null)).toEqual(['faktura']);
    expect(parsePaymentMethods('')).toEqual(['faktura']);
    expect(parsePaymentMethods('bogus')).toEqual(['faktura']);
  });
  it('parses valid methods and dedupes', () => {
    expect(parsePaymentMethods('faktura,stripe')).toEqual(['faktura', 'stripe']);
    expect(parsePaymentMethods('stripe, stripe ,faktura')).toEqual(['stripe', 'faktura']);
    expect(parsePaymentMethods('stripe,vipps')).toEqual(['stripe', 'vipps']);
  });
  it('drops unknown methods', () => {
    expect(parsePaymentMethods('stripe,bogus')).toEqual(['stripe']);
  });
});

describe('serializePaymentMethods', () => {
  it('normalizes and falls back to faktura', () => {
    expect(serializePaymentMethods([])).toBe('faktura');
    expect(serializePaymentMethods(['bogus'])).toBe('faktura');
    expect(serializePaymentMethods(['stripe', 'faktura'])).toBe('stripe,faktura');
    expect(serializePaymentMethods(['stripe', 'stripe'])).toBe('stripe');
  });
});

describe('isTestMode', () => {
  it('true only for the string "true"', () => {
    expect(isTestMode('true')).toBe(true);
    expect(isTestMode('false')).toBe(false);
    expect(isTestMode(null)).toBe(false);
    expect(isTestMode(undefined)).toBe(false);
  });
});

describe('kronerToOre', () => {
  it('converts kroner to integer øre', () => {
    expect(kronerToOre(2500)).toBe(250000);
    expect(kronerToOre(0)).toBe(0);
    expect(kronerToOre(49.9)).toBe(4990);
  });
});

describe('stripe key selection', () => {
  const orig = { live: process.env.STRIPE_SECRET_KEY, test: process.env.STRIPE_SECRET_KEY_TEST };
  afterEach(() => {
    process.env.STRIPE_SECRET_KEY = orig.live;
    process.env.STRIPE_SECRET_KEY_TEST = orig.test;
  });

  it('publishable key follows mode', () => {
    expect(stripePublishableKey(false)).toBe(STRIPE_PUBLISHABLE_KEYS.live);
    expect(stripePublishableKey(true)).toBe(STRIPE_PUBLISHABLE_KEYS.test);
  });

  it('secret key + configured follow mode + env presence', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_x';
    delete process.env.STRIPE_SECRET_KEY_TEST;
    expect(stripeSecretKey(false)).toBe('sk_live_x');
    expect(isStripeConfigured(false)).toBe(true);
    expect(stripeSecretKey(true)).toBeUndefined();
    expect(isStripeConfigured(true)).toBe(false);
  });
});
