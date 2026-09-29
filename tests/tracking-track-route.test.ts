/**
 * /api/track: CORS-allowlist, preflight, cookie-matching, størrelsesgrense og
 * at bjerke.no-hendelser lagres med source 'web', meta.site og delt cookie.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { prisma, emitEvent } = vi.hoisted(() => ({
  prisma: {
    visitor: { findUnique: vi.fn(), create: vi.fn(), findUniqueOrThrow: vi.fn() },
    contact: { findUnique: vi.fn() },
  },
  emitEvent: vi.fn(async () => {}),
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn(async () => null) }));
vi.mock('@/lib/events/bus', () => ({ emitEvent }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async () => 'https://bjerke.no,https://www.bjerke.no') }));

import { OPTIONS, POST } from '@/app/api/track/route';

const ID = '11111111-1111-4111-8111-111111111111';

function req(method: string, { origin, cookie, body }: { origin?: string; cookie?: string; body?: string } = {}) {
  const headers = new Headers({ host: 'registrering.bjerke.no', 'x-forwarded-proto': 'https' });
  if (origin) headers.set('origin', origin);
  if (cookie) headers.set('cookie', cookie);
  return new NextRequest('https://registrering.bjerke.no/api/track', { method, headers, body });
}

const pageView = JSON.stringify({ type: 'page.viewed', publicId: ID, meta: { url: 'https://bjerke.no/?e=a@b.no' } });

beforeEach(() => {
  vi.clearAllMocks();
  prisma.visitor.findUnique.mockResolvedValue({ id: 7, contactId: null });
});

describe('OPTIONS /api/track', () => {
  it('preflight for tillatt origin gir eksakt origin med credentials', async () => {
    const res = await OPTIONS(req('OPTIONS', { origin: 'https://bjerke.no' }));
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://bjerke.no');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('avviser ukjent origin uten CORS-headere', async () => {
    const res = await OPTIONS(req('OPTIONS', { origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('POST /api/track', () => {
  it('bjerke.no-hendelse lagres som web med site og renset URL, og fornyer delt cookie', async () => {
    const res = await POST(req('POST', { origin: 'https://bjerke.no', cookie: `bjerke_vid=${ID}`, body: pageView }));
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://bjerke.no');
    expect(res.headers.get('set-cookie')).toMatch(/bjerke_vid=.*Domain=\.bjerke\.no; Secure/);
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'page.viewed',
        source: 'web',
        visitorId: 7,
        meta: { site: 'bjerke.no', path: '/', url: 'https://bjerke.no/' },
      }),
    );
  });

  it('samme-origin fra appen er site=registrering', async () => {
    await POST(req('POST', { origin: 'https://registrering.bjerke.no', cookie: `bjerke_vid=${ID}`, body: pageView }));
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ meta: expect.objectContaining({ site: 'registrering' }) }));
  });

  it('ukjent origin skriver ingenting', async () => {
    const res = await POST(req('POST', { origin: 'https://evil.example', cookie: `bjerke_vid=${ID}`, body: pageView }));
    expect(res.status).toBe(403);
    expect(prisma.visitor.findUnique).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('krever at cookien matcher publicId (godtar én av duplikatene)', async () => {
    const miss = await POST(req('POST', { origin: 'https://bjerke.no', body: pageView }));
    expect(miss.status).toBe(204);
    expect(emitEvent).not.toHaveBeenCalled();

    await POST(
      req('POST', {
        origin: 'https://bjerke.no',
        cookie: `bjerke_vid=22222222-2222-4222-8222-222222222222; bjerke_vid=${ID}`,
        body: pageView,
      }),
    );
    expect(emitEvent).toHaveBeenCalledTimes(1);
  });

  it('avviser serverhendelser, for store og ugyldige kropper', async () => {
    const cookie = `bjerke_vid=${ID}`;
    const origin = 'https://bjerke.no';
    const server = JSON.stringify({ type: 'payment.succeeded', publicId: ID });
    expect((await POST(req('POST', { origin, cookie, body: server }))).status).toBe(400);
    expect((await POST(req('POST', { origin, cookie, body: 'x'.repeat(5000) }))).status).toBe(413);
    expect((await POST(req('POST', { origin, cookie, body: '{' }))).status).toBe(400);
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('oppretter ny besøker første gang', async () => {
    prisma.visitor.findUnique.mockResolvedValue(null);
    prisma.visitor.create.mockResolvedValue({ id: 9, contactId: null });
    await POST(req('POST', { origin: 'https://bjerke.no', cookie: `bjerke_vid=${ID}`, body: pageView }));
    expect(prisma.visitor.create).toHaveBeenCalledWith(expect.objectContaining({ data: { publicId: ID } }));
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ visitorId: 9 }));
  });
});
