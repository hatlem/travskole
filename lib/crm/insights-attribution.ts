// E-post → booking-attribusjon (last-touch) for innsiktssiden. En booking
// krediteres flyten hvis e-post kontakten sist klikket (eller, uten klikk,
// sist åpnet) innen vinduet før bookingen. Ren logikk, ingen IO.

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_ATTRIBUTION_WINDOW_DAYS = 14;
export const MAX_ATTRIBUTION_WINDOW_DAYS = 90;
export const ATTRIBUTION_PERIOD_OPTIONS = [30, 90, 180, 365] as const;

export function parseAttributionWindowDays(raw: string | null | undefined): number {
  const n = Number(raw?.trim());
  return Number.isInteger(n) && n >= 1 && n <= MAX_ATTRIBUTION_WINDOW_DAYS ? n : DEFAULT_ATTRIBUTION_WINDOW_DAYS;
}

// ── Konverteringer ─────────────────────────────────────────────────────────

export interface AttributionDealRow {
  id: number;
  contactId: number | null;
  status: string; // open | won | lost
  value: number | null;
  createdAt: Date;
  closedAt: Date | null;
  registrationId: number | null;
  bookingRequestId: number | null;
}

export const CONVERSION_EVENT_TYPES = ['registration.created', 'booking.created', 'payment.succeeded'] as const;

export interface AttributionEventRow {
  type: string; // en av CONVERSION_EVENT_TYPES
  contactId: number | null;
  occurredAt: Date;
  meta: string; // JSON fra AppEvent.meta
}

export interface ConversionMoment {
  contactId: number;
  at: Date;
}

/** Én booking — deal, påmelding/forespørsel og betaling for samme sak slås sammen. */
export interface ConversionUnit {
  key: string;
  moments: ConversionMoment[];
  value: number;
}

interface ParsedMeta {
  registrationId: number | null;
  bookingRequestId: number | null;
  amountKr: number | null;
}

export function parseConversionMeta(json: string): ParsedMeta {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    raw = null;
  }
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null);
  const amount = typeof obj.amountKr === 'number' && Number.isFinite(obj.amountKr) ? obj.amountKr : null;
  return { registrationId: int(obj.registrationId), bookingRequestId: int(obj.bookingRequestId), amountKr: amount };
}

function unitKey(ids: { registrationId: number | null; bookingRequestId: number | null }, fallback: string): string {
  if (ids.registrationId !== null) return `reg:${ids.registrationId}`;
  if (ids.bookingRequestId !== null) return `book:${ids.bookingRequestId}`;
  return fallback;
}

/**
 * Slår deals og bus-hendelser sammen til bookinger. Øyeblikk (opprettet,
 * vunnet, betalt) utenfor [from, to] ignoreres; bookinger uten øyeblikk i
 * perioden, eller med tapt deal, tas ikke med. Verdi = vunnet deal-verdi,
 * ellers innbetalt beløp.
 */
export function buildConversionUnits(
  deals: AttributionDealRow[],
  events: AttributionEventRow[],
  period: { from: Date; to: Date },
): ConversionUnit[] {
  const inPeriod = (d: Date) => d >= period.from && d <= period.to;
  const units = new Map<string, { moments: ConversionMoment[]; wonValue: number | null; paid: number; lost: boolean }>();
  const unit = (key: string) => {
    const existing = units.get(key);
    if (existing) return existing;
    const fresh = { moments: [] as ConversionMoment[], wonValue: null as number | null, paid: 0, lost: false };
    units.set(key, fresh);
    return fresh;
  };
  const addMoment = (u: { moments: ConversionMoment[] }, contactId: number | null, at: Date | null) => {
    if (contactId !== null && at !== null && inPeriod(at)) u.moments.push({ contactId, at });
  };

  for (const deal of deals) {
    const u = unit(unitKey(deal, `deal:${deal.id}`));
    if (deal.status === 'lost') u.lost = true;
    addMoment(u, deal.contactId, deal.createdAt);
    if (deal.status === 'won') {
      u.wonValue = (u.wonValue ?? 0) + (deal.value ?? 0);
      addMoment(u, deal.contactId, deal.closedAt);
    }
  }

  let orphan = 0;
  for (const event of events) {
    const meta = parseConversionMeta(event.meta);
    const u = unit(unitKey(meta, `event:${orphan++}`));
    addMoment(u, event.contactId, event.occurredAt);
    if (event.type === 'payment.succeeded' && meta.amountKr !== null && inPeriod(event.occurredAt)) {
      u.paid += meta.amountKr;
    }
  }

  const out: ConversionUnit[] = [];
  for (const [key, u] of units) {
    if (u.lost || u.moments.length === 0) continue;
    out.push({ key, moments: u.moments, value: u.wonValue ?? u.paid });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

// ── Berøringer og kreditering ────────────────────────────────────────────────

export interface TouchSendRow {
  flowId: number;
  contactId: number;
  openedAt: Date | null;
  firstClickedAt: Date | null;
}

export type TouchKind = 'click' | 'open';

interface Touch {
  flowId: number;
  kind: TouchKind;
  at: Date;
}

export interface Attribution {
  key: string;
  flowId: number;
  via: TouchKind;
  touchAt: Date;
  value: number;
}

function touchesByContact(sends: TouchSendRow[]): Map<number, Touch[]> {
  const map = new Map<number, Touch[]>();
  for (const send of sends) {
    const list = map.get(send.contactId) ?? [];
    if (send.firstClickedAt) list.push({ flowId: send.flowId, kind: 'click', at: send.firstClickedAt });
    if (send.openedAt) list.push({ flowId: send.flowId, kind: 'open', at: send.openedAt });
    map.set(send.contactId, list);
  }
  return map;
}

/**
 * Last-touch med klikk foran åpning: nyeste klikk innen vinduet før et av
 * bookingens øyeblikk vinner; finnes ingen klikk, nyeste åpning.
 */
export function attributeConversions(
  units: ConversionUnit[],
  sends: TouchSendRow[],
  windowDays: number,
): Attribution[] {
  const byContact = touchesByContact(sends);
  const windowMs = windowDays * DAY_MS;
  const out: Attribution[] = [];

  for (const unit of units) {
    let best: Touch | null = null;
    for (const moment of unit.moments) {
      for (const touch of byContact.get(moment.contactId) ?? []) {
        const lag = moment.at.getTime() - touch.at.getTime();
        if (lag < 0 || lag > windowMs) continue;
        if (best === null || beats(touch, best)) best = touch;
      }
    }
    if (best) out.push({ key: unit.key, flowId: best.flowId, via: best.kind, touchAt: best.at, value: unit.value });
  }
  return out;
}

function beats(candidate: Touch, current: Touch): boolean {
  if (candidate.kind !== current.kind) return candidate.kind === 'click';
  if (candidate.at.getTime() !== current.at.getTime()) return candidate.at > current.at;
  return candidate.flowId < current.flowId; // deterministisk ved likt tidspunkt
}

// ── Oppsummering ─────────────────────────────────────────────────────────────

export interface FlowAttributionRow {
  flowId: number;
  name: string;
  status: string;
  sent: number;
  attributed: number;
  viaClick: number;
  viaOpen: number;
  value: number;
  /** Tilskrevne bookinger per sendte e-post, i prosent med én desimal. null uten sendinger. */
  conversionRate: number | null;
}

export interface AttributionSummary {
  perFlow: FlowAttributionRow[];
  total: Omit<FlowAttributionRow, 'flowId' | 'name' | 'status'> & {
    conversions: number;
    /** Andel av alle bookinger i perioden som kan knyttes til en e-post. */
    attributedShare: number | null;
  };
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

export function summarizeAttribution(
  attributions: Attribution[],
  flows: { id: number; name: string; status: string }[],
  sentByFlow: Map<number, number>,
  totalConversions: number,
): AttributionSummary {
  const perFlow = flows.map((flow): FlowAttributionRow => {
    const mine = attributions.filter((a) => a.flowId === flow.id);
    const sent = sentByFlow.get(flow.id) ?? 0;
    const viaClick = mine.filter((a) => a.via === 'click').length;
    return {
      flowId: flow.id,
      name: flow.name,
      status: flow.status,
      sent,
      attributed: mine.length,
      viaClick,
      viaOpen: mine.length - viaClick,
      value: mine.reduce((sum, a) => sum + a.value, 0),
      conversionRate: pct(mine.length, sent),
    };
  });
  perFlow.sort((a, b) => b.attributed - a.attributed || b.value - a.value || a.name.localeCompare(b.name, 'nb'));

  const known = new Set(flows.map((f) => f.id));
  const counted = attributions.filter((a) => known.has(a.flowId));
  const sent = perFlow.reduce((sum, f) => sum + f.sent, 0);
  const viaClick = counted.filter((a) => a.via === 'click').length;
  return {
    perFlow,
    total: {
      sent,
      attributed: counted.length,
      viaClick,
      viaOpen: counted.length - viaClick,
      value: counted.reduce((sum, a) => sum + a.value, 0),
      conversionRate: pct(counted.length, sent),
      conversions: totalConversions,
      attributedShare: pct(counted.length, totalConversions),
    },
  };
}
