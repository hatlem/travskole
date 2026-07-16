import { describe, it, expect } from 'vitest';
import { planStitch } from '@/lib/events/stitch';

describe('planStitch', () => {
  it('links unlinked visitor to contact', () => {
    expect(planStitch({ id: 7, contactId: null }, 42)).toEqual({
      link: true,
      visitorId: 7,
      contactId: 42,
    });
  });

  it('no visitor → no link', () => {
    expect(planStitch(null, 42)).toEqual({ link: false });
  });

  it('no contact → no link', () => {
    expect(planStitch({ id: 7, contactId: null }, null)).toEqual({ link: false });
  });

  it('already linked visitor is never re-linked (first identification wins)', () => {
    expect(planStitch({ id: 7, contactId: 42 }, 42)).toEqual({ link: false });
    expect(planStitch({ id: 7, contactId: 42 }, 99)).toEqual({ link: false });
  });
});
