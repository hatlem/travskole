import { describe, it, expect } from 'vitest';
import { describeEventMeta, formatEventTime, shortUrl } from '@/lib/crm/event-details';

describe('describeEventMeta', () => {
  it('describes list, consent and course events in plain Norwegian', () => {
    expect(describeEventMeta('list.member_added', '{"listId":4,"listName":"Julebord 2026","source":"manual"}'))
      .toBe('Liste: Julebord 2026, for hånd');
    expect(describeEventMeta('consent.updated', { marketing: false, kilde: 'avmelding' }))
      .toBe('Nei til markedsføring via avmeldingslenken');
    expect(describeEventMeta('registration.created', '{"registrationId":1,"courseId":2,"courseName":"Ponnikurs høst"}'))
      .toBe('Kurs: Ponnikurs høst');
  });

  it('shortens urls and shows page titles', () => {
    expect(describeEventMeta('email.clicked', '{"url":"https://www.bjerke.no/kurs/ponni/?utm_source=x"}'))
      .toBe('Lenke: bjerke.no/kurs/ponni');
    expect(describeEventMeta('page.viewed', '{"site":"bjerke","path":"/kurs","title":"Kurs"}')).toBe('Kurs (/kurs)');
    expect(shortUrl('ikke en url')).toBe('ikke en url');
  });

  it('formats payments and bounces, hides internal ids', () => {
    expect(describeEventMeta('payment.succeeded', '{"provider":"vipps","amountKr":1200,"registrationId":3}'))
      .toBe(`${(1200).toLocaleString('nb-NO')} kr`);
    expect(describeEventMeta('email.bounced', '{"hard":true}')).toBe('Adressen finnes ikke (permanent)');
    expect(describeEventMeta('email.opened', '{"messageSendId":9}')).toBe('');
  });

  it('tolerates broken or missing meta', () => {
    expect(describeEventMeta('page.viewed', '{oops')).toBe('');
    expect(describeEventMeta('booking.status_changed', null)).toBe('');
    expect(describeEventMeta('booking.status_changed', '{"status":"confirmed"}')).toBe('Ny status: Bekreftet');
  });
});

describe('formatEventTime', () => {
  it('uses Norwegian month names and Oslo time', () => {
    expect(formatEventTime('2026-07-13T12:05:00Z')).toBe('13. juli 2026 kl. 14:05');
    expect(formatEventTime('2026-01-02T23:30:00Z')).toBe('3. januar 2026 kl. 00:30');
    expect(formatEventTime('nope')).toBe('');
  });
});
