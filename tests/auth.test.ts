import { describe, it, expect, vi } from 'vitest';

// lib/auth pulls in the NextAuth route for authOptions — not needed for password helpers
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));

import { hashPassword, verifyPassword } from '@/lib/auth';

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('EnTest1234!');
    expect(hash).not.toBe('EnTest1234!');
    expect(await verifyPassword('EnTest1234!', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('EnTest1234!');
    expect(await verifyPassword('feil-passord', hash)).toBe(false);
  });

  it('produces unique salted hashes', async () => {
    const [a, b] = await Promise.all([hashPassword('samme'), hashPassword('samme')]);
    expect(a).not.toBe(b);
  });
});
