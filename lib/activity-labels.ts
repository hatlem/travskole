// Norske visningstekster for aktivitetsloggen (handlinger, typer og detaljer).
// Ukjente koder vises uendret, så nye logActivity-kall aldri forsvinner.

export const ACTIVITY_ACTION_LABELS: Record<string, string> = {
  create: 'Opprettet',
  update: 'Oppdatert',
  delete: 'Slettet',
  email: 'E-post sendt',
  status_change: 'Status endret',
  export: 'Eksportert',
  activate: 'Aktivert',
  deactivate: 'Deaktivert',
  anonymize: 'Anonymisert',
  add_members: 'Medlemmer lagt til',
  remove_members: 'Medlemmer fjernet',
  backfill: 'Historikk importert',
  checkout_started: 'Betaling startet',
  reorder: 'Rekkefølge endret',
  flow_test_send: 'Testutsending',
  import_legacy_templates: 'Maler importert',
  install_standard_template: 'Standardmal installert',
  ai_personalize_preview: 'KI-forhåndsvisning',
  ai_review_decision: 'KI-utkast vurdert',
  send_ai: 'Sendt med KI-tekst',
  send_original: 'Sendt med originaltekst',
  skip: 'Hoppet over',
  wait: 'Satt på vent',
};

export const ACTIVITY_ENTITY_LABELS: Record<string, string> = {
  course: 'Kurs',
  registration: 'Påmelding',
  user: 'Bruker',
  booking: 'Booking',
  child: 'Barn',
  setting: 'Innstilling',
  sender_identity: 'Avsender',
  contact: 'Kontakt',
  contact_import: 'Kontaktimport',
  contact_list: 'Kontaktliste',
  organization: 'Bedrift',
  deal: 'Deal',
  pipeline: 'Pipeline',
  stage: 'Stadium',
  task: 'Oppgave',
  note: 'Notat',
  segment: 'Segment',
  suppression: 'Sperreliste',
  consent: 'Samtykke',
  flow: 'Flyt',
  flow_graph: 'Flytdiagram',
  flow_trigger: 'Flytutløser',
  ai_suggestion: 'KI-forslag',
  crm: 'CRM',
};

/** Typene som kan velges i filteret, sortert alfabetisk på norsk. */
export const ACTIVITY_ENTITY_OPTIONS = Object.entries(ACTIVITY_ENTITY_LABELS)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label, 'nb'));

export const ACTIVITY_ACTION_OPTIONS = Object.entries(ACTIVITY_ACTION_LABELS)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label, 'nb'));

export const activityActionLabel = (action: string): string => ACTIVITY_ACTION_LABELS[action] ?? action;
export const activityEntityLabel = (entity: string): string => ACTIVITY_ENTITY_LABELS[entity] ?? entity;

const DETAIL_KEY_LABELS: Record<string, string> = {
  from: 'Fra',
  to: 'Til',
  status: 'Status',
  selfService: 'Selvbetjent',
  key: 'Innstilling',
  rows: 'Rader',
  email: 'E-post',
  name: 'Navn',
  course: 'Kurs',
  child: 'Barn',
  parent: 'Foresatt',
  added: 'Lagt til',
  created: 'Opprettet',
  updated: 'Oppdatert',
  skipped: 'Hoppet over',
  role: 'Rolle',
  marketing: 'Markedsføring',
  deactivated: 'Deaktivert',
  anonymized: 'Anonymisert',
  registeredByAdmin: 'Lagt inn av admin',
  overrideCapacity: 'Kapasitet overstyrt',
  exitedEnrollments: 'Avsluttede flytpåmeldinger',
  sentMagicLink: 'Innloggingslenke sendt',
  emailChanged: 'E-post endret',
  aiGenerated: 'KI-generert',
};

const DETAIL_VALUE_LABELS: Record<string, string> = {
  new: 'Ny',
  pending: 'Venter',
  confirmed: 'Bekreftet',
  waitlist: 'Venteliste',
  cancelled: 'Avlyst',
  open: 'Åpen',
  full: 'Fullt',
  closed: 'Stengt',
  draft: 'Utkast',
  active: 'Aktiv',
  paused: 'Pauset',
  archived: 'Arkivert',
  won: 'Vunnet',
  lost: 'Tapt',
  parent: 'Forelder',
  admin: 'Administrator',
  superadmin: 'Superadmin',
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nei';
  if (typeof value === 'string') return DETAIL_VALUE_LABELS[value] ?? value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object' && !Array.isArray(value) && 'name' in value) {
    return String((value as { name: unknown }).name);
  }
  return JSON.stringify(value);
}

/** Gjør JSON-detaljer om til «Fra: Venter · Til: Avlyst». Ikke-JSON vises som den er. */
export function formatActivityDetails(details: string | null | undefined): string {
  if (!details) return '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(details);
  } catch {
    return details;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return details;
  return Object.entries(parsed as Record<string, unknown>)
    .map(([key, value]) => `${DETAIL_KEY_LABELS[key] ?? key}: ${formatValue(value)}`)
    .join(' · ');
}
