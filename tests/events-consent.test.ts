import { describe, it, expect } from 'vitest';
import { hasAnalyticsConsent } from '@/lib/events/consent';

const valid = JSON.stringify({
  id: 'abc',
  timestamp: '2026-07-16T10:00:00.000Z',
  categories: ['necessary', 'analytics'],
  interaction: 'accept_all',
  version: '2.3.14',
  expiry: 2_000_000_000_000,
});

describe('hasAnalyticsConsent', () => {
  it('true when analytics granted and not expired', () => {
    expect(hasAnalyticsConsent(valid, 1_000_000_000_000)).toBe(true);
  });

  it('false when analytics not in categories', () => {
    const c = JSON.stringify({ categories: ['necessary'], expiry: 2_000_000_000_000 });
    expect(hasAnalyticsConsent(c, 1_000_000_000_000)).toBe(false);
  });

  it('false when expired', () => {
    expect(hasAnalyticsConsent(valid, 2_000_000_000_001)).toBe(false);
  });

  it('false on null, garbage and non-object JSON', () => {
    expect(hasAnalyticsConsent(null)).toBe(false);
    expect(hasAnalyticsConsent('not json')).toBe(false);
    expect(hasAnalyticsConsent('42')).toBe(false);
    expect(hasAnalyticsConsent('null')).toBe(false);
  });

  it('missing expiry treated as not expired (widget always writes it, defensive)', () => {
    const c = JSON.stringify({ categories: ['analytics'] });
    expect(hasAnalyticsConsent(c, 1_000_000_000_000)).toBe(true);
  });
});
