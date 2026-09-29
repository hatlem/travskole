import { describe, it, expect } from 'vitest';
import {
  osloYear, dealYear, eventTypeKey, bookingDeals, rebookingByYear, rebookingByEventType,
  notYetRebooked, buildRebookingReport, NO_EVENT_TYPE, type RebookingDealRow,
} from '@/lib/crm/insights-rebooking';

let nextId = 1;
function deal(overrides: Partial<RebookingDealRow> & { contactId?: number; orgId?: number | null }): RebookingDealRow {
  const { contactId, orgId, ...rest } = overrides;
  const organization = orgId ? { id: orgId, name: `Bedrift ${orgId}` } : null;
  return {
    id: nextId++,
    title: 'Deal',
    status: 'won',
    value: 1000,
    eventType: 'julebord',
    eventDate: new Date('2025-12-05T18:00:00Z'),
    createdAt: new Date('2025-09-01T10:00:00Z'),
    contact: contactId
      ? { id: contactId, name: `Kontakt ${contactId}`, email: `k${contactId}@firma.no`, organizationId: orgId ?? null }
      : null,
    organization,
    ...rest,
  };
}
const d2025 = new Date('2025-12-05T18:00:00Z');
const d2026 = new Date('2026-12-04T18:00:00Z');

describe('osloYear / dealYear', () => {
  it('nyttårsaften 23:30 UTC er allerede nytt år i Oslo', () => {
    expect(osloYear(new Date('2025-12-31T23:30:00Z'))).toBe(2026);
  });
  it('bruker eventDate foran createdAt', () => {
    expect(dealYear({ eventDate: d2026, createdAt: new Date('2025-10-01T00:00:00Z') })).toBe(2026);
  });
  it('faller tilbake til createdAt uten eventDate', () => {
    expect(dealYear({ eventDate: null, createdAt: new Date('2024-03-01T00:00:00Z') })).toBe(2024);
  });
});

describe('eventTypeKey / bookingDeals', () => {
  it('normaliserer og gir fast nøkkel for manglende type', () => {
    expect(eventTypeKey(' Julebord ')).toBe('julebord');
    expect(eventTypeKey(null)).toBe(NO_EVENT_TYPE);
    expect(eventTypeKey('  ')).toBe(NO_EVENT_TYPE);
  });
  it('dropper tapte deals og filtrerer på type', () => {
    const rows = [
      deal({ contactId: 1 }),
      deal({ contactId: 2, status: 'lost' }),
      deal({ contactId: 3, eventType: 'kurs' }),
    ];
    expect(bookingDeals(rows, null).map((d) => d.contact?.id)).toEqual([1, 3]);
    expect(bookingDeals(rows, 'kurs').map((d) => d.contact?.id)).toEqual([3]);
  });
});

describe('rebookingByYear', () => {
  const rows = [
    deal({ contactId: 1, eventDate: d2025, value: 1000 }),
    deal({ contactId: 2, eventDate: d2025, value: 2000 }),
    deal({ contactId: 3, eventDate: d2025, value: 500 }),
    deal({ contactId: 4, eventDate: d2025, value: 500 }),
    deal({ contactId: 1, eventDate: d2026, value: 1500 }), // gjenganger, vunnet
    deal({ contactId: 2, eventDate: d2026, value: 9999, status: 'open' }), // gjenganger, ikke vunnet ennå
    deal({ contactId: 5, eventDate: d2026, value: 700 }), // ny kunde
  ];

  it('gjenbookingsrate = gjengangere / fjorårets kunder', () => {
    const [y2026] = rebookingByYear(rows, 'contact', [2026]);
    expect(y2026).toEqual({
      year: 2026,
      customers: 3,
      previousYearCustomers: 4,
      returning: 2,
      newCustomers: 1,
      rebookingRate: 50,
      returningValue: 1500, // åpen deal teller som booking, men ikke som verdi
      newValue: 700,
    });
  });

  it('rate er null uten fjorårskunder, og årene sorteres', () => {
    const stats = rebookingByYear(rows, 'contact', [2026, 2025]);
    expect(stats.map((s) => s.year)).toEqual([2025, 2026]);
    expect(stats[0].rebookingRate).toBeNull();
    expect(stats[0].newValue).toBe(4000);
  });

  it('flere deals for samme kunde samme år teller som én kunde', () => {
    const [s] = rebookingByYear(
      [deal({ contactId: 1, eventDate: d2026 }), deal({ contactId: 1, eventDate: d2026 })],
      'contact',
      [2026],
    );
    expect(s.customers).toBe(1);
    expect(s.newValue).toBe(2000);
  });

  it('bedriftsdimensjonen: ny kontakt i samme bedrift er gjenbooking for bedriften', () => {
    const orgRows = [
      deal({ contactId: 1, orgId: 10, eventDate: d2025 }),
      deal({ contactId: 2, orgId: 10, eventDate: d2026 }),
      deal({ contactId: 3, orgId: null, eventDate: d2026 }), // privat — ikke med i bedriftstall
    ];
    const [org] = rebookingByYear(orgRows, 'organization', [2026]);
    expect(org).toMatchObject({ customers: 1, previousYearCustomers: 1, returning: 1, rebookingRate: 100 });
    const [contact] = rebookingByYear(orgRows, 'contact', [2026]);
    expect(contact).toMatchObject({ customers: 2, returning: 0, rebookingRate: 0 });
  });

  it('rate avrundes til én desimal', () => {
    const r = [
      deal({ contactId: 1, eventDate: d2025 }), deal({ contactId: 2, eventDate: d2025 }),
      deal({ contactId: 3, eventDate: d2025 }), deal({ contactId: 1, eventDate: d2026 }),
    ];
    expect(rebookingByYear(r, 'contact', [2026])[0].rebookingRate).toBe(33.3);
  });
});

describe('rebookingByEventType', () => {
  it('gjenbooking måles innen samme type (julebord → julebord)', () => {
    const rows = [
      deal({ contactId: 1, eventDate: d2025, eventType: 'julebord' }),
      deal({ contactId: 1, eventDate: d2026, eventType: 'firmafest' }),
      deal({ contactId: 2, eventDate: d2025, eventType: 'julebord' }),
      deal({ contactId: 2, eventDate: d2026, eventType: 'julebord' }),
      deal({ contactId: 9, eventDate: new Date('2023-06-01T00:00:00Z'), eventType: 'kurs' }), // utenfor årsparet
    ];
    const byType = rebookingByEventType(rows, 2026);
    expect(byType.map((t) => t.eventType)).toEqual(['firmafest', 'julebord']);
    const julebord = byType.find((t) => t.eventType === 'julebord');
    expect(julebord?.contacts).toMatchObject({ customers: 1, previousYearCustomers: 2, returning: 1, rebookingRate: 50 });
    const fest = byType.find((t) => t.eventType === 'firmafest');
    expect(fest?.contacts).toMatchObject({ customers: 1, returning: 0, rebookingRate: null });
  });
});

describe('notYetRebooked', () => {
  it('lister fjorårets kunder uten booking i år, størst verdi først', () => {
    const rows = [
      deal({ contactId: 1, eventDate: d2025, value: 500 }),
      deal({ contactId: 2, eventDate: d2025, value: 3000 }),
      deal({ contactId: 3, eventDate: d2025, value: 800 }),
      deal({ contactId: 3, eventDate: d2026 }), // har booket igjen
    ];
    const { contacts, organizations } = notYetRebooked(rows, 2026);
    expect(contacts.map((c) => c.id)).toEqual([2, 1]);
    expect(contacts[0]).toMatchObject({ name: 'Kontakt 2', email: 'k2@firma.no', lastYearDeals: 1, lastYearValue: 3000, eventTypes: ['julebord'] });
    expect(organizations).toEqual([]);
  });

  it('kontakt regnes som gjenbooket når bedriften har booket via en kollega', () => {
    const rows = [
      deal({ contactId: 1, orgId: 10, eventDate: d2025 }),
      deal({ contactId: 2, orgId: 10, eventDate: d2026 }),
      deal({ contactId: 3, orgId: 20, eventDate: d2025 }),
    ];
    const { contacts, organizations } = notYetRebooked(rows, 2026);
    expect(organizations.map((o) => o.id)).toEqual([20]);
    expect(contacts.map((c) => c.id)).toEqual([3]);
  });

  it('bruker kontaktens bedrift når dealen mangler organisasjon', () => {
    const rows = [
      { ...deal({ contactId: 1, eventDate: d2025 }), contact: { id: 1, name: 'A', email: null, organizationId: 10 } },
      deal({ contactId: 2, orgId: 10, eventDate: d2026 }),
    ];
    expect(notYetRebooked(rows, 2026).contacts).toEqual([]);
  });

  it('samler flere fjorårsdeals: antall, vunnet verdi, siste dato og typer', () => {
    const rows = [
      deal({ contactId: 1, eventDate: new Date('2025-03-01T12:00:00Z'), eventType: 'kurs', value: 200 }),
      deal({ contactId: 1, eventDate: d2025, eventType: 'julebord', value: 1000 }),
      deal({ contactId: 1, eventDate: new Date('2025-06-01T12:00:00Z'), status: 'open', value: 5000 }),
    ];
    const [c] = notYetRebooked(rows, 2026).contacts;
    expect(c).toMatchObject({ lastYearDeals: 3, lastYearValue: 1200, lastEventDate: d2025.toISOString(), eventTypes: ['julebord', 'kurs'] });
  });
});

describe('buildRebookingReport', () => {
  const rows = [
    deal({ contactId: 1, eventDate: d2025, eventType: 'julebord' }),
    deal({ contactId: 2, eventDate: d2025, eventType: 'kurs' }),
    deal({ contactId: 2, eventDate: d2026, eventType: 'kurs' }),
    deal({ contactId: 3, eventDate: d2025, eventType: 'julebord', status: 'lost' }),
  ];

  it('typefilter gjelder trend og ringeliste, men typeoversikten viser alle', () => {
    const report = buildRebookingReport(rows, { year: 2026, eventType: 'julebord', years: [2023, 2024, 2025, 2026] });
    expect(report.availableYears).toEqual([2025, 2026]);
    expect(report.eventTypes).toEqual(['julebord', 'kurs']);
    expect(report.contacts.find((s) => s.year === 2026)).toMatchObject({ previousYearCustomers: 1, returning: 0 });
    expect(report.notRebooked.contacts.map((c) => c.id)).toEqual([1]); // tapt deal (kontakt 3) er ingen kunde
    expect(report.byEventType.map((t) => t.eventType)).toEqual(['julebord', 'kurs']);
  });

  it('valgt år er alltid med selv uten data', () => {
    const report = buildRebookingReport([], { year: 2026, eventType: null, years: [2025, 2026] });
    expect(report.availableYears).toEqual([2026]);
    expect(report.contacts).toEqual([
      expect.objectContaining({ year: 2026, customers: 0, rebookingRate: null }),
    ]);
  });
});
