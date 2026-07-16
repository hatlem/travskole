import { describe, it, expect } from 'vitest';
import { bookingToCrm, registrationToCrm, type BookingForCrm, type CourseForCrm, type RegistrationForCrm } from '@/lib/crm/bridge-mapping';

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
  it('status mapping: new→Ny/open, confirmed→Bekreftet/won, cancelled→Tapt/lost', () => {
    expect(bookingToCrm(booking(), course()).deal).toMatchObject({ status: 'open', stageName: 'Ny' });
    expect(bookingToCrm(booking({ status: 'confirmed' }), course()).deal).toMatchObject({ status: 'won', stageName: 'Bekreftet' });
    expect(bookingToCrm(booking({ status: 'cancelled' }), course()).deal).toMatchObject({ status: 'lost', stageName: 'Tapt' });
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
      status: 'won', stageName: 'Bekreftet',
    });
  });
  it('pending registration is open/Ny', () => {
    expect(registrationToCrm(registration({ status: 'pending' }), course()).deal)
      .toMatchObject({ status: 'open', stageName: 'Ny' });
  });
});
