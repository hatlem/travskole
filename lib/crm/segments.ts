// Segmentregler: { all: [{ field, op, value }] } — AND over alle regler.
// Kontaktfelter: stage, source, email, organizationId, lastActivityAt, tags.
// Deal-felter prefikses "deal." og passerer hvis MINST ÉN deal matcher.
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

function checkRule(contact: SegmentContact, rule: SegmentRule): boolean {
  if (rule.field.startsWith('deal.')) {
    const dealField = rule.field.slice('deal.'.length);
    if (!['eventType', 'eventDate', 'status'].includes(dealField)) return false;
    return contact.deals.some((d) => checkValue(d[dealField as keyof typeof d], rule));
  }

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
  return rules.all.every((rule) => checkRule(contact, rule));
}
