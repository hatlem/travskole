/**
 * Gjenbruk av de håndskrevne kurs-e-postene i legacy-tabellene
 * `email_templates`/`email_triggers` (ikke lenger i Prisma-skjemaet).
 * Rene funksjoner: kolonnenavn tolkes defensivt, tekstene plasseres på
 * livssyklus-stegene via trigger-type, deretter navn, deretter rekkefølge.
 */
import { LIFECYCLE_STEPS, type LifecycleSlot } from './lifecycle-steps';
import type { FlowTemplate, TemplateNode } from './builder';

export const LEGACY_FLOW_NAME = 'Kurs-livssyklus (originaltekster)';

export interface LegacyTemplate {
  id: number | null;
  name: string;
  subject: string;
  body: string;
}

export interface LegacyTrigger {
  templateId: number | null;
  triggerType: string;
}

export type MatchVia = 'trigger' | 'name' | 'order';

export interface LegacyMapping {
  assignments: { slot: LifecycleSlot; template: LegacyTemplate; via: MatchVia }[];
  unmatched: { template: LegacyTemplate; reason: string }[];
}

const TEMPLATE_COLUMNS = {
  id: ['id', 'template_id'],
  name: ['name', 'navn', 'title', 'tittel'],
  subject: ['subject', 'emne', 'title', 'tittel'],
  body: ['body', 'body_html', 'bodyhtml', 'html', 'content', 'innhold', 'text', 'tekst'],
};
const TRIGGER_COLUMNS = {
  templateId: ['template_id', 'templateid', 'email_template_id'],
  triggerType: ['trigger_type', 'triggertype', 'type', 'kind'],
};

function pick(row: Record<string, unknown>, candidates: readonly string[]): unknown {
  const byLower = new Map(Object.keys(row).map((key) => [key.toLowerCase(), key]));
  for (const candidate of candidates) {
    const key = byLower.get(candidate);
    if (key !== undefined && row[key] !== null && row[key] !== undefined) return row[key];
  }
  return undefined;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

/** Rader uten både emne og innhold hoppes over — de kan ikke bli en e-post. */
export function normalizeLegacyTemplates(rows: readonly Record<string, unknown>[]): LegacyTemplate[] {
  return rows
    .map((row) => ({
      id: asId(pick(row, TEMPLATE_COLUMNS.id)),
      name: asText(pick(row, TEMPLATE_COLUMNS.name)),
      subject: asText(pick(row, TEMPLATE_COLUMNS.subject)),
      body: asText(pick(row, TEMPLATE_COLUMNS.body)),
    }))
    .filter((t) => t.subject !== '' && t.body !== '')
    .map((t) => ({ ...t, name: t.name || t.subject }));
}

export function normalizeLegacyTriggers(rows: readonly Record<string, unknown>[]): LegacyTrigger[] {
  return rows
    .map((row) => ({
      templateId: asId(pick(row, TRIGGER_COLUMNS.templateId)),
      triggerType: asText(pick(row, TRIGGER_COLUMNS.triggerType)).toLowerCase(),
    }))
    .filter((t) => t.templateId !== null && t.triggerType !== '');
}

const CONFIRMATION = 'confirmation';
type Classification = LifecycleSlot | typeof CONFIRMATION | null;

const TRIGGER_TYPE_SLOTS: Record<string, Classification> = {
  registration_confirmed: CONFIRMATION,
  reminder_before: 'reminder_before',
  welcome_start: 'welcome_start',
  midway: 'midway',
  after_end: 'after_end',
};

const NAME_PATTERNS: [RegExp, Classification][] = [
  [/bekreft|påmelding mottatt/i, CONFIRMATION],
  [/påminn|starter snart/i, 'reminder_before'],
  [/velkommen|kursstart/i, 'welcome_start'],
  [/midtveis|halvveis/i, 'midway'],
  [/takk for|etter kurs|avslutt/i, 'after_end'],
];

function classifyByName(template: LegacyTemplate): Classification {
  const haystack = `${template.name} ${template.subject}`;
  return NAME_PATTERNS.find(([pattern]) => pattern.test(haystack))?.[1] ?? null;
}

const CONFIRMATION_REASON = 'Påmeldingsbekreftelsen sendes automatisk av systemet og er ikke en del av livssyklus-flyten.';
const DUPLICATE_REASON = 'Steget har allerede fått en tekst fra en annen mal.';
const NO_SLOT_REASON = 'Fant ikke noe ledig livssyklus-steg å plassere teksten på.';

export function mapLegacyToLifecycle(
  templates: readonly LegacyTemplate[],
  triggers: readonly LegacyTrigger[] = [],
): LegacyMapping {
  const assignments: LegacyMapping['assignments'] = [];
  const unmatched: LegacyMapping['unmatched'] = [];
  const taken = new Set<LifecycleSlot>();
  const unclassified: LegacyTemplate[] = [];

  const classifyByTrigger = (template: LegacyTemplate): Classification => {
    if (template.id === null) return null;
    const types = triggers.filter((t) => t.templateId === template.id).map((t) => TRIGGER_TYPE_SLOTS[t.triggerType]);
    return types.find((slot) => slot !== undefined && slot !== null) ?? null;
  };

  for (const template of templates) {
    const byTrigger = classifyByTrigger(template);
    const classification = byTrigger ?? classifyByName(template);
    if (classification === null) {
      unclassified.push(template);
    } else if (classification === CONFIRMATION) {
      unmatched.push({ template, reason: CONFIRMATION_REASON });
    } else if (taken.has(classification)) {
      unmatched.push({ template, reason: DUPLICATE_REASON });
    } else {
      taken.add(classification);
      assignments.push({ slot: classification, template, via: byTrigger ? 'trigger' : 'name' });
    }
  }

  const freeSlots = LIFECYCLE_STEPS.map((s) => s.slot).filter((slot) => !taken.has(slot));
  for (const template of unclassified) {
    const slot = freeSlots.shift();
    if (slot) assignments.push({ slot, template, via: 'order' });
    else unmatched.push({ template, reason: NO_SLOT_REASON });
  }

  const slotOrder = LIFECYCLE_STEPS.map((s) => s.slot);
  assignments.sort((a, b) => slotOrder.indexOf(a.slot) - slotOrder.indexOf(b.slot));
  return { assignments, unmatched };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const HTML_TAG = /<\/?(p|br|div|span|h[1-6]|ul|ol|li|strong|em|b|i|u|a|table|tr|td|img)\b[^>]*>/i;

/** Legacy-innhold kan være ren tekst — gjøres om til avsnitt så linjeskift bevares. */
export function legacyBodyToHtml(body: string): string {
  if (HTML_TAG.test(body)) return body;
  return body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function describe(mapping: LegacyMapping): string {
  const base =
    'Kopi av «Kurs-livssyklus» med de håndskrevne tekstene fra de gamle kursmalene. Steg uten original tekst beholder standardteksten.';
  if (mapping.unmatched.length === 0) return base;
  const names = mapping.unmatched.map((u) => `«${u.template.name}»`).join(', ');
  return `${base} Ikke brukt: ${names}.`.slice(0, 2000);
}

/** Samme struktur som livssyklus-seeden (schedule→e-post per steg), med legacy-tekster der de finnes. */
export function buildLegacyLifecycleTemplate(mapping: LegacyMapping): FlowTemplate {
  const bySlot = new Map(mapping.assignments.map((a) => [a.slot, a.template]));
  const nodes: TemplateNode[] = [{ key: 'start', type: 'start', next: 'schedule-0' }];
  LIFECYCLE_STEPS.forEach((step, index) => {
    const legacy = bySlot.get(step.slot);
    const next = index + 1 < LIFECYCLE_STEPS.length ? `schedule-${index + 1}` : 'end';
    nodes.push(
      { key: `schedule-${index}`, type: 'schedule', anchor: step.anchor, offsetDays: step.offsetDays, next: `email-${index}` },
      {
        key: `email-${index}`,
        type: 'email',
        subject: legacy?.subject ?? step.subject,
        bodyHtml: legacy ? legacyBodyToHtml(legacy.body) : step.bodyHtml,
        next,
      },
    );
  });
  nodes.push({ key: 'end', type: 'end' });

  return {
    name: LEGACY_FLOW_NAME,
    description: describe(mapping),
    isMarketing: false,
    anchorMode: 'course',
    triggers: [{ eventType: 'registration.created' }],
    nodes,
  };
}
