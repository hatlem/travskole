import { describe, it, expect } from 'vitest';
import {
  contactMatchesSegment,
  describeSegmentRules,
  parseSegmentRules,
  segmentsForContact,
  type SegmentContact,
} from '@/lib/crm/segments';

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
  it('deal.* is_null with ANY semantics — matches if any deal has null field', () => {
    expect(contactMatchesSegment(
      contact({ deals: [
        { eventType: null, eventDate: new Date('2026-01-01'), status: 'open' },
        { eventType: 'julebord', eventDate: new Date('2026-01-02'), status: 'won' },
      ] }),
      { all: [{ field: 'deal.eventType', op: 'is_null' }] },
    )).toBe(true);
  });
  it('deal.* is_null does not match contact with zero deals', () => {
    expect(contactMatchesSegment(
      contact({ deals: [] }),
      { all: [{ field: 'deal.eventType', op: 'is_null' }] },
    )).toBe(false);
  });
  it('unknown operator returns false', () => {
    expect(contactMatchesSegment(
      contact(),
      { all: [{ field: 'stage', op: 'unknown_op' as never, value: 'customer' }] },
    )).toBe(false);
  });
  it('unknown deal field never matches', () => {
    expect(contactMatchesSegment(contact(), { all: [{ field: 'deal.finnesIkke', op: 'not_null' }] })).toBe(false);
  });
});

describe('contactMatchesSegment — deal rules apply to the SAME deal', () => {
  // julebord i 2025 + kurs i 2026: ingen deal er «julebord i 2026»
  const rules = {
    all: [
      { field: 'deal.eventType', op: 'eq' as const, value: 'julebord' },
      { field: 'deal.eventDate', op: 'gt' as const, value: '2026-01-01' },
    ],
  };

  it('does not combine fields from two different deals', () => {
    expect(contactMatchesSegment(contact(), rules)).toBe(false);
  });
  it('matches when one deal satisfies all deal rules', () => {
    expect(contactMatchesSegment(
      contact({ deals: [
        { eventType: 'kurs', eventDate: new Date('2026-03-01'), status: 'open' },
        { eventType: 'julebord', eventDate: new Date('2026-12-10'), status: 'open' },
      ] }),
      rules,
    )).toBe(true);
  });
  it('status + eventType must hold on the same deal', () => {
    // julebord er vunnet, kurs er åpent — «åpent julebord» finnes ikke
    expect(contactMatchesSegment(contact(), {
      all: [
        { field: 'deal.eventType', op: 'eq', value: 'julebord' },
        { field: 'deal.status', op: 'eq', value: 'open' },
      ],
    })).toBe(false);
  });
  it('contact rules still AND with the deal match', () => {
    const r = {
      all: [
        { field: 'stage', op: 'eq' as const, value: 'lead' },
        { field: 'deal.eventType', op: 'eq' as const, value: 'julebord' },
      ],
    };
    expect(contactMatchesSegment(contact(), r)).toBe(false);
    expect(contactMatchesSegment(contact({ stage: 'lead' }), r)).toBe(true);
  });
  it('rule order does not matter', () => {
    expect(contactMatchesSegment(contact(), {
      all: [
        { field: 'deal.eventDate', op: 'lt', value: '2026-01-01' },
        { field: 'tags', op: 'contains', value: 'vip' },
        { field: 'deal.eventType', op: 'eq', value: 'julebord' },
      ],
    })).toBe(true);
  });
});

describe('segmentsForContact — enkeltkontakt-evaluering', () => {
  const segments = [
    { id: 1, name: 'Julebord før 2026', rules: '{"all":[{"field":"deal.eventType","op":"eq","value":"julebord"},{"field":"deal.eventDate","op":"lt","value":"2026-01-01"}]}' },
    { id: 2, name: 'Interessenter', rules: '{"all":[{"field":"stage","op":"eq","value":"lead"}]}' },
    { id: 3, name: 'VIP', rules: '{"all":[{"field":"tags","op":"contains","value":"vip"}]}' },
    { id: 4, name: 'Alle', rules: '{"all":[]}' },
    { id: 5, name: 'Ødelagt', rules: 'tull' },
  ];
  const contacts: SegmentContact[] = [
    contact(),
    contact({ stage: 'lead', tags: [] }),
    contact({ deals: [], tags: ['vip'] }),
    contact({ stage: 'lead', deals: [{ eventType: 'julebord', eventDate: new Date('2026-12-01'), status: 'open' }] }),
  ];

  it('gir de segmentene kontakten treffer', () => {
    expect(segmentsForContact(contact(), segments).map((s) => s.id)).toEqual([1, 3, 4, 5]);
  });

  it('er enig med bulk-filtreringen for hvert segment', () => {
    for (const segment of segments) {
      const bulk = contacts.filter((c) => contactMatchesSegment(c, parseSegmentRules(segment.rules)));
      const single = contacts.filter((c) => segmentsForContact(c, segments).some((s) => s.id === segment.id));
      expect(single).toEqual(bulk);
    }
  });
});

describe('describeSegmentRules', () => {
  it('slår deal-regler sammen til én linje', () => {
    expect(describeSegmentRules({
      all: [
        { field: 'deal.eventType', op: 'eq', value: 'julebord' },
        { field: 'deal.eventDate', op: 'lt', value: '2026-01-01' },
      ],
    })).toEqual(['Deal: type = julebord, dato før 01.01.2026']);
  });

  it('beskriver kontaktregler med norske etiketter', () => {
    expect(describeSegmentRules({
      all: [
        { field: 'stage', op: 'eq', value: 'customer' },
        { field: 'tags', op: 'contains', value: 'vip' },
        { field: 'email', op: 'contains', value: '@acme.no' },
        { field: 'organizationId', op: 'is_null' },
        { field: 'deal.status', op: 'neq', value: 'lost' },
      ],
    })).toEqual([
      'Stadium = Kunde',
      'Tagg = vip',
      'E-post inneholder «@acme.no»',
      'Bedrift mangler',
      'Deal: status ≠ tapt',
    ]);
  });

  it('tomme regler betyr alle kontakter', () => {
    expect(describeSegmentRules({ all: [] })).toEqual(['Alle kontakter (ingen regler)']);
  });
});
