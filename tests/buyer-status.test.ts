import { describe, it, expect } from 'vitest';
import { bookingStatus, registrationStatus } from '@/lib/buyer-status';
import { STRINGS } from '@/lib/strings';

describe('buyer status words', () => {
  it('distinguishes buyer cancellation from our cancellation', () => {
    expect(STRINGS[registrationStatus('cancelled', true).key]).toBe('Avbestilt');
    expect(STRINGS[registrationStatus('cancelled', false).key]).toBe('Avlyst');
  });
  it('calls a withdrawn request «Trukket»', () => {
    expect(STRINGS[bookingStatus('cancelled', true).key]).toBe('Trukket');
    expect(STRINGS[bookingStatus('cancelled', false).key]).toBe('Avlyst');
    expect(STRINGS[bookingStatus('new', false).key]).toBe('Til behandling');
  });
  it('maps the other registration states', () => {
    expect(STRINGS[registrationStatus('confirmed', false).key]).toBe('Bekreftet');
    expect(STRINGS[registrationStatus('waitlist', false).key]).toBe('Venteliste');
    expect(STRINGS[registrationStatus('pending', false).key]).toBe('Til behandling');
  });
});
