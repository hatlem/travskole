/**
 * Tests for Vipps mode-aware environment variable resolution.
 * Uses vitest's vi.stubEnv() for isolation, no mutation of global process.env.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vippsEnvFrom, vippsEnv, isVippsConfigured } from '@/lib/payments/vipps';

describe('vippsEnvFrom', () => {
  it('selects live-set keys when testMode is false', () => {
    const env = {
      VIPPS_CLIENT_ID: 'live-client-id',
      VIPPS_CLIENT_SECRET: 'live-client-secret',
      VIPPS_SUBSCRIPTION_KEY: 'live-sub-key',
      VIPPS_MSN: 'live-msn',
      VIPPS_CLIENT_ID_TEST: 'test-client-id',
      VIPPS_CLIENT_SECRET_TEST: 'test-client-secret',
      VIPPS_SUBSCRIPTION_KEY_TEST: 'test-sub-key',
      VIPPS_MSN_TEST: 'test-msn',
    };

    const result = vippsEnvFrom(env, false);

    expect(result).toEqual({
      clientId: 'live-client-id',
      clientSecret: 'live-client-secret',
      subscriptionKey: 'live-sub-key',
      msn: 'live-msn',
    });
  });

  it('selects test-set keys when testMode is true', () => {
    const env = {
      VIPPS_CLIENT_ID: 'live-client-id',
      VIPPS_CLIENT_SECRET: 'live-client-secret',
      VIPPS_SUBSCRIPTION_KEY: 'live-sub-key',
      VIPPS_MSN: 'live-msn',
      VIPPS_CLIENT_ID_TEST: 'test-client-id',
      VIPPS_CLIENT_SECRET_TEST: 'test-client-secret',
      VIPPS_SUBSCRIPTION_KEY_TEST: 'test-sub-key',
      VIPPS_MSN_TEST: 'test-msn',
    };

    const result = vippsEnvFrom(env, true);

    expect(result).toEqual({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      subscriptionKey: 'test-sub-key',
      msn: 'test-msn',
    });
  });

  it('handles partial live-set (missing secret)', () => {
    const env = {
      VIPPS_CLIENT_ID: 'live-client-id',
      // VIPPS_CLIENT_SECRET missing
      VIPPS_SUBSCRIPTION_KEY: 'live-sub-key',
      VIPPS_MSN: 'live-msn',
    };

    const result = vippsEnvFrom(env, false);

    expect(result).toEqual({
      clientId: 'live-client-id',
      clientSecret: undefined,
      subscriptionKey: 'live-sub-key',
      msn: 'live-msn',
    });
  });

  it('handles partial test-set (missing subscription key)', () => {
    const env = {
      VIPPS_CLIENT_ID_TEST: 'test-client-id',
      VIPPS_CLIENT_SECRET_TEST: 'test-client-secret',
      // VIPPS_SUBSCRIPTION_KEY_TEST missing
      VIPPS_MSN_TEST: 'test-msn',
    };

    const result = vippsEnvFrom(env, true);

    expect(result).toEqual({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      subscriptionKey: undefined,
      msn: 'test-msn',
    });
  });

  it('handles empty env object', () => {
    const env = {};

    const result = vippsEnvFrom(env, false);

    expect(result).toEqual({
      clientId: undefined,
      clientSecret: undefined,
      subscriptionKey: undefined,
      msn: undefined,
    });
  });
});

describe('vippsEnv', () => {
  beforeEach(() => {
    // Stub all relevant env vars to empty so we control them per test
    const vars = [
      'VIPPS_CLIENT_ID',
      'VIPPS_CLIENT_SECRET',
      'VIPPS_SUBSCRIPTION_KEY',
      'VIPPS_MSN',
      'VIPPS_CLIENT_ID_TEST',
      'VIPPS_CLIENT_SECRET_TEST',
      'VIPPS_SUBSCRIPTION_KEY_TEST',
      'VIPPS_MSN_TEST',
    ];
    vars.forEach((v) => {
      if (process.env[v]) {
        delete process.env[v];
      }
    });
  });

  afterEach(() => {
    // Clean up any stubbed env vars
    const vars = [
      'VIPPS_CLIENT_ID',
      'VIPPS_CLIENT_SECRET',
      'VIPPS_SUBSCRIPTION_KEY',
      'VIPPS_MSN',
      'VIPPS_CLIENT_ID_TEST',
      'VIPPS_CLIENT_SECRET_TEST',
      'VIPPS_SUBSCRIPTION_KEY_TEST',
      'VIPPS_MSN_TEST',
    ];
    vars.forEach((v) => {
      if (process.env[v]) {
        delete process.env[v];
      }
    });
  });

  it('reads process.env live-set when testMode is false', () => {
    process.env.VIPPS_CLIENT_ID = 'proc-live-id';
    process.env.VIPPS_CLIENT_SECRET = 'proc-live-secret';
    process.env.VIPPS_SUBSCRIPTION_KEY = 'proc-live-key';
    process.env.VIPPS_MSN = 'proc-live-msn';

    const result = vippsEnv(false);

    expect(result).toEqual({
      clientId: 'proc-live-id',
      clientSecret: 'proc-live-secret',
      subscriptionKey: 'proc-live-key',
      msn: 'proc-live-msn',
    });
  });

  it('reads process.env test-set when testMode is true', () => {
    process.env.VIPPS_CLIENT_ID_TEST = 'proc-test-id';
    process.env.VIPPS_CLIENT_SECRET_TEST = 'proc-test-secret';
    process.env.VIPPS_SUBSCRIPTION_KEY_TEST = 'proc-test-key';
    process.env.VIPPS_MSN_TEST = 'proc-test-msn';

    const result = vippsEnv(true);

    expect(result).toEqual({
      clientId: 'proc-test-id',
      clientSecret: 'proc-test-secret',
      subscriptionKey: 'proc-test-key',
      msn: 'proc-test-msn',
    });
  });
});

describe('isVippsConfigured', () => {
  beforeEach(() => {
    // Clear all Vipps env vars
    const vars = [
      'VIPPS_CLIENT_ID',
      'VIPPS_CLIENT_SECRET',
      'VIPPS_SUBSCRIPTION_KEY',
      'VIPPS_MSN',
      'VIPPS_CLIENT_ID_TEST',
      'VIPPS_CLIENT_SECRET_TEST',
      'VIPPS_SUBSCRIPTION_KEY_TEST',
      'VIPPS_MSN_TEST',
    ];
    vars.forEach((v) => {
      if (process.env[v]) {
        delete process.env[v];
      }
    });
  });

  afterEach(() => {
    // Clean up
    const vars = [
      'VIPPS_CLIENT_ID',
      'VIPPS_CLIENT_SECRET',
      'VIPPS_SUBSCRIPTION_KEY',
      'VIPPS_MSN',
      'VIPPS_CLIENT_ID_TEST',
      'VIPPS_CLIENT_SECRET_TEST',
      'VIPPS_SUBSCRIPTION_KEY_TEST',
      'VIPPS_MSN_TEST',
    ];
    vars.forEach((v) => {
      if (process.env[v]) {
        delete process.env[v];
      }
    });
  });

  it('returns true when all live-set keys are truthy and testMode is false', () => {
    process.env.VIPPS_CLIENT_ID = 'id';
    process.env.VIPPS_CLIENT_SECRET = 'secret';
    process.env.VIPPS_SUBSCRIPTION_KEY = 'key';
    process.env.VIPPS_MSN = 'msn';

    expect(isVippsConfigured(false)).toBe(true);
  });

  it('returns false when one live-set key is missing and testMode is false', () => {
    process.env.VIPPS_CLIENT_ID = 'id';
    process.env.VIPPS_CLIENT_SECRET = 'secret';
    process.env.VIPPS_SUBSCRIPTION_KEY = 'key';
    // VIPPS_MSN missing

    expect(isVippsConfigured(false)).toBe(false);
  });

  it('returns true when all test-set keys are truthy and testMode is true', () => {
    process.env.VIPPS_CLIENT_ID_TEST = 'id';
    process.env.VIPPS_CLIENT_SECRET_TEST = 'secret';
    process.env.VIPPS_SUBSCRIPTION_KEY_TEST = 'key';
    process.env.VIPPS_MSN_TEST = 'msn';

    expect(isVippsConfigured(true)).toBe(true);
  });

  it('returns false when one test-set key is missing and testMode is true', () => {
    process.env.VIPPS_CLIENT_ID_TEST = 'id';
    process.env.VIPPS_CLIENT_SECRET_TEST = 'secret';
    // VIPPS_SUBSCRIPTION_KEY_TEST missing
    process.env.VIPPS_MSN_TEST = 'msn';

    expect(isVippsConfigured(true)).toBe(false);
  });

  it('returns false when no keys are set', () => {
    expect(isVippsConfigured(false)).toBe(false);
    expect(isVippsConfigured(true)).toBe(false);
  });
});
