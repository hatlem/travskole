/**
 * Magic link og passord-reset slår opp e-posten fra tokenet — lenkene bærer
 * ikke lenger e-postadressen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    verificationToken: { findUnique: vi.fn(), deleteMany: vi.fn(async () => ({ count: 1 })), delete: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({ hashPassword: vi.fn(async () => 'hashed') }));
vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { emailFromMagicLinkIdentifier, emailFromResetIdentifier, hashToken } from '@/lib/auth-tokens';
import { POST as resetPassword } from '@/app/api/auth/reset-password/route';

function resetRequest(body: unknown) {
  return new Request('https://registrering.bjerke.no/api/auth/reset-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('identifier-parsing', () => {
  it('magic link', () => {
    expect(emailFromMagicLinkIdentifier('magiclink:kari@example.no')).toBe('kari@example.no');
    expect(emailFromMagicLinkIdentifier('kari@example.no')).toBeNull();
    expect(emailFromMagicLinkIdentifier('emailchange:1:kari@example.no')).toBeNull();
  });

  it('passord-reset', () => {
    expect(emailFromResetIdentifier('kari@example.no')).toBe('kari@example.no');
    expect(emailFromResetIdentifier('magiclink:kari@example.no')).toBeNull();
    expect(emailFromResetIdentifier('emailchange:1:kari@example.no')).toBeNull();
  });
});

describe('POST /api/auth/reset-password', () => {
  it('finner brukeren fra tokenet alene', async () => {
    prisma.verificationToken.findUnique.mockResolvedValue({
      identifier: 'kari@example.no',
      token: hashToken('raw'),
      expires: new Date(Date.now() + 60_000),
    });
    prisma.user.findUnique.mockResolvedValue({ id: 7 });

    const res = await resetPassword(resetRequest({ token: 'raw', password: 'NyttPassord1' }));
    expect(res.status).toBe(200);
    expect(prisma.verificationToken.findUnique).toHaveBeenCalledWith({ where: { token: hashToken('raw') } });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'kari@example.no' } });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { passwordHash: 'hashed' } });
  });

  it('avviser et magic-link-token brukt som reset-token', async () => {
    prisma.verificationToken.findUnique.mockResolvedValue({
      identifier: 'magiclink:kari@example.no',
      token: hashToken('raw'),
      expires: new Date(Date.now() + 60_000),
    });
    const res = await resetPassword(resetRequest({ token: 'raw', password: 'NyttPassord1' }));
    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('avviser ukjent token', async () => {
    prisma.verificationToken.findUnique.mockResolvedValue(null);
    const res = await resetPassword(resetRequest({ token: 'x', password: 'NyttPassord1' }));
    expect(res.status).toBe(400);
  });
});
