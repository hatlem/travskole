import { describe, it, expect } from 'vitest';
import { bookingToCrm, registrationToCrm, computeDealUpdate, type BookingForCrm, type CourseForCrm, type RegistrationForCrm } from '@/lib/crm/bridge-mapping';

const course = (o: Partial<CourseForCrm> = {}): CourseForCrm => ({
  name: 'Julebord på Bjerke', type: 'julebord', price: 850, startDate: new Date('2026-12-11'), ...o,
});
const booking = (o: Partial<BookingForCrm> = {}): BookingForCrm => ({
  id: 7, name: 'Kari Hansen', email: 'Kari@Acme.NO', phone: '99887766',
  participants: 20, preferredDate: new Date('2026-12-04'), status: 'new',
  userId: null, createdAt: new Date('2026-07-01'), ...o,
});
const registration = (o: Partial<RegistrationForCrm> = {}): RegistrationForCrm => ({
  id: 42, status: 'confirmed', createdAt: new Date('2026-05-01'),
  parent: { id: 3, name: 'Ola Nordmann', phone: '48123456', userId: 9, user: { email: 'ola@gmail.com' } },
  ...o,
});

describe('bookingToCrm', () => {
  it('company email creates organization, normalized contact email', () => {
    const input = bookingToCrm(booking(), course());
    expect(input.organization).toEqual({ name: 'Acme', domain: 'acme.no' });
    expect(input.contact.email).toBe('kari@acme.no');
    expect(input.contact.source).toBe('booking');
  });
  it('freemail creates no organization', () => {
    expect(bookingToCrm(booking({ email: 'kari@gmail.com' }), course()).organization).toBeNull();
  });
  it('deal carries eventType/date/value from course and participants', () => {
    const { deal } = bookingToCrm(booking(), course());
    expect(deal.eventType).toBe('julebord');
    expect(deal.eventDate).toEqual(new Date('2026-12-04')); // preferredDate vinner
    expect(deal.value).toBe(850 * 20);
    expect(deal.bookingRequestId).toBe(7);
    expect(deal.registrationId).toBeNull();
  });
  it('falls back to course.startDate without preferredDate', () => {
    expect(bookingToCrm(booking({ preferredDate: null }), course()).deal.eventDate)
      .toEqual(new Date('2026-12-11'));
  });
  it('status mapping: new→open, confirmed→won, cancelled→lost (no stage names)', () => {
    expect(bookingToCrm(booking(), course()).deal.status).toBe('open');
    expect(bookingToCrm(booking({ status: 'confirmed' }), course()).deal.status).toBe('won');
    expect(bookingToCrm(booking({ status: 'cancelled' }), course()).deal.status).toBe('lost');
    expect(bookingToCrm(booking(), course()).deal).not.toHaveProperty('stageName');
  });
  it('null price gives null value', () => {
    expect(bookingToCrm(booking(), course({ price: null })).deal.value).toBeNull();
  });
  it('activity uses createdAt for backfill-correct timeline', () => {
    const { activity } = bookingToCrm(booking(), course());
    expect(activity.type).toBe('booking');
    expect(activity.occurredAt).toEqual(new Date('2026-07-01'));
  });
});

describe('registrationToCrm', () => {
  it('maps parent to contact, never creates organization', () => {
    const input = registrationToCrm(registration(), course({ type: 'kurs', name: 'Begynnerkurs' }));
    expect(input.organization).toBeNull();
    expect(input.contact).toMatchObject({
      email: 'ola@gmail.com', name: 'Ola Nordmann', parentId: 3, userId: 9, source: 'registration',
    });
  });
  it('deal is kurs-typed with course price and registrationId', () => {
    const { deal } = registrationToCrm(registration(), course({ type: 'kurs', name: 'Begynnerkurs', price: 2500 }));
    expect(deal).toMatchObject({
      eventType: 'kurs', value: 2500, registrationId: 42, bookingRequestId: null,
      status: 'won',
    });
  });
  it('pending and waitlist registrations are open', () => {
    expect(registrationToCrm(registration({ status: 'pending' }), course()).deal.status).toBe('open');
    expect(registrationToCrm(registration({ status: 'waitlist' }), course()).deal.status).toBe('open');
  });
});

describe('computeDealUpdate', () => {
  const now = new Date('2026-09-29T12:00:00Z');
  const opts = { targetStageId: 99, now };
  const existing = (o: Partial<{ status: string; title: string; value: number | null; closedAt: Date | null }> = {}) => ({
    status: 'open', title: 'Manuell tittel', value: 1234, closedAt: null, ...o,
  });
  const mapped = (o: Partial<{ status: 'open' | 'won' | 'lost'; title: string; value: number | null }> = {}) => ({
    status: 'open' as const, title: 'Kurs — Ola', value: 2500, ...o,
  });

  it('same status keeps the manual stage, title and value', () => {
    expect(computeDealUpdate(existing(), mapped(), opts)).toEqual({});
  });
  it('status change moves to the role stage and sets closedAt once', () => {
    expect(computeDealUpdate(existing(), mapped({ status: 'won' }), opts))
      .toEqual({ stageId: 99, status: 'won', closedAt: now });
  });
  it('preserves the first closedAt when moving between closed statuses', () => {
    const closedAt = new Date('2026-01-01');
    expect(computeDealUpdate(existing({ status: 'won', closedAt }), mapped({ status: 'lost' }), opts))
      .toEqual({ stageId: 99, status: 'lost' });
  });
  it('reopening clears closedAt', () => {
    expect(computeDealUpdate(existing({ status: 'lost', closedAt: now }), mapped({ status: 'open' }), opts))
      .toEqual({ stageId: 99, status: 'open', closedAt: null });
  });
  it('allowReopen=false never reopens a closed deal', () => {
    expect(computeDealUpdate(existing({ status: 'won', closedAt: now }), mapped(), { ...opts, allowReopen: false }))
      .toEqual({});
    // men lukking går fortsatt gjennom
    expect(computeDealUpdate(existing(), mapped({ status: 'lost' }), { ...opts, allowReopen: false }))
      .toMatchObject({ stageId: 99, status: 'lost' });
  });
  it('fills title and value only when missing', () => {
    expect(computeDealUpdate(existing({ title: '  ', value: null }), mapped(), opts))
      .toEqual({ title: 'Kurs — Ola', value: 2500 });
    expect(computeDealUpdate(existing({ value: null }), mapped({ value: null }), opts)).toEqual({});
  });
});
