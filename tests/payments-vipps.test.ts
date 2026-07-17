import crypto from 'crypto';
import { describe, it, expect } from 'vitest';
import { verifyVippsWebhook } from '@/lib/payments/vipps';

/**
 * Synthetic vectors for the Vipps webhook signature scheme, built with
 * node:crypto against a known secret — no network/SDK involved.
 *
 * Per Vipps' webhook signature spec, the signed string is:
 *   POST\n{path}\n{date};{host};{contentSha256}
 * HMAC-SHA256'd with the raw webhook secret bytes, base64-encoded, and
 * carried in `Authorization: HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=<base64>`.
 */
const SECRET = 'test-webhook-secret-abc123';
const HOST = 'registrering.bjerke.no';
const PATH = '/api/webhooks/vipps';
const NOW = new Date('2026-01-01T12:00:00.000Z');

function buildVector(body: string, date: string) {
  const contentSha256 = crypto.createHash('sha256').update(body).digest('base64');
  const canonical = `POST\n${PATH}\n${date};${HOST};${contentSha256}`;
  const signature = crypto.createHmac('sha256', SECRET).update(canonical).digest('base64');
  const authorization = `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`;
  return { date, contentSha256, authorization };
}

const opts = { secret: SECRET, now: NOW, host: HOST, path: PATH };

describe('verifyVippsWebhook', () => {
  it('accepts a valid triple', () => {
    const body = '{"reference":"ref-1","name":"AUTHORIZED"}';
    const headers = buildVector(body, NOW.toISOString());
    expect(verifyVippsWebhook(body, headers, opts)).toBe(true);
  });

  it('rejects when the body is tampered (contentSha256 no longer matches)', () => {
    const body = '{"reference":"ref-1","name":"AUTHORIZED"}';
    const headers = buildVector(body, NOW.toISOString());
    const tamperedBody = '{"reference":"ref-1","name":"CAPTURED"}';
    expect(verifyVippsWebhook(tamperedBody, headers, opts)).toBe(false);
  });

  it('rejects when the signature is tampered (single byte flip)', () => {
    const body = '{"reference":"ref-1","name":"AUTHORIZED"}';
    const headers = buildVector(body, NOW.toISOString());
    const flipped = headers.authorization.slice(0, -1) + (headers.authorization.endsWith('A') ? 'B' : 'A');
    expect(verifyVippsWebhook(body, { ...headers, authorization: flipped }, opts)).toBe(false);
  });

  it('rejects when the date header is tampered post-signing', () => {
    const body = '{"reference":"ref-1","name":"AUTHORIZED"}';
    const signedDate = NOW.toISOString();
    const headers = buildVector(body, signedDate);
    // Shifted a couple seconds — still within the 5-minute freshness window,
    // so this isolates signature invalidity from staleness rejection.
    const tamperedDate = new Date(NOW.getTime() + 2000).toISOString();
    expect(verifyVippsWebhook(body, { ...headers, date: tamperedDate }, opts)).toBe(false);
  });

  it('rejects when any header is missing', () => {
    const body = '{"reference":"ref-1","name":"AUTHORIZED"}';
    const headers = buildVector(body, NOW.toISOString());
    expect(verifyVippsWebhook(body, { ...headers, date: null }, opts)).toBe(false);
    expect(verifyVippsWebhook(body, { ...headers, contentSha256: null }, opts)).toBe(false);
    expect(verifyVippsWebhook(body, { ...headers, authorization: null }, opts)).toBe(false);
  });

  it('rejects a stale date beyond the 5-minute window', () => {
    const body = '{"reference":"ref-1","name":"AUTHORIZED"}';
    const signedDate = NOW.toISOString();
    const headers = buildVector(body, signedDate);
    const farFuture = new Date(NOW.getTime() + 6 * 60 * 1000);
    expect(verifyVippsWebhook(body, headers, { ...opts, now: farFuture })).toBe(false);
  });

  it('rejects an unparseable date header', () => {
    const body = '{"reference":"ref-1","name":"AUTHORIZED"}';
    const headers = buildVector(body, NOW.toISOString());
    expect(verifyVippsWebhook(body, { ...headers, date: 'not-a-date' }, opts)).toBe(false);
  });

  it('rejects a malformed Authorization header (no Signature=)', () => {
    const body = '{"reference":"ref-1","name":"AUTHORIZED"}';
    const headers = buildVector(body, NOW.toISOString());
    expect(
      verifyVippsWebhook(body, { ...headers, authorization: 'HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256' }, opts)
    ).toBe(false);
  });

  it('rejects when signed with the wrong secret', () => {
    const body = '{"reference":"ref-1","name":"AUTHORIZED"}';
    const headers = buildVector(body, NOW.toISOString());
    expect(verifyVippsWebhook(body, headers, { ...opts, secret: 'wrong-secret' })).toBe(false);
  });

  it('rejects when no secret is configured', () => {
    const originalEnvSecret = process.env.VIPPS_WEBHOOK_SECRET;
    delete process.env.VIPPS_WEBHOOK_SECRET;
    try {
      const body = '{"reference":"ref-1","name":"AUTHORIZED"}';
      const headers = buildVector(body, NOW.toISOString());
      expect(verifyVippsWebhook(body, headers, { ...opts, secret: undefined })).toBe(false);
    } finally {
      process.env.VIPPS_WEBHOOK_SECRET = originalEnvSecret;
    }
  });
});
