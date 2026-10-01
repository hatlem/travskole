// Delte typer og norske etiketter for kontaktimporten (klient + server).

export const IMPORT_FIELDS = [
  'name', 'firstName', 'lastName', 'email', 'phone', 'organization', 'orgNumber',
  'website', 'roleTitle', 'tags', 'note', 'consent',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Hva en kolonne i fila brukes til. 'custom' = lagres som eget felt med kolonnenavnet. */
export type ColumnTarget = ImportField | 'ignore' | 'custom';

export const FIELD_LABELS: Record<ImportField, string> = {
  name: 'Navn',
  firstName: 'Fornavn',
  lastName: 'Etternavn',
  email: 'E-post',
  phone: 'Telefon',
  organization: 'Bedrift',
  orgNumber: 'Org.nr.',
  website: 'Nettside',
  roleTitle: 'Stilling',
  tags: 'Stikkord',
  note: 'Notat',
  consent: 'Samtykke til markedsføring',
};

export const CONTACT_STAGES = ['lead', 'active', 'customer', 'dormant', 'lost'] as const;
export type ContactStage = (typeof CONTACT_STAGES)[number];

export const CONTACT_STAGE_LABELS: Record<ContactStage, string> = {
  lead: 'Interessent', active: 'Aktiv', customer: 'Kunde', dormant: 'Sovende', lost: 'Tapt',
};

export type UpdatePolicy = 'fill_empty' | 'overwrite';

export interface ApplyOptions {
  policy: UpdatePolicy;
  tags: string[];
  ownerId: number | null;
  stage: ContactStage | null;
}

export const DEFAULT_APPLY_OPTIONS: ApplyOptions = { policy: 'fill_empty', tags: [], ownerId: null, stage: null };

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export type RowStatus =
  | 'new'
  | 'update_email'
  | 'update_phone'
  | 'possible_duplicate'
  | 'duplicate_in_file'
  | 'invalid';

export const ROW_STATUSES: RowStatus[] = [
  'new', 'update_email', 'update_phone', 'possible_duplicate', 'duplicate_in_file', 'invalid',
];

export const STATUS_LABELS: Record<RowStatus, string> = {
  new: 'Ny kontakt',
  update_email: 'Finnes fra før – oppdateres (samme e-post)',
  update_phone: 'Finnes fra før – oppdateres (samme telefon)',
  possible_duplicate: 'Kanskje samme person (navn + bedrift)',
  duplicate_in_file: 'Står flere ganger i fila',
  invalid: 'Kan ikke importeres',
};

export const STATUS_HELP: Record<RowStatus, string> = {
  new: 'Personen finnes ikke blant kontaktene dine fra før og blir lagt til.',
  update_email: 'Vi fant en kontakt med samme e-post. Den blir oppdatert, ikke kopiert.',
  update_phone: 'Vi fant en kontakt med samme telefonnummer. Den blir oppdatert, ikke kopiert.',
  possible_duplicate: 'Samme navn og bedrift som en kontakt du har. Velg selv hva som skal skje – ellers hoppes raden over.',
  duplicate_in_file: 'Samme person står lenger opp i fila. Bare den første raden brukes.',
  invalid: 'Raden mangler noe vi trenger. Se årsaken i tabellen.',
};

export type OrgRef =
  | { kind: 'existing'; id: number; name: string; matchedBy: 'orgnr' | 'domain' | 'name' }
  | { kind: 'new'; key: string; name: string };

export interface RowValues {
  name: string;
  /** false når navnet er utledet fra e-posten — skal aldri overskrive et ekte navn. */
  nameExplicit: boolean;
  email: string | null;
  phone: string | null;
  organizationName: string | null;
  orgNumber: string | null;
  website: string | null;
  roleTitle: string | null;
  tags: string[];
  note: string | null;
  consent: boolean | null;
  customFields: Record<string, string>;
}

export interface MatchedContact {
  contactId: number;
  name: string;
  email: string | null;
  phone: string | null;
  organizationName: string | null;
}

export type ConsentOutcome = 'grant' | 'blocked' | null;

export interface PlannedRow {
  /** Radnummer slik Excel viser det (rad 1 = overskriftene). */
  row: number;
  status: RowStatus;
  reason: string | null;
  warnings: string[];
  values: RowValues | null;
  organization: OrgRef | null;
  match: MatchedContact | null;
  suppressed: boolean;
  consent: ConsentOutcome;
  changes: string[];
}

export interface NewOrganization {
  key: string;
  name: string;
  orgNumber: string | null;
  domain: string | null;
}

export type StatusCounts = Record<RowStatus, number> & { suppressed: number };

export interface ImportPlan {
  rows: PlannedRow[];
  counts: StatusCounts;
  newOrganizations: NewOrganization[];
}

export type RowDecisionAction = 'import' | 'skip' | 'merge' | 'create';

export interface RowDecision {
  row: number;
  action: RowDecisionAction;
  /** Ved 'merge': kontakten admin så i forhåndsvisningen. */
  contactId?: number;
}

export type RowAction =
  | { row: number; kind: 'create'; planned: PlannedRow }
  | { row: number; kind: 'update'; contactId: number; planned: PlannedRow }
  | { row: number; kind: 'skip'; reason: string; planned: PlannedRow };

export interface ImportProblem {
  row: number;
  reason: string;
}

export interface ImportResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  organizationsCreated: number;
  contactIds: number[];
  problems: ImportProblem[];
}
