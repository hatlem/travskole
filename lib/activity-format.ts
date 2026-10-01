// Gjør rader i aktivitetsloggen om til norske setninger for ikke-tekniske brukere.
// Interne id-er (nodeId, contactId …) skjules; ukjente nøkler vises med lesbar etikett.

import { activityActionLabel, activityEntityLabel } from '@/lib/activity-labels';

export interface ActivityLike {
  action: string;
  entity: string;
  entityId?: number | null;
  details?: string | null;
}

export interface FormattedActivity {
  /** Hele setningen, f.eks. «La til en liste i e-postflyt (4 personer)». */
  summary: string;
  /** Resten av detaljene i lesbar form («Allerede med: 2 · Avmeldt: 1»), eller ''. */
  details: string;
}

type Details = Record<string, unknown>;

/** Interne nøkler som aldri gir mening for brukeren. */
const HIDDEN_KEYS = new Set([
  'nodeId', 'contactId', 'listId', 'flowId', 'sourceFlowId', 'pipelineId', 'stageIds', 'stageId',
  'ids', 'userId', 'messageSendId', 'enrollmentId', 'registrationId', 'bookingRequestId', 'courseId',
  'noteId', 'dealId', 'organizationId', 'segmentId', 'triggerId', 'ok',
]);

const KEY_LABELS: Record<string, string> = {
  from: 'Fra',
  to: 'Til',
  status: 'Status',
  selfService: 'Gjort av kunden selv',
  key: 'Innstilling',
  rows: 'Rader',
  email: 'E-post',
  toEmail: 'Sendt til',
  name: 'Navn',
  course: 'Kurs',
  child: 'Barn',
  parent: 'Foresatt',
  added: 'Lagt til',
  removed: 'Fjernet',
  created: 'Nye',
  updated: 'Oppdatert',
  unchanged: 'Uendret',
  skipped: 'Hoppet over',
  failed: 'Feilet',
  role: 'Rolle',
  marketing: 'Markedsføring',
  deactivated: 'Deaktivert',
  anonymized: 'Anonymisert',
  registeredByAdmin: 'Lagt inn av admin',
  overrideCapacity: 'Kapasitet overstyrt',
  emailsSuppressed: 'Uten e-post',
  exitedEnrollments: 'Tatt ut av flyten',
  wokenEnrollments: 'Sendes på nytt etter ny sendetid',
  sentMagicLink: 'Innloggingslenke sendt',
  emailChanged: 'E-post endret',
  aiGenerated: 'Laget med KI',
  aiPersonalized: 'KI-tilpasset',
  fileName: 'Fil',
  stage: 'Steg',
  edited: 'Redigert',
  decision: 'Valg',
  done: 'Ferdig',
  processed: 'Behandlet',
  matched: 'Brukt',
  unmatched: 'Ikke brukt',
  fields: 'Felt',
  bulk: 'Handling',
  skippedActive: 'Allerede med',
  skippedSuppressed: 'Avmeldt eller sperret',
  skippedMissing: 'Fant ikke kontakten',
  capped: 'Over grensen, ikke lagt til',
  sendWindow: 'Sendetider',
};

const VALUE_LABELS: Record<string, string> = {
  new: 'Ny',
  pending: 'Venter',
  confirmed: 'Bekreftet',
  waitlist: 'Venteliste',
  cancelled: 'Avlyst',
  open: 'Åpen',
  full: 'Fullt',
  closed: 'Stengt',
  draft: 'Kladd',
  active: 'Aktiv',
  paused: 'På pause',
  archived: 'Arkivert',
  template: 'Mal',
  won: 'Vunnet',
  lost: 'Tapt',
  parent: 'Forelder',
  admin: 'Administrator',
  superadmin: 'Superadmin',
  applied: 'Gjort',
  dismissed: 'Ikke aktuelt',
  approve: 'Godkjent',
  send_original: 'Sendt med originaltekst',
  skip: 'Hoppet over',
  default: 'Standard',
  custom: 'Egne tider',
  anytime: 'Når som helst',
  deactivate: 'Deaktivert',
  activate: 'Aktivert',
  delete: 'Slettet',
};

/** Når status endres: hva hver entitet heter i bestemt form. */
const ENTITY_DEFINITE: Record<string, string> = {
  booking: 'bookingen',
  registration: 'påmeldingen',
  user: 'brukeren',
  course: 'kurset',
  flow: 'e-postflyten',
};

/** Hva en eksport inneholder. */
const EXPORT_NOUN: Record<string, string> = {
  course: 'kurs',
  registration: 'påmeldinger',
  user: 'brukere',
  segment: 'et segment',
  contact: 'kontakter',
};

/** Ubestemt form med liten forbokstav til standardsetningen «Opprettet kontakt». */
const ENTITY_NOUN: Record<string, string> = {
  course: 'kurs',
  registration: 'påmelding',
  user: 'bruker',
  booking: 'booking',
  child: 'barn',
  setting: 'innstilling',
  sender_identity: 'avsender',
  contact: 'kontakt',
  contact_import: 'kontaktimport',
  contact_list: 'liste',
  organization: 'bedrift',
  deal: 'avtale',
  pipeline: 'salgstavle',
  stage: 'steg på salgstavlen',
  task: 'oppgave',
  note: 'notat',
  segment: 'segment',
  suppression: 'sperring',
  consent: 'samtykke',
  flow: 'e-postflyt',
  flow_graph: 'stegene i e-postflyt',
  flow_trigger: 'startregel',
  ai_suggestion: 'KI-forslag',
  crm: 'CRM',
};

function parseDetails(raw: string | null | undefined): Details | string | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Details;
    return raw;
  } catch {
    return raw;
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

export function people(n: number): string {
  return n === 1 ? '1 person' : `${n} personer`;
}

function valueText(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nei';
  if (typeof value === 'string') return VALUE_LABELS[value] ?? value;
  if (typeof value === 'number') return value.toLocaleString('nb-NO');
  if (Array.isArray(value)) return value.map(valueText).join(', ');
  if (typeof value === 'object' && 'name' in value) return String((value as { name: unknown }).name);
  return JSON.stringify(value);
}

/** Detaljer som ikke er brukt i setningen, uten interne id-er og uten tomme tellere. */
function restDetails(details: Details, used: readonly string[]): string {
  const skip = new Set(used);
  return Object.entries(details)
    .filter(([key, value]) => !skip.has(key) && !HIDDEN_KEYS.has(key) && value !== undefined)
    .filter(([, value]) => value !== 0 && value !== null)
    .map(([key, value]) => `${KEY_LABELS[key] ?? key}: ${valueText(value)}`)
    .join(' · ');
}

interface Rule {
  summary: string;
  used?: readonly string[];
}

const fallback = (row: ActivityLike): string => {
  const noun = ENTITY_NOUN[row.entity];
  return noun ? `${activityActionLabel(row.action)} ${noun}` : `${activityActionLabel(row.action)} – ${activityEntityLabel(row.entity)}`;
};

function enrollSummary(prefix: string, d: Details): Rule {
  const enrolled = num(d.enrolled);
  return { summary: enrolled !== null ? `${prefix} (${people(enrolled)})` : prefix, used: ['enrolled'] };
}

function flowRule(row: ActivityLike, d: Details): Rule | null {
  switch (row.action) {
    case 'create':
      return d.aiGenerated === true ? { summary: 'Lagde e-postflyt med KI', used: ['aiGenerated'] } : { summary: 'Opprettet e-postflyt' };
    case 'update': {
      if (d.status === 'archived') {
        const exited = num(d.exitedEnrollments) ?? 0;
        return {
          summary: exited > 0 ? `Arkiverte e-postflyten (${people(exited)} tatt ut)` : 'Arkiverte e-postflyten',
          used: ['status', 'exitedEnrollments'],
        };
      }
      if (d.sendWindow !== undefined) {
        const woken = num(d.wokenEnrollments) ?? 0;
        return {
          summary: woken > 0 ? `Endret sendetider (${people(woken)} får e-posten tidligere)` : 'Endret sendetider',
          used: ['sendWindow', 'wokenEnrollments'],
        };
      }
      return { summary: 'Endret e-postflyten' };
    }
    case 'delete':
      return { summary: 'Slettet e-postflyt' };
    case 'activate':
      return { summary: 'Aktiverte e-postflyten' };
    case 'enroll':
      return enrollSummary('La til personer i e-postflyt', d);
    case 'enroll_list':
      return enrollSummary('La til en liste i e-postflyt', d);
    case 'enroll_segment':
      return enrollSummary('La til et segment i e-postflyt', d);
    case 'flow_test_send': {
      const to = str(d.toEmail);
      const ai = d.aiPersonalized === true ? ' (KI-tilpasset)' : '';
      return {
        summary: to ? `Sendte test-e-post til ${to}${ai}` : `Sendte test-e-post${ai}`,
        used: ['toEmail', 'aiPersonalized'],
      };
    }
    case 'save_as_template':
      return { summary: 'Lagret e-postflyten som mal' };
    case 'create_from_flow':
      return { summary: 'Lagde ny e-postflyt fra en mal' };
    case 'install_standard_template':
      return { summary: 'La inn en ferdig mal for e-postflyt' };
    case 'import_legacy_templates': {
      const matched = num(d.matched);
      return {
        summary: matched !== null ? `Hentet inn de gamle kurstekstene (${matched} brukt)` : 'Hentet inn de gamle kurstekstene',
        used: ['matched'],
      };
    }
    case 'ai_personalize_preview':
      return { summary: 'Forhåndsviste KI-tilpasset e-post' };
    default:
      return null;
  }
}

function rule(row: ActivityLike, d: Details): Rule | null {
  if (row.entity === 'flow') return flowRule(row, d);
  if (row.entity === 'flow_graph' && row.action === 'update') return { summary: 'Endret stegene i e-postflyten' };
  if (row.entity === 'flow_trigger') {
    if (row.action === 'create') return { summary: 'La til en startregel i e-postflyt' };
    if (row.action === 'delete') return { summary: 'Fjernet en startregel fra e-postflyt' };
  }
  if (row.entity === 'contact_list') {
    const added = num(d.added);
    const removed = num(d.removed);
    if (row.action === 'add_members' && added !== null) return { summary: `La til ${people(added)} i en liste`, used: ['added'] };
    if (row.action === 'remove_members' && removed !== null) return { summary: `Fjernet ${people(removed)} fra en liste`, used: ['removed'] };
  }
  if (row.entity === 'segment' && row.action === 'convert_to_list') {
    const added = num(d.added);
    return { summary: added !== null ? `Lagde liste fra segment (${people(added)})` : 'Lagde liste fra segment', used: ['added'] };
  }
  if (row.entity === 'contact_import' && row.action === 'create') {
    const file = str(d.fileName);
    return { summary: file ? `Importerte kontakter fra «${file}»` : 'Importerte kontakter', used: ['fileName'] };
  }
  if (row.action === 'export') {
    const rows = num(d.rows);
    const noun = EXPORT_NOUN[row.entity] ?? activityEntityLabel(row.entity).toLowerCase();
    return { summary: rows !== null ? `Eksporterte ${noun} (${rows} rader)` : `Eksporterte ${noun}`, used: ['rows'] };
  }
  if (row.action === 'status_change' && (d.to !== undefined || d.status !== undefined)) {
    const target = ENTITY_DEFINITE[row.entity] ?? activityEntityLabel(row.entity).toLowerCase();
    const to = valueText(d.to ?? d.status);
    const from = d.from !== undefined ? `${valueText(d.from)} → ` : '';
    const self = d.selfService === true ? ' (gjort av kunden selv)' : '';
    return { summary: `Endret status på ${target}: ${from}${to}${self}`, used: ['from', 'to', 'status', 'selfService'] };
  }
  if (row.entity === 'deal' && row.action === 'update' && str(d.stage)) {
    return { summary: `Flyttet avtale til «${d.stage as string}»`, used: ['stage'] };
  }
  if (row.entity === 'stage' && row.action === 'update' && d.from && d.to) {
    return { summary: `Endret steg på salgstavlen: «${valueText(d.from)}» → «${valueText(d.to)}»`, used: ['from', 'to'] };
  }
  if (row.entity === 'setting' && row.action === 'update' && str(d.key)) {
    return { summary: `Endret innstillingen «${d.key as string}»`, used: ['key'] };
  }
  if (row.entity === 'ai_suggestion' && row.action === 'ai_review_decision') {
    return { summary: `Vurderte KI-utkast: ${valueText(d.decision)}`, used: ['decision'] };
  }
  if (row.entity === 'ai_suggestion' && row.action === 'update' && str(d.status)) {
    return { summary: `Merket KI-forslag som «${valueText(d.status)}»`, used: ['status'] };
  }
  if (row.entity === 'consent' && typeof d.marketing === 'boolean') {
    return { summary: d.marketing ? 'Registrerte ja til markedsføring' : 'Registrerte nei til markedsføring', used: ['marketing'] };
  }
  if (row.entity === 'crm' && row.action === 'backfill') {
    const processed = num(d.processed);
    return { summary: processed !== null ? `Hentet inn historikk (${processed} behandlet)` : 'Hentet inn historikk', used: ['processed', 'done'] };
  }
  if (row.entity === 'user' && row.action === 'email' && d.sentMagicLink) {
    return { summary: 'Sendte innloggingslenke', used: ['sentMagicLink'] };
  }
  if (row.entity === 'sender_identity' && str(d.email)) {
    return { summary: `${fallback(row)}: ${d.email as string}`, used: ['email'] };
  }
  return null;
}

/** Setning + resterende detaljer for én rad i aktivitetsloggen. */
export function formatActivity(row: ActivityLike): FormattedActivity {
  const parsed = parseDetails(row.details);
  if (typeof parsed === 'string') {
    // Fritekst (f.eks. kursnavn ved opprettelse) vises som den er.
    return { summary: fallback(row), details: parsed };
  }
  const details = parsed ?? {};
  const matched = rule(row, details);
  return {
    summary: matched?.summary ?? fallback(row),
    details: restDetails(details, matched?.used ?? []),
  };
}
