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
    expect(timelineTitle('registration.cancelled', { courseName: 'Begynnerkurs' })).toBe(
      'Påmelding avlyst: Begynnerkurs'
    );
    expect(timelineTitle('booking.status_changed', { status: 'confirmed' })).toBe(
      'Booking-status endret: confirmed'
    );
    expect(timelineTitle('payment.succeeded', { amountKr: 2500 })).toBe(
      'Betaling mottatt (2500 kr)'
    );
    expect(timelineTitle('payment.refunded', { amountKr: 1200 })).toBe(
      'Betaling refundert (1200 kr)'
    );
    expect(timelineTitle('user.logged_in', {})).toBeNull();
    expect(timelineTitle('page.viewed', { path: '/kurs' })).toBeNull();
  });

  it('timelineTitle: payment amount falls back to meta.amount when amountKr is absent', () => {
    expect(timelineTitle('payment.succeeded', { amount: 2500 })).toBe('Betaling mottatt (2500 kr)');
    expect(timelineTitle('payment.succeeded', {})).toBe('Betaling mottatt');
  });

  it('timelineTitle: booking.created and registration.created are null — the CRM bridge owns those timeline moments on first sync', () => {
    expect(timelineTitle('booking.created', {})).toBeNull();
    expect(timelineTitle('registration.created', { courseName: 'Begynnerkurs' })).toBeNull();
  });
});
