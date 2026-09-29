// Gjenbookingsanalyse for innsiktssiden: hvor mange av fjorårets kunder
// (kontakter og bedrifter hver for seg) som booker igjen, verdien fra
// gjengangere vs nye kunder, og hvem som ikke har booket ennå. Ren logikk.

const OSLO_YEAR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', year: 'numeric' });

export function osloYear(d: Date): number {
  return Number(OSLO_YEAR.format(d));
}

export interface RebookingDealRow {
  id: number;
  title: string;
  status: string; // open | won | lost
  value: number | null;
  eventType: string | null;
  eventDate: Date | null;
  createdAt: Date;
  contact: { id: number; name: string; email: string | null; organizationId: number | null } | null;
  organization: { id: number; name: string } | null;
}

export type CustomerDimension = 'contact' | 'organization';

export const NO_EVENT_TYPE = '(uten type)';

/** Arrangementets sesong: eventDate (Oslo-år), ellers når dealen ble opprettet. */
export function dealYear(deal: Pick<RebookingDealRow, 'eventDate' | 'createdAt'>): number {
  return osloYear(deal.eventDate ?? deal.createdAt);
}

export function eventTypeKey(eventType: string | null): string {
  const trimmed = eventType?.trim().toLowerCase();
  return trimmed ? trimmed : NO_EVENT_TYPE;
}

/** Tapte deals er ingen booking; `null` = alle arrangementstyper. */
export function bookingDeals(deals: RebookingDealRow[], eventType: string | null): RebookingDealRow[] {
  return deals.filter((d) => d.status !== 'lost' && (eventType === null || eventTypeKey(d.eventType) === eventType));
}

function customerId(deal: RebookingDealRow, dimension: CustomerDimension): number | null {
  if (dimension === 'organization') return deal.organization?.id ?? null;
  return deal.contact?.id ?? null;
}

function wonValue(deal: RebookingDealRow): number {
  return deal.status === 'won' ? deal.value ?? 0 : 0;
}

function customersByYear(deals: RebookingDealRow[], dimension: CustomerDimension): Map<number, Set<number>> {
  const byYear = new Map<number, Set<number>>();
  for (const deal of deals) {
    const id = customerId(deal, dimension);
    if (id === null) continue;
    const year = dealYear(deal);
    const set = byYear.get(year) ?? new Set<number>();
    set.add(id);
    byYear.set(year, set);
  }
  return byYear;
}

export interface RebookingYearStats {
  year: number;
  customers: number;
  previousYearCustomers: number;
  returning: number;
  newCustomers: number;
  /** Andel av fjorårets kunder som booket igjen, i prosent med én desimal. null uten fjorårskunder. */
  rebookingRate: number | null;
  returningValue: number;
  newValue: number;
}

/** Nøkkeltall per år (eldste først) for én kundedimensjon. `deals` bør allerede være filtrert med bookingDeals. */
export function rebookingByYear(
  deals: RebookingDealRow[],
  dimension: CustomerDimension,
  years: number[],
): RebookingYearStats[] {
  const byYear = customersByYear(deals, dimension);
  const valueByYear = new Map<number, { returning: number; fresh: number }>();
  for (const deal of deals) {
    const id = customerId(deal, dimension);
    if (id === null) continue;
    const year = dealYear(deal);
    const acc = valueByYear.get(year) ?? { returning: 0, fresh: 0 };
    if (byYear.get(year - 1)?.has(id)) acc.returning += wonValue(deal);
    else acc.fresh += wonValue(deal);
    valueByYear.set(year, acc);
  }

  return [...years].sort((a, b) => a - b).map((year) => {
    const current = byYear.get(year) ?? new Set<number>();
    const previous = byYear.get(year - 1) ?? new Set<number>();
    let returning = 0;
    for (const id of current) if (previous.has(id)) returning++;
    const value = valueByYear.get(year) ?? { returning: 0, fresh: 0 };
    return {
      year,
      customers: current.size,
      previousYearCustomers: previous.size,
      returning,
      newCustomers: current.size - returning,
      rebookingRate: previous.size > 0 ? Math.round((returning / previous.size) * 1000) / 10 : null,
      returningValue: value.returning,
      newValue: value.fresh,
    };
  });
}

export interface EventTypeRebooking {
  eventType: string;
  contacts: RebookingYearStats;
  organizations: RebookingYearStats;
}

/** Gjenbooking av samme arrangementstype (julebord → julebord) for ett år, per type. */
export function rebookingByEventType(deals: RebookingDealRow[], year: number): EventTypeRebooking[] {
  const relevant = bookingDeals(deals, null).filter((d) => {
    const y = dealYear(d);
    return y === year || y === year - 1;
  });
  const types = [...new Set(relevant.map((d) => eventTypeKey(d.eventType)))].sort((a, b) => a.localeCompare(b, 'nb'));
  return types.map((eventType) => {
    const ofType = bookingDeals(relevant, eventType);
    return {
      eventType,
      contacts: rebookingByYear(ofType, 'contact', [year])[0],
      organizations: rebookingByYear(ofType, 'organization', [year])[0],
    };
  });
}

export interface NotRebookedCustomer {
  id: number;
  name: string;
  email: string | null;
  lastYearDeals: number;
  lastYearValue: number;
  lastEventDate: string; // ISO — siste arrangement i fjor
  eventTypes: string[];
}

export interface NotRebookedLists {
  organizations: NotRebookedCustomer[];
  /** Privatkunder, og kontakter hvis bedrift ikke har booket igjen via en kollega. */
  contacts: NotRebookedCustomer[];
}

/**
 * Fjorårets kunder uten booking i `year` — ringelisten for gjenbooking.
 * En kontakt hvis bedrift allerede har booket i år regnes som gjenbooket.
 */
export function notYetRebooked(deals: RebookingDealRow[], year: number): NotRebookedLists {
  const lastYear = deals.filter((d) => dealYear(d) === year - 1);
  const thisYear = deals.filter((d) => dealYear(d) === year);
  const orgsThisYear = new Set(thisYear.flatMap((d) => (d.organization ? [d.organization.id] : [])));
  const contactsThisYear = new Set(thisYear.flatMap((d) => (d.contact ? [d.contact.id] : [])));

  const orgs = new Map<number, NotRebookedCustomer>();
  const contacts = new Map<number, NotRebookedCustomer>();
  const add = (map: Map<number, NotRebookedCustomer>, base: Pick<NotRebookedCustomer, 'id' | 'name' | 'email'>, deal: RebookingDealRow) => {
    const entry = map.get(base.id) ?? { ...base, lastYearDeals: 0, lastYearValue: 0, lastEventDate: '', eventTypes: [] };
    entry.lastYearDeals++;
    entry.lastYearValue += wonValue(deal);
    const at = (deal.eventDate ?? deal.createdAt).toISOString();
    if (at > entry.lastEventDate) entry.lastEventDate = at;
    const type = eventTypeKey(deal.eventType);
    if (!entry.eventTypes.includes(type)) entry.eventTypes.push(type);
    map.set(base.id, entry);
  };

  for (const deal of lastYear) {
    const org = deal.organization;
    if (org && !orgsThisYear.has(org.id)) add(orgs, { id: org.id, name: org.name, email: null }, deal);
    const contact = deal.contact;
    if (!contact || contactsThisYear.has(contact.id)) continue;
    const orgId = org?.id ?? contact.organizationId;
    if (orgId !== null && orgsThisYear.has(orgId)) continue;
    add(contacts, { id: contact.id, name: contact.name, email: contact.email }, deal);
  }

  const sorted = (map: Map<number, NotRebookedCustomer>) =>
    [...map.values()]
      .map((e) => ({ ...e, eventTypes: [...e.eventTypes].sort((a, b) => a.localeCompare(b, 'nb')) }))
      .sort((a, b) => b.lastYearValue - a.lastYearValue || a.name.localeCompare(b.name, 'nb'));
  return { organizations: sorted(orgs), contacts: sorted(contacts) };
}

export interface RebookingReport {
  year: number;
  eventType: string | null;
  availableYears: number[];
  eventTypes: string[];
  contacts: RebookingYearStats[];
  organizations: RebookingYearStats[];
  byEventType: EventTypeRebooking[];
  notRebooked: NotRebookedLists;
}

/** Samler hele gjenbookingsfanen. `years` = kandidatår; år uten data (i år eller året før) droppes. */
export function buildRebookingReport(
  deals: RebookingDealRow[],
  { year, eventType, years }: { year: number; eventType: string | null; years: number[] },
): RebookingReport {
  const all = bookingDeals(deals, null);
  const filtered = bookingDeals(all, eventType);
  const dataYears = new Set(all.map(dealYear));
  const availableYears = years.filter((y) => dataYears.has(y) || dataYears.has(y - 1) || y === year);
  return {
    year,
    eventType,
    availableYears,
    eventTypes: [...new Set(all.map((d) => eventTypeKey(d.eventType)))].sort((a, b) => a.localeCompare(b, 'nb')),
    contacts: rebookingByYear(filtered, 'contact', availableYears),
    organizations: rebookingByYear(filtered, 'organization', availableYears),
    byEventType: rebookingByEventType(all, year),
    notRebooked: notYetRebooked(filtered, year),
  };
}
