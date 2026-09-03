import { describe, it, expect } from 'vitest';
import {
  selfCancelRegistrationError,
  selfCancelBookingError,
} from '@/lib/registrations/cancel-rules';

const NOW = new Date('2026-09-03T12:00:00Z');
const future = new Date('2026-10-01T10:00:00Z');
const past = new Date('2026-08-01T10:00:00Z');

describe('selfCancelRegistrationError', () => {
  it('allows cancelling an unpaid registration before the course starts', () => {
    expect(
      selfCancelRegistrationError(
        { status: 'confirmed', paymentStatus: 'none', courseStart: future },
        { now: NOW }
      )
    ).toBeNull();
  });

  it('allows cancelling when the course has no date at all', () => {
    expect(
      selfCancelRegistrationError(
        { status: 'pending', paymentStatus: 'none', courseStart: null },
        { now: NOW }
      )
    ).toBeNull();
  });

  it('refuses an already cancelled registration', () => {
    expect(
      selfCancelRegistrationError(
        { status: 'cancelled', paymentStatus: 'none', courseStart: future },
        { now: NOW }
      )
    ).toBe('Påmeldingen er allerede kansellert');
  });

  it('sends paid registrations to a human, since refunds are manual', () => {
    expect(
      selfCancelRegistrationError(
        { status: 'confirmed', paymentStatus: 'paid', courseStart: future },
        { now: NOW }
      )
    ).toMatch(/refusjon/);
  });

  it('refuses once the course has started', () => {
    expect(
      selfCancelRegistrationError(
        { status: 'confirmed', paymentStatus: 'none', courseStart: past },
        { now: NOW }
      )
    ).toMatch(/allerede startet/);
  });

  it('treats pending payments as cancellable', () => {
    expect(
      selfCancelRegistrationError(
        { status: 'pending', paymentStatus: 'pending', courseStart: future },
        { now: NOW }
      )
    ).toBeNull();
  });
});

describe('selfCancelBookingError', () => {
  it('allows withdrawing an unpaid request', () => {
    expect(selfCancelBookingError({ status: 'new', paymentStatus: 'none' })).toBeNull();
  });

  it('refuses an already cancelled request', () => {
    expect(selfCancelBookingError({ status: 'cancelled', paymentStatus: 'none' })).toBe(
      'Forespørselen er allerede kansellert'
    );
  });

  it('sends a paid booking to a human', () => {
    expect(selfCancelBookingError({ status: 'confirmed', paymentStatus: 'paid' })).toMatch(
      /refusjon/
    );
  });
});
