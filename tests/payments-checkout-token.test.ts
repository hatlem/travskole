import crypto from 'crypto';
import { describe, it, expect } from 'vitest';
import { signCheckoutToken, verifyCheckoutToken } from '@/lib/payments/checkout-token';

/**
 * Signed checkout tokens give an anonymous registrant (no session) a way to
 * prove ownership of the registration/booking row they just created, so
 * POST /api/payments/checkout can authorize them without a login.
 *
 * Payload: `${kind}.${id}.${expMs}` base64url + `.` + base64url
 * HMAC-SHA256(secret, payload). Secret defaults to NEXTAUTH_SECRET.
 */
const SECRET = 'test-checkout-token-secret-xyz';
const NOW = 1_800_000_000_000;

describe('signCheckoutToken / verifyCheckoutToken', () => {
  it('round-trips a valid token', () => {
    const token = signCheckoutToken({ kind: 'registration', id: 42, expMs: NOW + 60_000 }, SECRET);
    expect(verifyCheckoutToken(token, NOW, SECRET)).toEqual({ kind: 'registration', id: 42 });
  });

  it('round-trips a booking token', () => {
    const token = signCheckoutToken({ kind: 'booking', id: 7, expMs: NOW + 60_000 }, SECRET);
    expect(verifyCheckoutToken(token, NOW, SECRET)).toEqual({ kind: 'booking', id: 7 });
  });

  it('rejects a tampered payload', () => {
    const token = signCheckoutToken({ kind: 'registration', id: 42, expMs: NOW + 60_000 }, SECRET);
    const [payloadB64, sigB64] = token.split('.');
    const tamperedPayload = Buffer.from(`registration.999.${NOW + 60_000}`).toString('base64url');
    expect(tamperedPayload).not.toBe(payloadB64);
    const tampered = `${tamperedPayload}.${sigB64}`;
    expect(verifyCheckoutToken(tampered, NOW, SECRET)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const token = signCheckoutToken({ kind: 'registration', id: 42, expMs: NOW + 60_000 }, SECRET);
    const [payloadB64, sigB64] = token.split('.');
    const flippedSig = sigB64.slice(0, -1) + (sigB64.endsWith('A') ? 'B' : 'A');
    const tampered = `${payloadB64}.${flippedSig}`;
    expect(verifyCheckoutToken(tampered, NOW, SECRET)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = signCheckoutToken({ kind: 'registration', id: 42, expMs: NOW - 1 }, SECRET);
    expect(verifyCheckoutToken(token, NOW, SECRET)).toBeNull();
  });

  it('accepts a token exactly at the expiry boundary', () => {
    const token = signCheckoutToken({ kind: 'registration', id: 42, expMs: NOW }, SECRET);
    expect(verifyCheckoutToken(token, NOW, SECRET)).toEqual({ kind: 'registration', id: 42 });
  });

  it('rejects garbage input without throwing', () => {
    expect(verifyCheckoutToken('', NOW, SECRET)).toBeNull();
    expect(verifyCheckoutToken('not-a-token', NOW, SECRET)).toBeNull();
    expect(verifyCheckoutToken('a.b.c.d', NOW, SECRET)).toBeNull();
    expect(verifyCheckoutToken('....', NOW, SECRET)).toBeNull();
    expect(verifyCheckoutToken('%%%.%%%', NOW, SECRET)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = signCheckoutToken({ kind: 'registration', id: 42, expMs: NOW + 60_000 }, 'other-secret');
    expect(verifyCheckoutToken(token, NOW, SECRET)).toBeNull();
  });

  it('rejects an unknown kind', () => {
    const payload = `voucher.42.${NOW + 60_000}`;
    const payloadB64 = Buffer.from(payload).toString('base64url');
    const sig = crypto.createHmac('sha256', SECRET).update(payload).digest();
    const sigB64 = sig.toString('base64url');
    expect(verifyCheckoutToken(`${payloadB64}.${sigB64}`, NOW, SECRET)).toBeNull();
  });

  it('rejects a non-integer id', () => {
    const payload = `registration.4.2.${NOW + 60_000}`;
    // Forces a segments.length mismatch scenario is covered elsewhere; here
    // we target a non-integer numeric-looking id directly via a crafted payload.
    const badIdPayload = `registration.abc.${NOW + 60_000}`;
    const payloadB64 = Buffer.from(badIdPayload).toString('base64url');
    const sig = crypto.createHmac('sha256', SECRET).update(badIdPayload).digest();
    const sigB64 = sig.toString('base64url');
    expect(verifyCheckoutToken(`${payloadB64}.${sigB64}`, NOW, SECRET)).toBeNull();
    void payload;
  });

  it('signCheckoutToken defaults secret to NEXTAUTH_SECRET and throws when absent', () => {
    const original = process.env.NEXTAUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    try {
      expect(() => signCheckoutToken({ kind: 'registration', id: 1, expMs: NOW + 1000 })).toThrow();
    } finally {
      if (original !== undefined) process.env.NEXTAUTH_SECRET = original;
    }
  });

  it('verifyCheckoutToken defaults secret to NEXTAUTH_SECRET and returns null when absent', () => {
    const original = process.env.NEXTAUTH_SECRET;
    process.env.NEXTAUTH_SECRET = SECRET;
    const token = signCheckoutToken({ kind: 'registration', id: 1, expMs: NOW + 1000 });
    delete process.env.NEXTAUTH_SECRET;
    try {
      expect(verifyCheckoutToken(token, NOW)).toBeNull();
    } finally {
      if (original !== undefined) process.env.NEXTAUTH_SECRET = original;
    }
  });
});
