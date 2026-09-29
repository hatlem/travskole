import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, emitEvent } = vi.hoisted(() => ({
  prisma: {
    consent: { upsert: vi.fn() },
    contact: { findUnique: vi.fn() },
    suppression: { findFirst: vi.fn(), delete: vi.fn() },
  },
  emitEvent: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/events/bus', () => ({ emitEvent }));
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn(), info: vi.fn() } }));

import {
  hasWithdrawnMarketing,
  isMarketingAllowed,
  recordMarketingOptIn,
  type ConsentLike,
} from '@/lib/crm/marketing-consent';

const given: ConsentLike = { marketing: true, lawfulBasis: 'consent', consentAt: new Date('2026-01-01') };
// Admin fjerner avkrysningen: consent-ruta lagrer basis/tidspunkt som null.
const adminRevoked: ConsentLike = { marketing: false, lawfulBasis: null, consentAt: null, source: 'admin:hilde@bjerke.no' };
// Avmeldingslenken (lib/flows/unsubscribe.ts)
const unsubscribed: ConsentLike = { marketing: false, lawfulBasis: null, consentAt: null, source: 'avmelding' };
// Admin har eksplisitt valgt berettiget interesse uten samtykke
const legitimateInterest: ConsentLike = { marketing: false, lawfulBasis: 'legitimate_interest', consentAt: null, source: 'admin:hilde@bjerke.no' };

describe('hasWithdrawnMarketing', () => {
  it('treats an admin revocation as withdrawn', () => {
    expect(hasWithdrawnMarketing(adminRevoked)).toBe(true);
  });

  it('treats an unsubscribe-link consent row as withdrawn', () => {
    expect(hasWithdrawnMarketing(unsubscribed)).toBe(true);
  });

  it('does not treat a missing consent row as withdrawn', () => {
    expect(hasWithdrawnMarketing(null)).toBe(false);
  });

  it('does not treat an explicit legitimate-interest basis as withdrawn', () => {
    expect(hasWithdrawnMarketing(legitimateInterest)).toBe(false);
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
    expect(isMarketingAllowed({ consent: legitimateInterest, organizationId: 7, allowLegitimateInterest: true })).toBe(true);
  });

  it('never uses legitimate interest for private contacts (no organization)', () => {
    expect(isMarketingAllowed({ consent: null, organizationId: null, allowLegitimateInterest: true })).toBe(false);
    expect(isMarketingAllowed({ consent: null, organizationId: undefined, allowLegitimateInterest: true })).toBe(false);
  });

  it('respects withdrawal even for organization contacts', () => {
    expect(isMarketingAllowed({ consent: adminRevoked, organizationId: 7, allowLegitimateInterest: true })).toBe(false);
    expect(isMarketingAllowed({ consent: unsubscribed, organizationId: 7, allowLegitimateInterest: true })).toBe(false);
  });
});

describe('recordMarketingOptIn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.contact.findUnique.mockResolvedValue({ email: 'ola@firma.no', consent: null });
    prisma.suppression.findFirst.mockResolvedValue(null);
    prisma.consent.upsert.mockResolvedValue({});
    prisma.suppression.delete.mockResolvedValue({});
    emitEvent.mockResolvedValue(undefined);
  });

  it('upserts an explicit marketing consent and emits consent.updated', async () => {
    await recordMarketingOptIn(42, 'booking_form', { verified: false });

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

  it('lets a verified submitter lift their own unsubscribe suppression', async () => {
    prisma.suppression.findFirst.mockResolvedValue({ id: 9, email: 'ola@firma.no', reason: 'unsubscribe' });
    prisma.contact.findUnique.mockResolvedValue({ email: 'ola@firma.no', consent: unsubscribed });

    await recordMarketingOptIn(42, 'registration_form', { verified: true });

    expect(prisma.suppression.findFirst).toHaveBeenCalledWith({ where: { email: 'ola@firma.no', reason: 'unsubscribe' } });
    expect(prisma.consent.upsert).toHaveBeenCalled();
    expect(prisma.suppression.delete).toHaveBeenCalledWith({ where: { id: 9 } });
  });

  it('ignores an unverified opt-in for someone who unsubscribed', async () => {
    prisma.suppression.findFirst.mockResolvedValue({ id: 9, email: 'ola@firma.no', reason: 'unsubscribe' });

    await recordMarketingOptIn(42, 'booking_form', { verified: false });

    expect(prisma.consent.upsert).not.toHaveBeenCalled();
    expect(prisma.suppression.delete).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('ignores an unverified opt-in for someone an admin marked as no-marketing', async () => {
    prisma.contact.findUnique.mockResolvedValue({ email: 'ola@firma.no', consent: adminRevoked });

    await recordMarketingOptIn(42, 'booking_form', { verified: false });

    expect(prisma.consent.upsert).not.toHaveBeenCalled();
  });

  it('never throws when the database write fails', async () => {
    prisma.consent.upsert.mockRejectedValue(new Error('db down'));
    await expect(recordMarketingOptIn(42, 'registration_form', { verified: true })).resolves.toBeUndefined();
    expect(emitEvent).not.toHaveBeenCalled();
  });
});
