import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signUnsubscribeToken, verifyUnsubscribeToken } from '../lib/flows/unsubscribe-token';

describe('unsubscribe token', () => {
  const testSecret = 'test-secret-12345';

  beforeEach(() => {
    delete process.env.NEXTAUTH_SECRET;
  });

  afterEach(() => {
    delete process.env.NEXTAUTH_SECRET;
  });

  describe('signUnsubscribeToken', () => {
    it('should sign a token with explicit secret', () => {
      const token = signUnsubscribeToken(123, testSecret);
      expect(typeof token).toBe('string');
      expect(token).toContain('.');
    });

    it('should sign a token with env secret', () => {
      process.env.NEXTAUTH_SECRET = testSecret;
      const token = signUnsubscribeToken(123);
      expect(typeof token).toBe('string');
      expect(token).toContain('.');
    });

    it('should throw when secret is missing and env is not set', () => {
      expect(() => signUnsubscribeToken(123)).toThrow();
    });

    it('should produce different tokens for different contact IDs', () => {
      const token1 = signUnsubscribeToken(123, testSecret);
      const token2 = signUnsubscribeToken(456, testSecret);
      expect(token1).not.toBe(token2);
    });
  });

  describe('verifyUnsubscribeToken', () => {
    it('should verify a valid token and return contactId', () => {
      const token = signUnsubscribeToken(789, testSecret);
      const result = verifyUnsubscribeToken(token, testSecret);
      expect(result).toEqual({ contactId: 789 });
    });

    it('should return null for tampered payload', () => {
      const token = signUnsubscribeToken(123, testSecret);
      const parts = token.split('.');
      const tamperedPayload = Buffer.from('unsub.456').toString('base64url');
      const tamperedToken = `${tamperedPayload}.${parts[1]}`;
      const result = verifyUnsubscribeToken(tamperedToken, testSecret);
      expect(result).toBeNull();
    });

    it('should return null for tampered signature', () => {
      const token = signUnsubscribeToken(123, testSecret);
      const parts = token.split('.');
      const tamperedToken = `${parts[0]}.aW52YWxpZA==`;
      const result = verifyUnsubscribeToken(tamperedToken, testSecret);
      expect(result).toBeNull();
    });

    it('should return null for garbage input', () => {
      expect(verifyUnsubscribeToken('garbage', testSecret)).toBeNull();
      expect(verifyUnsubscribeToken('', testSecret)).toBeNull();
      expect(verifyUnsubscribeToken('no.dots.here.extra', testSecret)).toBeNull();
    });

    it('should return null for wrong secret', () => {
      const token = signUnsubscribeToken(123, testSecret);
      const result = verifyUnsubscribeToken(token, 'wrong-secret');
      expect(result).toBeNull();
    });

    it('should return null for missing secret (no env, no param)', () => {
      const token = signUnsubscribeToken(123, testSecret);
      const result = verifyUnsubscribeToken(token);
      expect(result).toBeNull();
    });

    it('should return null for non-integer contactId in payload', () => {
      const malformedPayload = Buffer.from('unsub.abc').toString('base64url');
      const sig = Buffer.from('fake').toString('base64url');
      const malformedToken = `${malformedPayload}.${sig}`;
      const result = verifyUnsubscribeToken(malformedToken, testSecret);
      expect(result).toBeNull();
    });

    it('should return null for malformed payload structure', () => {
      const malformedPayload = Buffer.from('unsub').toString('base64url');
      const sig = Buffer.from('fake').toString('base64url');
      const malformedToken = `${malformedPayload}.${sig}`;
      const result = verifyUnsubscribeToken(malformedToken, testSecret);
      expect(result).toBeNull();
    });

    it('should never throw, even with invalid input', () => {
      expect(() => verifyUnsubscribeToken(null as any)).not.toThrow();
      expect(() => verifyUnsubscribeToken(undefined as any)).not.toThrow();
      expect(() => verifyUnsubscribeToken(123 as any)).not.toThrow();
      expect(() => verifyUnsubscribeToken({} as any)).not.toThrow();
    });

    it('should use env secret when no param provided', () => {
      process.env.NEXTAUTH_SECRET = testSecret;
      const token = signUnsubscribeToken(999, testSecret);
      const result = verifyUnsubscribeToken(token);
      expect(result).toEqual({ contactId: 999 });
    });
  });

  describe('roundtrip', () => {
    it('should roundtrip multiple contactIds correctly', () => {
      const ids = [1, 100, 999999, 12345];
      ids.forEach((id) => {
        const token = signUnsubscribeToken(id, testSecret);
        const result = verifyUnsubscribeToken(token, testSecret);
        expect(result).toEqual({ contactId: id });
      });
    });
  });
});
