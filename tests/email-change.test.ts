import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit coverage for e-postbyttet (lib/email-change.ts): at tokenet brukes opp
 * uansett utfall, at utløpte lenker avvises, og at et bytte til en adresse som
 * er blitt opptatt i mellomtiden ikke går gjennom.
 */

const { prisma } = vi.hoisted(() => ({
  prisma: {
    verificationToken: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/mail', () => ({
  sendEmailChangeVerification: vi.fn(async () => {}),
  sendEmailChangeNotice: vi.fn(async () => {}),
}));

import { consumeEmailChangeToken, issueEmailChange, parseIdentifier } from '@/lib/email-change';
import { sendEmailChangeVerification, sendEmailChangeNotice } from '@/lib/mail';

const activeUser = { id: 4, anonymizedAt: null, deactivatedAt: null };
const future = new Date(Date.now() + 60_000);
const pastDate = new Date(Date.now() - 60_000);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('parseIdentifier', () => {
  it('reads user and address back out', () => {
    expect(parseIdentifier('emailchange:4:ny@example.com')).toEqual({
      userId: 4,
      newEmail: 'ny@example.com',
    });
  });

  it('ignores identifiers from other namespaces', () => {
    expect(parseIdentifier('magiclink:ny@example.com')).toBeNull();
    expect(parseIdentifier('emailchange:4')).toBeNull();
    expect(parseIdentifier('emailchange::ny@example.com')).toBeNull();
  });
});

describe('issueEmailChange', () => {
  it('replaces earlier requests, mails the new address and warns the old one', async () => {
    await issueEmailChange(4, 'gammel@example.com', 'ny@example.com');

    expect(prisma.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { identifier: { startsWith: 'emailchange:4:' } },
    });
    const created = prisma.verificationToken.create.mock.calls[0][0].data;
    expect(created.identifier).toBe('emailchange:4:ny@example.com');
    // Kun hashen lagres — aldri rå-tokenet fra e-posten.
    expect(created.token).toMatch(/^[0-9a-f]{64}$/);
    expect(vi.mocked(sendEmailChangeVerification)).toHaveBeenCalledWith(
      'ny@example.com',
      expect.not.stringMatching(/^[0-9a-f]{64}$/)
    );
    expect(vi.mocked(sendEmailChangeNotice)).toHaveBeenCalledWith(
      'gammel@example.com',
      'ny@example.com'
    );
  });
});

describe('consumeEmailChangeToken', () => {
  it('rejects an unknown token without touching the user', async () => {
    prisma.verificationToken.findUnique.mockResolvedValue(null);

    const result = await consumeEmailChangeToken('nope');

    expect(result).toEqual({ ok: false, error: 'Lenken er ugyldig eller allerede brukt' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('burns an expired token instead of leaving it replayable', async () => {
    prisma.verificationToken.findUnique.mockResolvedValue({
      identifier: 'emailchange:4:ny@example.com',
      expires: pastDate,
    });

    const result = await consumeEmailChangeToken('raw');

    expect(prisma.verificationToken.delete).toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses when the address was taken in the meantime', async () => {
    prisma.verificationToken.findUnique.mockResolvedValue({
      identifier: 'emailchange:4:ny@example.com',
      expires: future,
    });
    prisma.user.findUnique.mockResolvedValue(activeUser);
    prisma.user.findFirst.mockResolvedValue({ id: 9 });

    const result = await consumeEmailChangeToken('raw');

    expect(result).toEqual({ ok: false, error: 'E-postadressen er allerede i bruk' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses for a deactivated account', async () => {
    prisma.verificationToken.findUnique.mockResolvedValue({
      identifier: 'emailchange:4:ny@example.com',
      expires: future,
    });
    prisma.user.findUnique.mockResolvedValue({ ...activeUser, deactivatedAt: new Date() });

    expect(await consumeEmailChangeToken('raw')).toEqual({ ok: false, error: 'Kontoen er ikke aktiv' });
  });

  it('applies the change and marks the address verified', async () => {
    prisma.verificationToken.findUnique.mockResolvedValue({
      identifier: 'emailchange:4:ny@example.com',
      expires: future,
    });
    prisma.user.findUnique.mockResolvedValue(activeUser);
    prisma.user.findFirst.mockResolvedValue(null);

    const result = await consumeEmailChangeToken('raw');

    expect(result).toEqual({ ok: true, userId: 4, newEmail: 'ny@example.com' });
    const update = prisma.user.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 4 });
    expect(update.data.email).toBe('ny@example.com');
    expect(update.data.emailVerified).toBeInstanceOf(Date);
  });
});
