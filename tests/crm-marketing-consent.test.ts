import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, emitEvent } = vi.hoisted(() => ({
  prisma: { consent: { upsert: vi.fn() } },
  emitEvent: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/events/bus', () => ({ emitEvent }));
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn() } }));

import {
  hasWithdrawnMarketing,
  isMarketingAllowed,
  recordMarketingOptIn,
  type ConsentLike,
} from '@/lib/crm/marketing-consent';

const given: ConsentLike = { marketing: true, lawfulBasis: 'consent', consentAt: new Date('2026-01-01') };
const withdrawn: ConsentLike = { marketing: false, lawfulBasis: 'consent', consentAt: new Date('2026-01-01') };
const neverAsked: ConsentLike = { marketing: false, lawfulBasis: null, consentAt: null };
const unsubscribed: ConsentLike = { marketing: false, lawfulBasis: null, consentAt: null, source: 'avmelding' };

describe('hasWithdrawnMarketing', () => {
  it('treats an explicit consent-basis refusal with timestamp as withdrawn', () => {
    expect(hasWithdrawnMarketing(withdrawn)).toBe(true);
  });

  it('treats an unsubscribe-link consent row as withdrawn', () => {
    expect(hasWithdrawnMarketing(unsubscribed)).toBe(true);
  });

  it('does not treat a missing or never-asked consent as withdrawn', () => {
    expect(hasWithdrawnMarketing(null)).toBe(false);
    expect(hasWithdrawnMarketing(neverAsked)).toBe(false);
    expect(hasWithdrawnMarketing({ marketing: false, lawfulBasis: 'consent', consentAt: null })).toBe(false);
  });

  it('is never withdrawn when marketing is granted', () => {
    expect(hasWithdrawnMarketing(given)).toBe(false);
  });
});

describe('isMarketingAllowed', () => {
  it('allows explicit consent regardless of setting and organization', () => {
    expect(isMarketingAllowed({ consent: given, organizationId: null, allowLegitimateInterest: false })).toBe(true);
  });

  it('blocks non-consented contacts when legitimate interest is off', () => {
    expect(isMarketingAllowed({ consent: null, organizationId: 7, allowLegitimateInterest: false })).toBe(false);
  });

  it('allows organization contacts without consent when legitimate interest is on', () => {
    expect(isMarketingAllowed({ consent: null, organizationId: 7, allowLegitimateInterest: true })).toBe(true);
    expect(isMarketingAllowed({ consent: neverAsked, organizationId: 7, allowLegitimateInterest: true })).toBe(true);
  });

  it('never uses legitimate interest for private contacts (no organization)', () => {
    expect(isMarketingAllowed({ consent: null, organizationId: null, allowLegitimateInterest: true })).toBe(false);
    expect(isMarketingAllowed({ consent: null, organizationId: undefined, allowLegitimateInterest: true })).toBe(false);
  });

  it('respects withdrawal even for organization contacts', () => {
    expect(isMarketingAllowed({ consent: withdrawn, organizationId: 7, allowLegitimateInterest: true })).toBe(false);
    expect(isMarketingAllowed({ consent: unsubscribed, organizationId: 7, allowLegitimateInterest: true })).toBe(false);
  });
});

describe('recordMarketingOptIn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.consent.upsert.mockResolvedValue({ id: 1 });
    emitEvent.mockResolvedValue(undefined);
  });

  it('upserts an explicit marketing consent and emits consent.updated', async () => {
    await recordMarketingOptIn(42, 'booking_form');

    const call = prisma.consent.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ contactId: 42 });
    expect(call.create).toMatchObject({ contactId: 42, marketing: true, lawfulBasis: 'consent', source: 'booking_form' });
    expect(call.create.consentAt).toBeInstanceOf(Date);
    expect(call.update).toMatchObject({ marketing: true, lawfulBasis: 'consent', source: 'booking_form' });
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'consent.updated',
      contactId: 42,
      meta: expect.objectContaining({ marketing: true }),
    }));
  });

  it('never throws when the database write fails', async () => {
    prisma.consent.upsert.mockRejectedValue(new Error('db down'));
    await expect(recordMarketingOptIn(42, 'registration_form')).resolves.toBeUndefined();
    expect(emitEvent).not.toHaveBeenCalled();
  });
});
