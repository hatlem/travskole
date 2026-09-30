/**
 * Per-handling rate limiting: magic link, glemt passord og innloggede
 * kontohandlinger deler ikke lenger én kvote.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, issueMagicLink, getServerSession } = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn() },
    verificationToken: { deleteMany: vi.fn(), create: vi.fn() },
  },
  issueMagicLink: vi.fn(async () => {}),
  getServerSession: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/magic-link', () => ({ issueMagicLink }));
vi.mock('@/lib/mail', () => ({ sendPasswordResetEmail: vi.fn(async () => {}) }));
vi.mock('@/lib/auth', () => ({
  getServerSession,
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(async () => false),
}));

import {
  checkRateLimit,
  ipEmailKey,
  magicLinkEmailLimiter,
  passwordResetEmailLimiter,
} from '@/lib/rate-limiter';
import { POST as magicLink } from '@/app/api/auth/magic-link/route';
import { POST as forgotPassword } from '@/app/api/auth/forgot-password/route';
import { PUT as changePassword } from '@/app/api/dashboard/password/route';
import { NextRequest } from 'next/server';

function post(url: string, ip: string, body: unknown, method = 'POST') {
  return new NextRequest(`https://registrering.bjerke.no${url}`, {
    method,
    headers: { 'x-forwarded-for': `${ip}:51234`, 'x-client-ip': ip, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue(null);
});

describe('ipEmailKey', () => {
  it('normaliserer e-posten', () => {
    expect(ipEmailKey('1.2.3.4', '  Ola@Example.NO ')).toBe('1.2.3.4:ola@example.no');
  });
});

describe('separate limitere', () => {
  it('å bruke opp magic-link-kvoten påvirker ikke glemt passord', async () => {
    const key = ipEmailKey('9.9.9.9', 'a@b.no');
    for (let i = 0; i < 3; i++) {
      expect((await checkRateLimit(magicLinkEmailLimiter, key)).allowed).toBe(true);
    }
    expect((await checkRateLimit(magicLinkEmailLimiter, key)).allowed).toBe(false);
    expect((await checkRateLimit(passwordResetEmailLimiter, key)).allowed).toBe(true);
  });
});

describe('POST /api/auth/magic-link', () => {
  it('begrenser per e-post, men lar samme IP be om lenke til en annen adresse', async () => {
    const ip = '10.0.0.1';
    for (let i = 0; i < 3; i++) {
      expect((await magicLink(post('/api/auth/magic-link', ip, { email: 'x@y.no' }))).status).toBe(200);
    }
    expect((await magicLink(post('/api/auth/magic-link', ip, { email: 'X@y.no' }))).status).toBe(429);
    expect((await magicLink(post('/api/auth/magic-link', ip, { email: 'z@y.no' }))).status).toBe(200);
  });

  it('har et tak per IP på tvers av adresser', async () => {
    const ip = '10.0.0.2';
    for (let i = 0; i < 10; i++) {
      expect((await magicLink(post('/api/auth/magic-link', ip, { email: `u${i}@y.no` }))).status).toBe(200);
    }
    expect((await magicLink(post('/api/auth/magic-link', ip, { email: 'ny@y.no' }))).status).toBe(429);
  });

  it('deler ikke kvote med glemt passord', async () => {
    const ip = '10.0.0.3';
    for (let i = 0; i < 3; i++) {
      await magicLink(post('/api/auth/magic-link', ip, { email: 'q@y.no' }));
    }
    expect((await forgotPassword(post('/api/auth/forgot-password', ip, { email: 'q@y.no' }))).status).toBe(200);
  });
});

describe('klient-IP bak Azure App Service', () => {
  it('kan ikke omgås ved å rotere X-Forwarded-For eller cf-connecting-ip', async () => {
    const forged = (i: number) =>
      new NextRequest('https://registrering.bjerke.no/api/auth/magic-link', {
        method: 'POST',
        headers: {
          'x-forwarded-for': `10.9.0.${i}, 10.0.0.9:51234`,
          'x-client-ip': '10.0.0.9',
          'cf-connecting-ip': `10.8.0.${i}`,
          'x-real-ip': `10.7.0.${i}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email: `rot${i}@y.no` }),
      });
    for (let i = 0; i < 10; i++) expect((await magicLink(forged(i))).status).toBe(200);
    expect((await magicLink(forged(10))).status).toBe(429);
  });
});

describe('PUT /api/dashboard/password', () => {
  it('nøkles på bruker, ikke IP', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 1, passwordHash: 'h', anonymizedAt: null, deactivatedAt: null });
    getServerSession.mockResolvedValue({ user: { id: '41', email: 'a@b.no' } });
    const body = { currentPassword: 'feil-passord', newPassword: 'NyttPassord123!' };
    for (let i = 0; i < 5; i++) {
      expect((await changePassword(post('/api/dashboard/password', `1.1.1.${i}`, body, 'PUT'))).status).toBe(400);
    }
    expect((await changePassword(post('/api/dashboard/password', '2.2.2.2', body, 'PUT'))).status).toBe(429);

    getServerSession.mockResolvedValue({ user: { id: '42', email: 'c@d.no' } });
    expect((await changePassword(post('/api/dashboard/password', '2.2.2.2', body, 'PUT'))).status).toBe(400);
  });
});
