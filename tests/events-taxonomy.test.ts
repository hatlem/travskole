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

  it('accepts every declared email event type', () => {
    expect(isEventType('email.opened')).toBe(true);
    expect(isEventType('email.clicked')).toBe(true);
    expect(isEventType('email.replied')).toBe(true);
    expect(isEventType('email.bounced')).toBe(true);
  });

  it('timelineTitle: email events get Norwegian titles', () => {
    expect(timelineTitle('email.opened', {})).toBe('Åpnet e-post');
    expect(timelineTitle('email.clicked', { url: 'https://example.com' })).toBe(
      'Klikket lenke i e-post: https://example.com'
    );
    expect(timelineTitle('email.clicked', {})).toBe('Klikket lenke i e-post');
    expect(timelineTitle('email.replied', {})).toBe('Svarte på e-post');
    expect(timelineTitle('email.bounced', {})).toBe('E-post kom i retur');
  });

  it('payment.expired and payment.partially_refunded are registered', () => {
    expect(isEventType('payment.expired')).toBe(true);
    expect(isEventType('payment.partially_refunded')).toBe(true);
    expect(timelineTitle('payment.expired', {})).toBe('Betaling utløpt');
    expect(timelineTitle('payment.partially_refunded', { amountKr: 500 })).toBe(
      'Delvis refundert (500 kr)'
    );
    expect(timelineTitle('payment.partially_refunded', {})).toBe('Delvis refundert');
  });
});
