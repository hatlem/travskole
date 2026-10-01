import { describe, it, expect } from 'vitest';
import {
  buildContactCreate, buildContactUpdate, planImport, resolveActions,
  type ExistingContact, type ExistingOrganization, type PlanContext,
} from '@/lib/crm/import/plan';
import { DEFAULT_APPLY_OPTIONS, type ApplyOptions, type ColumnTarget, type RowValues } from '@/lib/crm/import/types';

const HEADERS = ['Navn', 'E-post', 'Telefon', 'Bedrift', 'Orgnr', 'Nettside', 'Tagger', 'Samtykke'];
const COLUMNS: ColumnTarget[] = ['name', 'email', 'phone', 'organization', 'orgNumber', 'website', 'tags', 'consent'];

function contact(patch: Partial<ExistingContact> & { id: number }): ExistingContact {
  return {
    name: 'Eksisterende', email: null, phone: null, roleTitle: null, organizationId: null, ownerId: null,
    stage: 'lead', tags: [], customFields: {}, marketingConsent: false, consentWithdrawn: false, ...patch,
  };
}

function ctx(patch: Partial<PlanContext> = {}): PlanContext {
  return { contacts: [], organizations: [], suppressedEmails: new Set(), ...patch };
}

/** [navn, e-post, telefon, bedrift, orgnr, nettside, tagger, samtykke] */
function r(name = '', email = '', phone = '', org = '', orgnr = '', website = '', tags = '', consent = ''): string[] {
  return [name, email, phone, org, orgnr, website, tags, consent];
}

const CONFIRMED: ApplyOptions = { ...DEFAULT_APPLY_OPTIONS, confirmConsent: true };

function plan(rows: string[][], context = ctx(), options: ApplyOptions = CONFIRMED) {
  return planImport({ headers: HEADERS, rows, columns: COLUMNS, options }, context);
}

const ACME: ExistingOrganization = { id: 10, name: 'Acme AS', orgNumber: '974760673', domain: 'acme.no' };

describe('planImport – statuses', () => {
  it('new contact when nothing matches; row numbers follow Excel (header = row 1)', () => {
    const p = plan([r('Kari', 'kari@x.no')]);
    expect(p.rows[0]).toMatchObject({ row: 2, status: 'new', match: null, values: { email: 'kari@x.no' } });
    expect(p.counts.new).toBe(1);
  });

  it('matches existing contact on normalized email', () => {
    const p = plan([r('Kari', '  KARI@X.NO ')], ctx({ contacts: [contact({ id: 1, email: 'kari@x.no', name: 'Kari' })] }));
    expect(p.rows[0]).toMatchObject({ status: 'update_email', match: { contactId: 1 } });
  });

  it('matches existing contact on normalized Norwegian phone', () => {
    const existing = contact({ id: 2, phone: '912 34 567', name: 'Ola' });
    for (const phone of ['+47 912 34 567', '0047 91234567', '91234567', '4791234567']) {
      expect(plan([r('Ola', '', phone)], ctx({ contacts: [existing] })).rows[0]).toMatchObject({
        status: 'update_phone', match: { contactId: 2 },
      });
    }
  });

  it('email wins over phone', () => {
    const p = plan([r('Kari', 'kari@x.no', '91234567')], ctx({
      contacts: [contact({ id: 1, phone: '91234567' }), contact({ id: 2, email: 'kari@x.no' })],
    }));
    expect(p.rows[0]).toMatchObject({ status: 'update_email', match: { contactId: 2 } });
  });

  it('does not phone-match a contact that has a different email', () => {
    const p = plan([r('Kari', 'kari@x.no', '91234567')], ctx({ contacts: [contact({ id: 1, email: 'annen@x.no', phone: '91234567' })] }));
    expect(p.rows[0].status).toBe('new');
  });

  it('phone-matches a contact without email and fills the email in', () => {
    const p = plan([r('Kari', 'kari@x.no', '91234567')], ctx({ contacts: [contact({ id: 1, phone: '+4791234567' })] }));
    expect(p.rows[0]).toMatchObject({ status: 'update_phone', changes: expect.arrayContaining(['e-post']) });
  });

  it('warns when several contacts share the phone and picks the oldest', () => {
    const p = plan([r('Ola', '', '91234567')], ctx({ contacts: [contact({ id: 9, phone: '91234567' }), contact({ id: 3, phone: '+47 912 34 567' })] }));
    expect(p.rows[0].match?.contactId).toBe(3);
    expect(p.rows[0].warnings[0]).toMatch(/2 kontakter/);
  });

  it('flags possible duplicate on same name + same existing organization', () => {
    const existing = contact({ id: 5, name: 'Kari Nordmann', email: 'kari@gammel.no', organizationId: 10 });
    const p = plan([r('kari  nordmann', 'kari@ny.no', '', 'ACME')], ctx({ contacts: [existing], organizations: [ACME] }));
    expect(p.rows[0]).toMatchObject({
      status: 'possible_duplicate',
      match: { contactId: 5, name: 'Kari Nordmann', email: 'kari@gammel.no', organizationName: 'Acme AS' },
    });
    expect(p.counts.possible_duplicate).toBe(1);
  });

  it('no possible duplicate when the organization differs or is new', () => {
    const existing = contact({ id: 5, name: 'Kari', organizationId: 10 });
    expect(plan([r('Kari', 'k@ny.no', '', 'Annen AS')], ctx({ contacts: [existing], organizations: [ACME] })).rows[0].status).toBe('new');
    expect(plan([r('Kari', 'k@ny.no')], ctx({ contacts: [existing], organizations: [ACME] })).rows[0].status).toBe('new');
  });

  it('no possible duplicate when the name is only derived from the email', () => {
    const existing = contact({ id: 5, name: 'kari', organizationId: 10 });
    expect(plan([r('', 'kari@acme.no', '', 'Acme')], ctx({ contacts: [existing], organizations: [ACME] })).rows[0].status).toBe('new');
  });

  it('invalid rows carry the reason', () => {
    const p = plan([r('Kari', 'ikke-epost'), r('Ola'), r('', '', '91234567')]);
    expect(p.rows.map((x) => [x.status, x.reason])).toEqual([
      ['invalid', 'Ugyldig e-postadresse: «ikke-epost»'],
      ['invalid', 'Mangler både e-post og telefon'],
      ['invalid', 'Mangler navn'],
    ]);
    expect(p.counts.invalid).toBe(3);
  });

  it('duplicate emails in the file: first row wins', () => {
    const p = plan([r('Kari', 'kari@x.no'), r('Kari B', 'KARI@x.no ')]);
    expect(p.rows[1]).toMatchObject({ status: 'duplicate_in_file', reason: 'Samme person som rad 2' });
    expect(p.counts).toMatchObject({ new: 1, duplicate_in_file: 1 });
  });

  it('duplicate phones in the file when the later row has no email', () => {
    const p = plan([r('Kari', 'kari@x.no', '91234567'), r('Kari', '', '+47 912 34 567')]);
    expect(p.rows[1]).toMatchObject({ status: 'duplicate_in_file', reason: 'Samme person som rad 2' });
  });

  it('different emails sharing a phone in the file are different people', () => {
    const p = plan([r('Mor', 'mor@x.no', '91234567'), r('Far', 'far@x.no', '91234567')]);
    expect(p.rows.map((x) => x.status)).toEqual(['new', 'new']);
  });

  it('two rows hitting the same existing contact: only the first updates', () => {
    const existing = contact({ id: 1, email: 'kari@x.no', phone: '91234567' });
    const p = plan([r('Kari', 'kari@x.no'), r('Kari', '', '91234567')], ctx({ contacts: [existing] }));
    expect(p.rows[1]).toMatchObject({ status: 'duplicate_in_file', reason: 'Treffer samme kontakt som rad 2' });
  });

  it('flags suppressed emails but still imports them', () => {
    const p = plan([r('Kari', 'kari@x.no', '', '', '', '', '', 'ja')], ctx({ suppressedEmails: new Set(['kari@x.no']) }));
    expect(p.rows[0]).toMatchObject({ status: 'new', suppressed: true, consent: 'blocked' });
    expect(p.counts.suppressed).toBe(1);
  });

  it('is idempotent: planning the same file after import yields only updates without changes', () => {
    const rows = [r('Kari', 'kari@x.no', '91234567', '', '', '', 'VIP')];
    const after = ctx({ contacts: [contact({ id: 1, name: 'Kari', email: 'kari@x.no', phone: '+4791234567', tags: ['VIP'] })] });
    expect(plan(rows, after).rows[0]).toMatchObject({ status: 'update_email', changes: [] });
  });
});

describe('planImport – consent', () => {
  it('grants only when the consent column says yes', () => {
    const p = plan([r('A', 'a@x.no', '', '', '', '', '', 'ja'), r('B', 'b@x.no', '', '', '', '', '', 'nei'), r('C', 'c@x.no')]);
    expect(p.rows.map((x) => x.consent)).toEqual(['grant', null, null]);
  });

  it('never re-grants for contacts who withdrew, and skips if already consented', () => {
    const p = plan(
      [r('A', 'a@x.no', '', '', '', '', '', 'ja'), r('B', 'b@x.no', '', '', '', '', '', 'ja')],
      ctx({ contacts: [contact({ id: 1, email: 'a@x.no', consentWithdrawn: true }), contact({ id: 2, email: 'b@x.no', marketingConsent: true })] }),
    );
    expect(p.rows.map((x) => x.consent)).toEqual(['blocked', null]);
  });

  it('computes consent against the candidate for possible duplicates', () => {
    const existing = contact({ id: 5, name: 'Kari', organizationId: 10, consentWithdrawn: true });
    const p = plan([r('Kari', 'kari@ny.no', '', 'Acme', '', '', '', 'ja')], ctx({ contacts: [existing], organizations: [ACME] }));
    expect(p.rows[0]).toMatchObject({ status: 'possible_duplicate', consent: 'blocked' });
  });

  it('ignores consent values entirely until the consent column is confirmed', () => {
    const p = plan([r('A', 'a@x.no', '', '', '', '', '', 'ja'), r('B', 'b@x.no', '', '', '', '', '', 'kanskje')], ctx(), DEFAULT_APPLY_OPTIONS);
    expect(p.consentIgnored).toBe(true);
    expect(p.rows.map((x) => [x.consent, x.values?.consent, x.warnings])).toEqual([[null, null, []], [null, null, []]]);
    expect(plan([r('A', 'a@x.no', '', '', '', '', '', 'ja')]).consentIgnored).toBe(false);
  });
});

describe('planImport – organizations', () => {
  const orgs: ExistingOrganization[] = [
    ACME,
    { id: 11, name: 'Bjerke Travbane', orgNumber: null, domain: 'bjerke.no' },
    { id: 12, name: 'Navnelikt AS', orgNumber: null, domain: null },
  ];
  const resolve = (row: string[]) => plan([row], ctx({ organizations: orgs })).rows[0].organization;

  it('matches by org number first', () => {
    expect(resolve(r('K', 'k@gmail.com', '', 'Feil Navn', 'NO 974 760 673 MVA'))).toMatchObject({ kind: 'existing', id: 10, matchedBy: 'orgnr' });
  });

  it('then by website domain', () => {
    expect(resolve(r('K', 'k@gmail.com', '', 'Feil Navn', '', 'https://www.bjerke.no/om'))).toMatchObject({ id: 11, matchedBy: 'domain' });
  });

  it('then by normalized name', () => {
    expect(resolve(r('K', 'k@gmail.com', '', 'navnelikt'))).toMatchObject({ id: 12, matchedBy: 'name' });
  });

  it('uses the company email domain only when the row has no company name', () => {
    expect(resolve(r('K', 'k@bjerke.no'))).toMatchObject({ id: 11, matchedBy: 'domain' });
    expect(resolve(r('K', 'k@bjerke.no', '', 'Konsulent AS'))).toMatchObject({ kind: 'new', name: 'Konsulent AS' });
  });

  it('never matches freemail domains and does not create orgs from email alone', () => {
    const withGmailOrg = [...orgs, { id: 13, name: 'Gmail', orgNumber: null, domain: 'gmail.com' }];
    expect(plan([r('K', 'k@gmail.com')], ctx({ organizations: withGmailOrg })).rows[0].organization).toBeNull();
    expect(resolve(r('K', 'k@ukjent.no'))).toBeNull();
  });

  it('creates unknown organizations once per file and shares them between rows', () => {
    const p = plan([
      r('A', 'a@x.no', '', 'Nytt Firma AS'),
      r('B', 'b@x.no', '', 'NYTT FIRMA'),
      r('C', 'c@x.no', '', '', '', 'nyttfirma.no'),
    ], ctx());
    expect(p.rows[0].organization).toEqual({ kind: 'new', key: 'nytt firma', name: 'Nytt Firma AS' });
    expect(p.rows[1].organization).toEqual(p.rows[0].organization);
    expect(p.rows[2].organization).toMatchObject({ kind: 'new', name: 'Nyttfirma' });
    expect(p.newOrganizations).toEqual([
      { key: 'nytt firma', name: 'Nytt Firma AS', orgNumber: null, domain: null },
      { key: 'nyttfirma', name: 'Nyttfirma', orgNumber: null, domain: 'nyttfirma.no' },
    ]);
  });

  it('enriches a planned organization with org number / domain from later rows', () => {
    const p = plan([
      r('A', 'a@x.no', '', 'Nytt Firma'),
      r('B', 'b@x.no', '', 'Nytt Firma', '974760673', 'nytt.no'),
      r('C', 'c@x.no', '', 'Annet navn', '974760673'),
    ], ctx());
    expect(p.newOrganizations).toEqual([{ key: 'nytt firma', name: 'Nytt Firma', orgNumber: '974760673', domain: 'nytt.no' }]);
    expect(p.rows[2].organization).toMatchObject({ kind: 'new', key: 'nytt firma' });
  });

  it('skips organizations for invalid and duplicate rows', () => {
    const p = plan([r('A', 'bad', '', 'Firma 1'), r('B', 'b@x.no'), r('B', 'b@x.no', '', 'Firma 2')], ctx());
    expect(p.newOrganizations).toEqual([]);
  });
});

describe('buildContactUpdate', () => {
  const values: RowValues = {
    name: 'Kari Ny', nameExplicit: true, email: 'kari@x.no', phone: '+4799999999', organizationName: null, orgNumber: null,
    website: null, roleTitle: 'Leder', tags: ['VIP'], note: null, consent: null, customFields: { Medlemsnr: '2' },
  };
  const existing = contact({
    id: 1, name: 'Kari', email: 'kari@x.no', phone: '91234567', roleTitle: null, organizationId: 10, ownerId: 3,
    stage: 'customer', tags: ['Gammel'], customFields: { Medlemsnr: '1', Annet: 'x' },
  });

  it('fill_empty only fills missing values and merges tags', () => {
    const { patch, changes } = buildContactUpdate(existing, values, { kind: 'existing', id: 11 }, { ...DEFAULT_APPLY_OPTIONS, ownerId: 4, stage: 'lead' });
    expect(patch).toEqual({ roleTitle: 'Leder', tags: ['Gammel', 'VIP'] });
    expect(changes).toEqual(['stilling', 'stikkord']);
  });

  it('overwrite replaces differing values but keeps what the file does not have', () => {
    const { patch, changes } = buildContactUpdate(existing, values, { kind: 'existing', id: 11 }, { policy: 'overwrite', tags: ['Import'], ownerId: 4, stage: 'lead', confirmConsent: false });
    expect(patch).toEqual({
      name: 'Kari Ny', phone: '+4799999999', roleTitle: 'Leder', organization: { kind: 'existing', id: 11 }, ownerId: 4,
      stage: 'lead', tags: ['Gammel', 'VIP', 'Import'], customFields: { Medlemsnr: '2', Annet: 'x' },
    });
    expect(changes).toEqual(['navn', 'telefon', 'stilling', 'bedrift', 'ansvarlig', 'kundestatus', 'stikkord', 'egne felt']);
  });

  it('never overwrites with empty values or derived names', () => {
    const empty: RowValues = { ...values, name: 'kari', nameExplicit: false, phone: null, roleTitle: null, tags: [], customFields: {} };
    expect(buildContactUpdate(existing, empty, null, { ...DEFAULT_APPLY_OPTIONS, policy: 'overwrite' })).toEqual({ patch: {}, changes: [] });
  });

  it('treats equivalent phone formats as unchanged', () => {
    const same = { ...values, phone: '+4791234567' };
    expect(buildContactUpdate(existing, same, null, { ...DEFAULT_APPLY_OPTIONS, policy: 'overwrite' }).changes).not.toContain('telefon');
  });

  it('fills organization, owner and custom fields when empty', () => {
    const bare = contact({ id: 2, email: 'kari@x.no' });
    const { patch } = buildContactUpdate(bare, values, { kind: 'new', key: 'acme' }, { ...DEFAULT_APPLY_OPTIONS, ownerId: 4 });
    expect(patch).toMatchObject({ organization: { kind: 'new', key: 'acme' }, ownerId: 4, customFields: { Medlemsnr: '2' }, phone: '+4799999999' });
  });

  it('does not report organization change when it is the same org', () => {
    expect(buildContactUpdate(existing, values, { kind: 'existing', id: 10 }, { ...DEFAULT_APPLY_OPTIONS, policy: 'overwrite' }).changes).not.toContain('bedrift');
  });
});

describe('buildContactCreate', () => {
  it('applies options and defaults stage to lead', () => {
    const values: RowValues = {
      name: 'Kari', nameExplicit: true, email: 'k@x.no', phone: null, organizationName: null, orgNumber: null, website: null,
      roleTitle: null, tags: ['VIP'], note: null, consent: null, customFields: {},
    };
    expect(buildContactCreate(values, { ...DEFAULT_APPLY_OPTIONS, tags: ['Import', 'vip'], ownerId: 4 })).toEqual({
      name: 'Kari', email: 'k@x.no', phone: null, roleTitle: null, ownerId: 4, stage: 'lead', tags: ['VIP', 'Import'], customFields: {},
    });
    expect(buildContactCreate(values, { ...DEFAULT_APPLY_OPTIONS, stage: 'customer' }).stage).toBe('customer');
  });
});

describe('resolveActions', () => {
  const existing = [
    contact({ id: 1, email: 'kari@x.no' }),
    contact({ id: 5, name: 'Per', email: 'per@gammel.no', organizationId: 10 }),
  ];
  const p = plan(
    [
      r('Ny', 'ny@x.no'),            // 2 new
      r('Kari', 'kari@x.no'),        // 3 update_email
      r('Per', 'per@ny.no', '', 'Acme'), // 4 possible_duplicate → 5
      r('Feil', 'feil'),             // 5 invalid
      r('Ny', 'ny@x.no'),            // 6 duplicate_in_file
    ],
    ctx({ contacts: existing, organizations: [ACME] }),
  );

  it('defaults: import new/updates, skip possible duplicates, invalid and in-file duplicates', () => {
    expect(resolveActions(p, []).map((a) => [a.row, a.kind])).toEqual([
      [2, 'create'], [3, 'update'], [4, 'skip'], [5, 'skip'], [6, 'skip'],
    ]);
    const skipped = resolveActions(p, []).filter((a) => a.kind === 'skip');
    expect(skipped.map((a) => a.kind === 'skip' && a.reason)).toEqual([
      'Mulig duplikat – hoppet over', 'Ugyldig e-postadresse: «feil»', 'Samme person som rad 2',
    ]);
  });

  it('respects deselected rows', () => {
    const actions = resolveActions(p, [{ row: 2, action: 'skip' }, { row: 3, action: 'skip' }]);
    expect(actions.slice(0, 2).map((a) => a.kind === 'skip' && a.reason)).toEqual(['Valgt bort før import', 'Valgt bort før import']);
  });

  it('merges or creates possible duplicates on request', () => {
    expect(resolveActions(p, [{ row: 4, action: 'merge', contactId: 5 }])[2]).toMatchObject({ kind: 'update', contactId: 5 });
    expect(resolveActions(p, [{ row: 4, action: 'create' }])[2]).toMatchObject({ kind: 'create' });
  });

  it('refuses a merge into a different contact than the admin saw', () => {
    expect(resolveActions(p, [{ row: 4, action: 'merge', contactId: 99 }])[2]).toMatchObject({
      kind: 'skip', reason: 'Kontakten er endret siden forhåndsvisningen – hoppet over',
    });
  });

  it('ignores decisions that do not fit the row status', () => {
    expect(resolveActions(p, [{ row: 5, action: 'create' }, { row: 6, action: 'import' }]).slice(3).map((a) => a.kind)).toEqual(['skip', 'skip']);
  });

  it('never lets a merge and an update hit the same contact', () => {
    const q = plan(
      [r('Per', 'per@ny.no', '', 'Acme'), r('Per', 'per@gammel.no')],
      ctx({ contacts: existing, organizations: [ACME] }),
    );
    const actions = resolveActions(q, [{ row: 2, action: 'merge', contactId: 5 }]);
    expect(actions[0]).toMatchObject({ kind: 'skip', reason: 'Kontakten oppdateres allerede fra rad 3' });
    expect(actions[1]).toMatchObject({ kind: 'update', contactId: 5 });
  });
});
