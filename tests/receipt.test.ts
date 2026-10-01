import { describe, it, expect } from 'vitest';
import {
  nextSteps, parseReceipt, parseReceiptSubject, paymentStatusText, receiptForSubject, receiptSubjectQuery, RECEIPT_MAX_AGE_MS, type Receipt,
} from '@/lib/receipt';

const base: Receipt = {
  kind: 'registration',
  id: 12,
  courseName: 'Ponniskole',
  courseHref: '/arrangementer/kurs/2027/ponniskole',
  dateText: '1.–5. desember 2027',
  place: 'Refstadveien 27, 0589 Oslo',
  participant: 'Ola Nordmann',
  participants: null,
  priceText: '1 500 kr',
  amountKr: 1500,
  payment: 'invoice',
  waitlist: false,
  email: 'forelder@example.no',
  checkoutToken: null,
  providers: [],
  createdAt: 1_700_000_000_000,
};

describe('parseReceipt', () => {
  it('round-trips a valid receipt', () => {
    expect(parseReceipt(JSON.stringify(base), base.createdAt + 1000)).toEqual(base);
  });
  it('rejects garbage, wrong shapes and stale receipts', () => {
    expect(parseReceipt(null)).toBeNull();
    expect(parseReceipt('{not json')).toBeNull();
    expect(parseReceipt(JSON.stringify({ ...base, id: 'x' }))).toBeNull();
    expect(parseReceipt(JSON.stringify({ ...base, courseHref: 'https://evil.example' }), base.createdAt)).toBeNull();
    expect(parseReceipt(JSON.stringify(base), base.createdAt + RECEIPT_MAX_AGE_MS + 1)).toBeNull();
  });
});

describe('paymentStatusText', () => {
  it('describes each payment choice', () => {
    expect(paymentStatusText(base)).toContain('Faktura');
    expect(paymentStatusText({ ...base, payment: 'online' })).toBe('Ikke betalt ennå');
    expect(paymentStatusText({ ...base, payment: 'free' })).toContain('Gratis');
    expect(paymentStatusText({ ...base, payment: 'online' }, true)).toBe('Betalt');
  });
  it('never asks waitlisted people to pay', () => {
    expect(paymentStatusText({ ...base, payment: 'online', waitlist: true })).toBe('Ingen betaling før du får plass');
  });
});

describe('nextSteps', () => {
  it('explains invoice and login for registrations', () => {
    const steps = nextSteps(base, '');
    expect(steps.some((s) => s.includes('Fakturaen'))).toBe(true);
    expect(steps.some((s) => s.includes('trenger ikke passord'))).toBe(true);
  });
  it('explains the waitlist', () => {
    expect(nextSteps({ ...base, waitlist: true }, '')[0]).toContain('ventelisten');
  });
  it('includes the response time for requests', () => {
    expect(nextSteps({ ...base, kind: 'booking' }, 'Vi svarer vanligvis innen 2 virkedager.')[0]).toContain(
      'innen 2 virkedager'
    );
  });
});

describe('receiptForSubject', () => {
  it('shows the stored receipt only for the payment it belongs to', () => {
    expect(receiptForSubject(base, { kind: 'registration', id: 12 })).toBe(base);
    expect(receiptForSubject(base, { kind: 'registration', id: 13 })).toBeNull();
    expect(receiptForSubject(base, { kind: 'booking', id: 12 })).toBeNull();
    expect(receiptForSubject(base, null)).toBeNull();
    expect(receiptForSubject(null, { kind: 'registration', id: 12 })).toBeNull();
  });
});

describe('parseReceiptSubject / receiptSubjectQuery', () => {
  it('round-trips and rejects junk', () => {
    expect(receiptSubjectQuery({ kind: 'booking', id: 7 })).toBe('kind=booking&id=7');
    expect(parseReceiptSubject('booking', '7')).toEqual({ kind: 'booking', id: 7 });
    expect(parseReceiptSubject('registration', '12')).toEqual({ kind: 'registration', id: 12 });
    for (const [kind, id] of [['user', '1'], ['booking', '0'], ['booking', '-1'], ['booking', '1e3'], ['booking', undefined], [undefined, '1']]) {
      expect(parseReceiptSubject(kind, id)).toBeNull();
    }
  });
});
