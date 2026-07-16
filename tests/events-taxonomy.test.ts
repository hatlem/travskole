import { describe, it, expect } from 'vitest';
import {
  EVENT_TYPES,
  CLIENT_EVENT_TYPES,
  isEventType,
  isClientEventType,
  timelineTitle,
} from '@/lib/events/taxonomy';

describe('taxonomy', () => {
  it('accepts every declared event type', () => {
    for (const t of EVENT_TYPES) expect(isEventType(t)).toBe(true);
  });

  it('rejects unknown types', () => {
    expect(isEventType('user.deleted')).toBe(false);
    expect(isEventType('')).toBe(false);
  });

  it('client allowlist is a strict subset', () => {
    for (const t of CLIENT_EVENT_TYPES) expect(isEventType(t)).toBe(true);
    expect(isClientEventType('user.registered')).toBe(false);
    expect(isClientEventType('payment.succeeded')).toBe(false);
    expect(isClientEventType('page.viewed')).toBe(true);
  });

  it('timelineTitle: lifecycle + payment types get Norwegian titles', () => {
    expect(timelineTitle('registration.confirmed', { courseName: 'Begynnerkurs' })).toBe(
      'Påmelding bekreftet: Begynnerkurs'
    );
    expect(timelineTitle('booking.created', {})).toBe('Booking-forespørsel mottatt');
    expect(timelineTitle('payment.succeeded', { amount: 2500 })).toBe('Betaling mottatt (2500 kr)');
    expect(timelineTitle('user.logged_in', {})).toBeNull();
    expect(timelineTitle('page.viewed', { path: '/kurs' })).toBeNull();
  });
});
