// Ren import-planlegging: rader + kolonneoppsett + eksisterende CRM-data →
// status per rad (ny / oppdateres / mulig duplikat / …). Ingen DB her —
// API-ruta laster konteksten og kjører planen på nytt ved import.

import { emailDomain, isCompanyDomain, normalizePhone, orgNameFromDomain } from '@/lib/crm/normalize';
import { extractRow, mergeTags, orgNameKey, personNameKey } from '@/lib/crm/import/values';
import type {
  ApplyOptions, ColumnTarget, ConsentOutcome, ImportPlan, MatchedContact, NewOrganization, OrgRef, OrgSuggestion,
  PlannedRow, RowAction, RowDecision, RowValues, StatusCounts,
} from '@/lib/crm/import/types';

export interface ExistingContact {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  roleTitle: string | null;
  organizationId: number | null;
  ownerId: number | null;
  stage: string;
  tags: string[];
  customFields: Record<string, unknown>;
  marketingConsent: boolean;
  consentWithdrawn: boolean;
}

export interface ExistingOrganization {
  id: number;
  name: string;
  orgNumber: string | null;
  domain: string | null;
}

export interface PlanContext {
  contacts: ExistingContact[];
  organizations: ExistingOrganization[];
  /** Normaliserte e-poster på ikke-kontakt-listen (avmeldt, bounce, klage, manuell). */
  suppressedEmails: Set<string>;
}

export interface PlanInput {
  headers: string[];
  rows: string[][];
  columns: ColumnTarget[];
  options: ApplyOptions;
}

type OrgTarget = { kind: 'existing'; id: number } | { kind: 'new'; key: string };

class OrganizationIndex {
  private byOrgNumber = new Map<string, OrgRef>();
  private byDomain = new Map<string, OrgRef>();
  private byName = new Map<string, OrgRef>();
  readonly created = new Map<string, NewOrganization>();
  readonly names = new Map<number, string>();

  constructor(organizations: ExistingOrganization[]) {
    for (const org of [...organizations].sort((a, b) => a.id - b.id)) {
      this.names.set(org.id, org.name);
      const ref = (matchedBy: 'orgnr' | 'domain' | 'name'): OrgRef => ({ kind: 'existing', id: org.id, name: org.name, matchedBy });
      if (org.orgNumber) setOnce(this.byOrgNumber, org.orgNumber.replace(/\D/g, ''), ref('orgnr'));
      if (org.domain) setOnce(this.byDomain, org.domain.toLowerCase(), ref('domain'));
      const key = orgNameKey(org.name);
      if (key) setOnce(this.byName, key, ref('name'));
    }
  }

  /**
   * Org.nr. → nettside-domene → bedriftsnavn. E-postdomenet fyller aldri en
   * tom Bedrift-celle (se suggest). Ukjent bedrift opprettes.
   */
  resolve(values: RowValues): OrgRef | null {
    const nameKey = values.organizationName ? orgNameKey(values.organizationName) : '';
    const found =
      (values.orgNumber && this.byOrgNumber.get(values.orgNumber)) ||
      (values.website && this.byDomain.get(values.website)) ||
      (nameKey && this.byName.get(nameKey)) ||
      null;
    if (found) return found;

    const name = values.organizationName ?? (values.website ? orgNameFromDomain(values.website) : null);
    if (!name) return null;
    const key = nameKey || orgNameKey(name) || name.toLowerCase();
    const ref: OrgRef = { kind: 'new', key, name };
    this.created.set(key, { key, name, orgNumber: values.orgNumber, domain: values.website });
    if (values.orgNumber) setOnce(this.byOrgNumber, values.orgNumber, ref);
    if (values.website) setOnce(this.byDomain, values.website, ref);
    setOnce(this.byName, key, ref);
    return ref;
  }

  /** Eksisterende bedrift med samme e-postdomene — bare et forslag i forhåndsvisningen, kobles ikke. */
  suggest(values: RowValues): OrgSuggestion | null {
    if (values.organizationName || values.orgNumber || values.website) return null;
    const mailDomain = emailDomain(values.email);
    if (!mailDomain || !isCompanyDomain(mailDomain)) return null;
    const hit = this.byDomain.get(mailDomain);
    return hit?.kind === 'existing' ? { id: hit.id, name: hit.name, domain: mailDomain } : null;
  }

  /** Fyller org.nr./domene på en planlagt ny bedrift fra senere rader. */
  enrich(ref: OrgRef, values: RowValues): void {
    if (ref.kind !== 'new') return;
    const org = this.created.get(ref.key);
    if (!org) return;
    if (!org.orgNumber && values.orgNumber && !this.byOrgNumber.has(values.orgNumber)) {
      org.orgNumber = values.orgNumber;
      this.byOrgNumber.set(values.orgNumber, ref);
    }
    if (!org.domain && values.website && !this.byDomain.has(values.website)) {
      org.domain = values.website;
      this.byDomain.set(values.website, ref);
    }
  }
}

function setOnce<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (!map.has(key)) map.set(key, value);
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function emptyCounts(): StatusCounts {
  return {
    new: 0, update_email: 0, update_phone: 0, possible_duplicate: 0, duplicate_in_file: 0, invalid: 0, suppressed: 0,
  };
}

function toMatch(contact: ExistingContact, orgNames: Map<number, string>): MatchedContact {
  return {
    contactId: contact.id,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    organizationName: contact.organizationId ? orgNames.get(contact.organizationId) ?? null : null,
  };
}

function consentOutcome(values: RowValues, suppressed: boolean, existing: ExistingContact | null): ConsentOutcome {
  if (values.consent !== true) return null;
  if (suppressed || existing?.consentWithdrawn) return 'blocked';
  if (existing?.marketingConsent) return null;
  return 'grant';
}

export function planImport(input: PlanInput, context: PlanContext): ImportPlan {
  const consentIgnored = input.columns.includes('consent') && input.options.confirmConsent !== true;
  const columns: ColumnTarget[] = consentIgnored
    ? input.columns.map((c) => (c === 'consent' ? 'ignore' : c))
    : input.columns;
  const orgs = new OrganizationIndex(context.organizations);
  const byEmail = new Map<string, ExistingContact>();
  const byPhone = new Map<string, ExistingContact[]>();
  const byNameAndOrg = new Map<string, ExistingContact[]>();

  for (const contact of [...context.contacts].sort((a, b) => a.id - b.id)) {
    if (contact.email) setOnce(byEmail, contact.email.toLowerCase(), contact);
    const phone = normalizePhone(contact.phone);
    if (phone) pushTo(byPhone, phone, contact);
    if (contact.organizationId) pushTo(byNameAndOrg, `${personNameKey(contact.name)}|${contact.organizationId}`, contact);
  }

  const seenEmails = new Map<string, number>();
  const seenPhones = new Map<string, number>();
  const targeted = new Map<number, number>();
  const counts = emptyCounts();
  const rows: PlannedRow[] = [];

  input.rows.forEach((raw, i) => {
    const rowNumber = i + 2;
    const extracted = extractRow(raw, input.headers, columns);
    const base: PlannedRow = {
      row: rowNumber, status: 'invalid', reason: null, warnings: extracted.warnings, values: null,
      organization: null, match: null, suppressed: false, consent: null, changes: [],
    };

    if (!extracted.ok) {
      rows.push({ ...base, reason: extracted.reason });
      counts.invalid++;
      return;
    }
    const values = extracted.values;
    const planned: PlannedRow = { ...base, values };

    const earlier =
      (values.email && seenEmails.get(values.email)) ||
      (!values.email && values.phone && seenPhones.get(values.phone)) ||
      null;
    if (earlier) {
      rows.push({ ...planned, status: 'duplicate_in_file', reason: `Samme person som rad ${earlier}` });
      counts.duplicate_in_file++;
      return;
    }

    const organization = orgs.resolve(values);
    if (organization) orgs.enrich(organization, values);
    planned.organization = organization;
    planned.suggestedOrganization = organization ? null : orgs.suggest(values);

    let existing: ExistingContact | null = values.email ? byEmail.get(values.email) ?? null : null;
    if (existing) {
      planned.status = 'update_email';
    } else if (values.phone) {
      const candidates = (byPhone.get(values.phone) ?? []).filter(
        (c) => !(values.email && c.email && c.email.toLowerCase() !== values.email),
      );
      existing = candidates[0] ?? null;
      if (existing) {
        planned.status = 'update_phone';
        if (candidates.length > 1) {
          planned.warnings = [...planned.warnings, `${candidates.length} kontakter har dette nummeret – oppdaterer den eldste`];
        }
      }
    }

    if (!existing && organization?.kind === 'existing') {
      const candidate = byNameAndOrg.get(`${personNameKey(values.name)}|${organization.id}`)?.[0];
      if (candidate && values.nameExplicit) {
        planned.status = 'possible_duplicate';
        planned.match = toMatch(candidate, orgs.names);
        planned.changes = buildContactUpdate(candidate, values, orgTarget(organization), input.options).changes;
        planned.consent = consentOutcome(values, isSuppressed(values, context), candidate);
        planned.consentAsNew = consentOutcome(values, isSuppressed(values, context), null);
      }
    }

    if (existing) {
      const firstRow = targeted.get(existing.id);
      if (firstRow) {
        rows.push({ ...planned, status: 'duplicate_in_file', reason: `Treffer samme kontakt som rad ${firstRow}`, match: toMatch(existing, orgs.names) });
        counts.duplicate_in_file++;
        return;
      }
      targeted.set(existing.id, rowNumber);
      planned.match = toMatch(existing, orgs.names);
      planned.changes = buildContactUpdate(existing, values, orgTarget(organization), input.options).changes;
    } else if (planned.status !== 'possible_duplicate') {
      planned.status = 'new';
    }

    planned.suppressed = isSuppressed(values, context);
    if (planned.status !== 'possible_duplicate') planned.consent = consentOutcome(values, planned.suppressed, existing);
    if (values.email) seenEmails.set(values.email, rowNumber);
    if (values.phone) setOnce(seenPhones, values.phone, rowNumber);

    rows.push(planned);
    counts[planned.status]++;
    if (planned.suppressed) counts.suppressed++;
  });

  return { rows, counts, newOrganizations: [...orgs.created.values()], consentIgnored };
}

function isSuppressed(values: RowValues, context: PlanContext): boolean {
  return !!values.email && context.suppressedEmails.has(values.email);
}

function orgTarget(ref: OrgRef | null): OrgTarget | null {
  if (!ref) return null;
  return ref.kind === 'existing' ? { kind: 'existing', id: ref.id } : { kind: 'new', key: ref.key };
}

export interface ContactPatch {
  name?: string;
  email?: string;
  phone?: string;
  roleTitle?: string;
  organization?: OrgTarget;
  ownerId?: number;
  stage?: string;
  tags?: string[];
  customFields?: Record<string, unknown>;
}

/**
 * Hva som endres på en eksisterende kontakt. «Fyll bare tomme felt» rører
 * aldri en verdi som finnes; «Overskriv» bytter verdier som er ulike. Tomme
 * celler overskriver aldri, og tagger slås alltid sammen.
 */
export function buildContactUpdate(
  existing: ExistingContact,
  values: RowValues,
  organization: OrgTarget | null,
  options: ApplyOptions,
): { patch: ContactPatch; changes: string[] } {
  const overwrite = options.policy === 'overwrite';
  const patch: ContactPatch = {};
  const changes: string[] = [];
  const shouldSet = (current: unknown, next: unknown) =>
    next !== null && next !== undefined && next !== '' && (current === null || current === undefined || current === '' || (overwrite && current !== next));

  if (values.nameExplicit && overwrite && values.name !== existing.name) {
    patch.name = values.name;
    changes.push('navn');
  }
  if (values.email && shouldSet(existing.email, values.email)) {
    patch.email = values.email;
    changes.push('e-post');
  }
  if (values.phone && shouldSet(normalizePhone(existing.phone) ?? existing.phone, values.phone)) {
    patch.phone = values.phone;
    changes.push('telefon');
  }
  if (values.roleTitle && shouldSet(existing.roleTitle, values.roleTitle)) {
    patch.roleTitle = values.roleTitle;
    changes.push('stilling');
  }
  if (organization) {
    const sameOrg = organization.kind === 'existing' && organization.id === existing.organizationId;
    if (!sameOrg && (existing.organizationId === null || overwrite)) {
      patch.organization = organization;
      changes.push('bedrift');
    }
  }
  if (options.ownerId !== null && shouldSet(existing.ownerId, options.ownerId)) {
    patch.ownerId = options.ownerId;
    changes.push('ansvarlig');
  }
  if (options.stage && overwrite && existing.stage !== options.stage) {
    patch.stage = options.stage;
    changes.push('kundestatus');
  }

  const tags = mergeTags(existing.tags, values.tags, options.tags);
  if (tags.length !== existing.tags.length) {
    patch.tags = tags;
    changes.push('stikkord');
  }

  const custom = { ...existing.customFields };
  let customChanged = false;
  for (const [key, value] of Object.entries(values.customFields)) {
    const current = custom[key];
    if (shouldSet(current === undefined || current === null ? null : String(current), value)) {
      custom[key] = value;
      customChanged = true;
    }
  }
  if (customChanged) {
    patch.customFields = custom;
    changes.push('egne felt');
  }

  return { patch, changes };
}

export interface ContactCreateData {
  name: string;
  email: string | null;
  phone: string | null;
  roleTitle: string | null;
  ownerId: number | null;
  stage: string;
  tags: string[];
  customFields: Record<string, string>;
}

export function buildContactCreate(values: RowValues, options: ApplyOptions): ContactCreateData {
  return {
    name: values.name,
    email: values.email,
    phone: values.phone,
    roleTitle: values.roleTitle,
    ownerId: options.ownerId,
    stage: options.stage ?? 'lead',
    tags: mergeTags(values.tags, options.tags),
    customFields: values.customFields,
  };
}

/**
 * Kombinerer serverens plan med valgene admin gjorde i forhåndsvisningen.
 * Mulige duplikater hoppes over med mindre admin valgte noe annet, og en
 * sammenslåing gjelder bare kontakten admin faktisk så.
 */
export function resolveActions(plan: ImportPlan, decisions: RowDecision[]): RowAction[] {
  const byRow = new Map(decisions.map((d) => [d.row, d]));
  const touched = new Map<number, number>();
  for (const planned of plan.rows) {
    const updating = planned.status === 'update_email' || planned.status === 'update_phone';
    if (updating && byRow.get(planned.row)?.action !== 'skip') setOnce(touched, planned.match!.contactId, planned.row);
  }

  return plan.rows.map((planned): RowAction => {
    const { row } = planned;
    const decision = byRow.get(row);
    const skip = (reason: string): RowAction => ({ row, kind: 'skip', reason, planned });

    switch (planned.status) {
      case 'invalid':
      case 'duplicate_in_file':
        return skip(planned.reason ?? 'Kan ikke importeres');
      case 'new':
        return decision?.action === 'skip' ? skip('Valgt bort før import') : { row, kind: 'create', planned };
      case 'update_email':
      case 'update_phone':
        return decision?.action === 'skip'
          ? skip('Valgt bort før import')
          : { row, kind: 'update', contactId: planned.match!.contactId, planned };
      case 'possible_duplicate': {
        if (decision?.action === 'create') {
          return { row, kind: 'create', planned: { ...planned, consent: planned.consentAsNew ?? null } };
        }
        if (decision?.action !== 'merge') return skip('Mulig duplikat – hoppet over');
        const contactId = planned.match!.contactId;
        if (decision.contactId !== contactId) return skip('Kontakten er endret siden forhåndsvisningen – hoppet over');
        const firstRow = touched.get(contactId);
        if (firstRow) return skip(`Kontakten oppdateres allerede fra rad ${firstRow}`);
        touched.set(contactId, row);
        return { row, kind: 'update', contactId, planned };
      }
    }
  });
}
