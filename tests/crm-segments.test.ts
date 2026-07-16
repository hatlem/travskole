import { describe, it, expect } from 'vitest';
import { contactMatchesSegment, parseSegmentRules, type SegmentContact } from '@/lib/crm/segments';

const contact = (o: Partial<SegmentContact> = {}): SegmentContact => ({
  stage: 'customer',
  source: 'booking',
  email: 'kari@acme.no',
  organizationId: 1,
  lastActivityAt: new Date('2026-06-01'),
  tags: ['julebord', 'vip'],
  deals: [
    { eventType: 'julebord', eventDate: new Date('2025-12-12'), status: 'won' },
    { eventType: 'kurs', eventDate: new Date('2026-03-01'), status: 'open' },
  ],
  ...o,
});

describe('parseSegmentRules', () => {
  it('parses valid rules', () => {
    expect(parseSegmentRules('{"all":[{"field":"stage","op":"eq","value":"lead"}]}'))
      .toEqual({ all: [{ field: 'stage', op: 'eq', value: 'lead' }] });
  });
  it('bad JSON gives empty rules', () => {
    expect(parseSegmentRules('tull')).toEqual({ all: [] });
    expect(parseSegmentRules('{"nope":1}')).toEqual({ all: [] });
  });
});

describe('contactMatchesSegment', () => {
  it('empty rules match everyone', () => {
    expect(contactMatchesSegment(contact(), { all: [] })).toBe(true);
  });
  it('eq/neq on contact fields', () => {
    expect(contactMatchesSegment(contact(), { all: [{ field: 'stage', op: 'eq', value: 'customer' }] })).toBe(true);
    expect(contactMatchesSegment(contact(), { all: [{ field: 'stage', op: 'neq', value: 'customer' }] })).toBe(false);
  });
  it('tags contains', () => {
    expect(contactMatchesSegment(contact(), { all: [{ field: 'tags', op: 'contains', value: 'vip' }] })).toBe(true);
    expect(contactMatchesSegment(contact(), { all: [{ field: 'tags', op: 'contains', value: 'ukjent' }] })).toBe(false);
  });
  it('AND-semantics over multiple rules', () => {
    expect(contactMatchesSegment(contact(), {
      all: [
        { field: 'stage', op: 'eq', value: 'customer' },
        { field: 'tags', op: 'contains', value: 'ukjent' },
      ],
    })).toBe(false);
  });
  it('deal.* passes when ANY deal matches', () => {
    expect(contactMatchesSegment(contact(), { all: [{ field: 'deal.eventType', op: 'eq', value: 'julebord' }] })).toBe(true);
    expect(contactMatchesSegment(contact(), { all: [{ field: 'deal.eventType', op: 'eq', value: 'firmafest' }] })).toBe(false);
  });
  it('date lt/gt with ISO strings — the re-engagement query', () => {
    // "booket julebord med eventDate før 2026" → re-engasjement for i år
    expect(contactMatchesSegment(contact(), {
      all: [
        { field: 'deal.eventType', op: 'eq', value: 'julebord' },
        { field: 'deal.eventDate', op: 'lt', value: '2026-01-01' },
      ],
    })).toBe(true);
  });
  it('is_null / not_null', () => {
    expect(contactMatchesSegment(contact({ organizationId: null }), { all: [{ field: 'organizationId', op: 'is_null' }] })).toBe(true);
    expect(contactMatchesSegment(contact(), { all: [{ field: 'organizationId', op: 'not_null' }] })).toBe(true);
  });
  it('unknown field never matches', () => {
    expect(contactMatchesSegment(contact(), { all: [{ field: 'finnesIkke', op: 'eq', value: 1 }] })).toBe(false);
  });
});
