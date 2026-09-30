/**
 * Passordinnlogging: tak per konto uavhengig av IP, i tillegg til IP+e-post.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, verifyPassword } = vi.hoisted(() => ({
  prisma: { user: { findUnique: vi.fn() }, verificationToken: { findFirst: vi.fn(), delete: vi.fn() } },
  verifyPassword: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({ verifyPassword }));
vi.mock('@/lib/logger', () => ({ logFailedLogin: vi.fn() }));
vi.mock('@/lib/events/bus', () => ({ emitEvent: vi.fn(), stitchVisitorToContact: vi.fn(), VISITOR_COOKIE: 'v' }));

import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { loginAccountLimiter, loginLimiter } from '@/lib/rate-limiter';

type Authorize = (credentials: Record<string, string>, req: { headers: Record<string, string> }) => Promise<unknown>;
const passwordProvider = authOptions.providers.find(
  (p) => (p as { options?: { credentials?: Record<string, unknown> } }).options?.credentials?.password,
) as unknown as { options: { authorize: Authorize } };

const EMAIL = 'forelder@example.no';
const login = (password: string, ip: string) =>
  passwordProvider.options.authorize({ email: EMAIL, password }, { headers: { 'x-client-ip': ip } });

beforeEach(async () => {
  vi.clearAllMocks();
  await loginAccountLimiter.delete(EMAIL);
  for (let i = 0; i < 20; i++) await loginLimiter.delete(`10.1.0.${i}:${EMAIL}`);
  prisma.user.findUnique.mockResolvedValue({ id: 1, email: EMAIL, role: 'PARENT', passwordHash: 'h', parent: null });
  verifyPassword.mockImplementation(async (password: string) => password === 'riktig');
});

describe('per-konto-tak for passordinnlogging', () => {
  it('stenger kontoen etter 10 forsøk fra roterende adresser, også for riktig passord', async () => {
    for (let i = 0; i < 10; i++) {
      await expect(login('feil', `10.1.0.${i}`)).rejects.toThrow('Feil e-post eller passord');
    }
    await expect(login('riktig', '10.1.0.11')).rejects.toThrow(/For mange/);
  });

  it('nullstilles etter vellykket innlogging', async () => {
    for (let i = 0; i < 9; i++) await expect(login('feil', `10.1.0.${i}`)).rejects.toThrow();
    await expect(login('riktig', '10.1.0.12')).resolves.toMatchObject({ email: EMAIL });
    for (let i = 0; i < 9; i++) await expect(login('feil', `10.1.0.${i}`)).rejects.toThrow();
    await expect(login('riktig', '10.1.0.13')).resolves.toMatchObject({ email: EMAIL });
  });

  it('teller også ukjente e-poster, så taket ikke avslører hvilke kontoer som finnes', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    for (let i = 0; i < 10; i++) await expect(login('feil', `10.1.0.${i}`)).rejects.toThrow('Feil e-post eller passord');
    await expect(login('feil', '10.1.0.14')).rejects.toThrow(/For mange/);
  });
});
