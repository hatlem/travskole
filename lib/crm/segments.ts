// Segmentregler: { all: [{ field, op, value }] } — AND over alle regler.
// Kontaktfelter: stage, source, email, organizationId, lastActivityAt, tags.
// Deal-felter prefikses "deal." — alle deal-regler i et segment må matche
// SAMME deal (f.eks. «julebord» OG «dato før 2026» = ett julebord før 2026).
// Evalueres ved lesing — ingen lagrede medlemskapsrader.

export type SegmentOp = 'eq' | 'neq' | 'contains' | 'lt' | 'gt' | 'is_null' | 'not_null';

export interface SegmentRule {
  field: string;
  op: SegmentOp;
  value?: unknown;
}

export interface SegmentRules {
  all: SegmentRule[];
}

export interface SegmentContact {
  stage: string;
  source: string;
  email: string | null;
  organizationId: number | null;
  lastActivityAt: Date | null;
  tags: string[];
  deals: { eventType: string | null; eventDate: Date | null; status: string }[];
}

const OPS: SegmentOp[] = ['eq', 'neq', 'contains', 'lt', 'gt', 'is_null', 'not_null'];

export function parseSegmentRules(json: string): SegmentRules {
  try {
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.all)) return { all: [] };
    const all = (parsed.all as unknown[]).filter((r): r is SegmentRule => {
      if (!r || typeof r !== 'object') return false;
      const rule = r as Record<string, unknown>;
      return typeof rule.field === 'string' && OPS.includes(rule.op as SegmentOp);
    });
    return { all };
  } catch {
    return { all: [] };
  }
}

function toComparable(value: unknown): number | string | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const asDate = Date.parse(value);
    if (!Number.isNaN(asDate) && /\d{4}-\d{2}-\d{2}/.test(value)) return asDate;
    return value;
  }
  if (typeof value === 'number') return value;
  return null;
}

function checkValue(actual: unknown, rule: SegmentRule): boolean {
  switch (rule.op) {
    case 'is_null':
      return actual === null || actual === undefined;
    case 'not_null':
      return actual !== null && actual !== undefined;
    case 'eq':
      return actual === rule.value;
    case 'neq':
      return actual !== rule.value;
    case 'contains':
      if (Array.isArray(actual)) return actual.includes(rule.value);
      if (typeof actual === 'string' && typeof rule.value === 'string') {
        return actual.toLowerCase().includes(rule.value.toLowerCase());
      }
      return false;
    case 'lt':
    case 'gt': {
      const a = toComparable(actual);
      const b = toComparable(rule.value);
      if (a === null || b === null || typeof a !== typeof b) return false;
      return rule.op === 'lt' ? a < b : a > b;
    }
    default:
      return false;
  }
}

const DEAL_FIELDS = ['eventType', 'eventDate', 'status'] as const;
type DealField = (typeof DEAL_FIELDS)[number];

export function isDealRule(rule: SegmentRule): boolean {
  return rule.field.startsWith('deal.');
}

function checkDealRule(deal: SegmentContact['deals'][number], rule: SegmentRule): boolean {
  const dealField = rule.field.slice('deal.'.length);
  if (!DEAL_FIELDS.includes(dealField as DealField)) return false;
  return checkValue(deal[dealField as DealField], rule);
}

function checkContactRule(contact: SegmentContact, rule: SegmentRule): boolean {
  switch (rule.field) {
    case 'stage': return checkValue(contact.stage, rule);
    case 'source': return checkValue(contact.source, rule);
    case 'email': return checkValue(contact.email, rule);
    case 'organizationId': return checkValue(contact.organizationId, rule);
    case 'lastActivityAt': return checkValue(contact.lastActivityAt, rule);
    case 'tags': return checkValue(contact.tags, rule);
    default: return false;
  }
}

export function contactMatchesSegment(contact: SegmentContact, rules: SegmentRules): boolean {
  const dealRules = rules.all.filter(isDealRule);
  const contactRules = rules.all.filter((r) => !isDealRule(r));
  if (!contactRules.every((rule) => checkContactRule(contact, rule))) return false;
  if (dealRules.length === 0) return true;
  return contact.deals.some((deal) => dealRules.every((rule) => checkDealRule(deal, rule)));
}

export interface StoredSegment {
  id: number;
  name: string;
  rules: string;
}

/** Enkeltkontakt-evaluering: segmentene kontakten treffer, samme regler som bulk-filtreringen. */
export function segmentsForContact<S extends StoredSegment>(contact: SegmentContact, segments: readonly S[]): S[] {
  return segments.filter((segment) => contactMatchesSegment(contact, parseSegmentRules(segment.rules)));
}

const FIELD_LABELS: Record<string, string> = {
  stage: 'Kundestatus',
  source: 'Kilde',
  email: 'E-post',
  organizationId: 'Bedrift',
  lastActivityAt: 'Sist aktiv',
  tags: 'Stikkord',
  'deal.eventType': 'type',
  'deal.eventDate': 'dato',
  'deal.status': 'status',
};

/** Verdiene brukeren kan velge for felt med faste koder (stage, kilde, avtalestatus). */
export const SEGMENT_VALUE_LABELS: Record<string, Record<string, string>> = {
  stage: { lead: 'Interessent', active: 'Aktiv', customer: 'Kunde', dormant: 'Sovende', lost: 'Tapt' },
  source: {
    manual: 'Lagt inn for hånd',
    import: 'Import',
    booking: 'Forespørsel',
    registration: 'Påmelding',
    signup: 'Registrering på nettsiden',
    system: 'Automatisk',
  },
  'deal.status': { open: 'åpen', won: 'vunnet', lost: 'tapt' },
};

function formatValue(field: string, value: unknown): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [y, m, d] = value.slice(0, 10).split('-');
    return `${d}.${m}.${y}`;
  }
  const text = String(value ?? '');
  return SEGMENT_VALUE_LABELS[field]?.[text] ?? text;
}

/** «er Kunde», «inneholder «@firma.no»», «er før 01.01.2026» … */
function describeOp(rule: SegmentRule, subordinate = false): string {
  const value = formatValue(rule.field, rule.value);
  const isDate = rule.field === 'deal.eventDate' || rule.field === 'lastActivityAt';
  switch (rule.op) {
    case 'eq': return `er ${value}`;
    case 'neq': return subordinate ? `ikke er ${value}` : `er ikke ${value}`;
    case 'contains': return `inneholder «${value}»`;
    case 'lt': return isDate ? `er før ${value}` : `er mindre enn ${value}`;
    case 'gt': return isDate ? `er etter ${value}` : `er større enn ${value}`;
    case 'is_null': return 'mangler';
    case 'not_null': return 'er fylt ut';
  }
}

export function describeSegmentRule(rule: SegmentRule, subordinate = false): string {
  if (rule.field === 'tags') {
    if (rule.op === 'is_null') return 'Har ingen stikkord';
    if (rule.op === 'not_null') return 'Har minst ett stikkord';
    return `Har stikkordet «${formatValue(rule.field, rule.value)}»`;
  }
  return `${FIELD_LABELS[rule.field] ?? rule.field} ${describeOp(rule, subordinate)}`;
}

function joinWithOg(parts: string[]): string {
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} og ${parts.at(-1)}`;
}

/**
 * Reglene som vanlige setninger, én linje per kontaktregel. Avtaleregler slås sammen til
 * én setning fordi de må gjelde samme avtale: «Har en avtale der type er julebord og dato er før 01.01.2026».
 */
export function describeSegmentRules(rules: SegmentRules): string[] {
  if (rules.all.length === 0) return ['Alle kontakter (ingen regler)'];
  const lines = rules.all.filter((r) => !isDealRule(r)).map((r) => describeSegmentRule(r));
  const dealParts = rules.all.filter(isDealRule).map((r) => describeSegmentRule(r, true));
  if (dealParts.length > 0) lines.push(`Har en avtale der ${joinWithOg(dealParts)}`);
  return lines;
}
