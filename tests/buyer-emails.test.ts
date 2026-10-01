import { describe, it, expect } from 'vitest';
import {
  buildBookingConfirmationEmail,
  buildCancellationEmail,
  buildRegistrationConfirmationEmail,
  registrationPaymentText,
} from '@/lib/buyer-emails';

const ctx = {
  baseUrl: 'https://registrering.bjerke.no',
  settings: {
    site_name: 'Bjerke Registrering',
    contact_email: 'registrering@bjerke.no',
    contact_address: 'Refstadveien 27, 0589 Oslo',
    course_packing_list: 'Ridehjelm\nStøvler',
    consent_terms_text:
      'Påmeldingen er bindende. Ved avbestilling senere enn 3 dager før oppstart påløper et gebyr på kr 500,–. Alt skjer på eget ansvar.',
  },
};

const registration = {
  courseName: 'Ponniskole <høst>',
  childName: 'Ola',
  parentName: 'Kari',
  parentEmail: 'kari@example.no',
  parentPhone: '91234567',
  courseStart: new Date('2027-12-01T10:00:00Z'),
  courseEnd: new Date('2027-12-05T10:00:00Z'),
  priceKr: 1500,
  paymentMethods: ['faktura'],
};

describe('buildRegistrationConfirmationEmail', () => {
  const { subject, html } = buildRegistrationConfirmationEmail(registration, ctx);

  it('includes dates, place, price and payment', () => {
    expect(subject).toBe('Påmelding mottatt — Ponniskole <høst>');
    expect(html).toContain('1.–5. desember 2027');
    expect(html).toContain('Refstadveien 27, 0589 Oslo');
    expect(html.replace(/ /g, ' ')).toContain('1 500 kr');
    expect(html).toContain('Faktura sendes');
  });

  it('escapes user content', () => {
    expect(html).toContain('Ponniskole &lt;høst&gt;');
    expect(html).not.toContain('<høst>');
  });

  it('includes packing list, cancellation terms and a login link', () => {
    expect(html).toContain('<li>Ridehjelm</li>');
    expect(html).toContain('Ved avbestilling senere enn 3 dager');
    expect(html).toContain('https://registrering.bjerke.no/login?callbackUrl=%2Fdashboard');
    expect(html).toContain('https://registrering.bjerke.no/vilkar');
  });

  it('drops the packing list for the waitlist', () => {
    const waitlist = buildRegistrationConfirmationEmail({ ...registration, isWaitlist: true }, ctx);
    expect(waitlist.subject).toContain('Venteliste');
    expect(waitlist.html).not.toContain('<li>Ridehjelm</li>');
    expect(waitlist.html).toContain('Ingen betaling før du får plass');
  });
});

describe('registrationPaymentText', () => {
  it('covers free, online and mixed methods', () => {
    expect(registrationPaymentText({ priceKr: 0 })).toContain('Gratis');
    expect(registrationPaymentText({ priceKr: 100, paymentMethods: ['vipps'] })).toContain('Min side');
    expect(registrationPaymentText({ priceKr: 100, paymentMethods: ['stripe', 'faktura'] })).toContain('velg faktura');
  });
});

describe('buildBookingConfirmationEmail', () => {
  it('names the event, response time and total price', () => {
    const { subject, html } = buildBookingConfirmationEmail(
      { courseName: 'Dobbeltsulky', name: 'Kari', email: 'k@x.no', phone: '1', participants: 2, priceKr: 750 },
      ctx
    );
    expect(subject).toBe('Forespørsel mottatt — Dobbeltsulky');
    expect(html).toContain('Takk for forespørselen om Dobbeltsulky');
    expect(html).toContain('innen 2 virkedager');
    expect(html).toContain('2 deltakere');
    expect(html.replace(/ /g, ' ')).toContain('1 500 kr');
  });
});

describe('buildCancellationEmail', () => {
  it('confirms a registration cancellation', () => {
    const { subject, html } = buildCancellationEmail(
      { kind: 'registration', name: 'Kari', courseName: 'Ponniskole', participant: 'Ola', courseStart: '2027-12-01T10:00:00Z' },
      ctx
    );
    expect(subject).toBe('Avbestilling bekreftet — Ponniskole');
    expect(html).toContain('for Ola er avbestilt');
    expect(html).toContain('Avbestilt');
  });
  it('confirms a withdrawn request', () => {
    const { subject, html } = buildCancellationEmail(
      { kind: 'booking', name: 'Kari', courseName: 'Dobbeltsulky', participant: 'Kari' },
      ctx
    );
    expect(subject).toBe('Forespørsel trukket — Dobbeltsulky');
    expect(html).toContain('Trukket');
  });
});
