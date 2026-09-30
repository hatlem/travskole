import { describe, it, expect, vi } from 'vitest';
import { buildTemplateCopy, validateFlowCopy, type FlowTemplate, type TemplateContext } from '@/lib/flows/templates/builder';
import { STANDARD_TEMPLATES, REBOOKING_TEMPLATE } from '@/lib/flows/templates/library';
import {
  LEGACY_FLOW_NAME,
  buildLegacyLifecycleTemplate,
  legacyBodyToHtml,
  mapLegacyToLifecycle,
  normalizeLegacyTemplates,
  normalizeLegacyTriggers,
} from '@/lib/flows/templates/legacy';
import { LIFECYCLE_STEPS } from '@/lib/flows/templates/lifecycle-steps';
import {
  importLegacyCourseTemplates,
  installStandardTemplates,
  planTemplateInstall,
  TemplateInstallError,
} from '@/lib/flows/templates/install';
import { isEventType } from '@/lib/events/taxonomy';

const ctx: TemplateContext = { senderIdentityId: 7, senderName: 'Hege <Bjerke>', siteUrl: 'https://registrering.bjerke.no/' };

const MERGE_TAGS = ['forelder_navn', 'barnets_navn', 'kurs_navn', 'kurs_startdato', 'kurs_sluttdato', 'allergier', 'kontakt_epost'];

function emailConfigs(template: FlowTemplate) {
  return buildTemplateCopy(template, ctx)
    .nodes.filter((n) => n.type === 'email')
    .map((n) => JSON.parse(n.config) as { subject: string; bodyHtml: string; senderIdentityId: number });
}

function mergeTagsIn(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]);
}

// Tekstene fra de opprinnelige kursmalene (prisma/seed.js, mars 2026).
const LEGACY_ROWS: Record<string, unknown>[] = [
  { id: 1, name: 'Påmelding bekreftet', subject: 'Påmelding mottatt — {{kurs_navn}}', body: '<h2>Hei {{forelder_navn}}!</h2><p>Takk for påmeldingen.</p>' },
  { id: 2, name: 'Påminnelse før kursstart', subject: 'Påminnelse: {{kurs_navn}} starter snart!', body: '<p>Vi minner om at kurset starter.</p>' },
  { id: 3, name: 'Velkommen til kursstart', subject: 'Velkommen til {{kurs_navn}}!', body: '<p>I dag starter kurset.</p>' },
  { id: 4, name: 'Midtveis-oppdatering', subject: 'Halvveis i {{kurs_navn}}!', body: '<p>Vi er halvveis.</p>' },
  { id: 5, name: 'Takk for deltakelsen', subject: 'Takk for deltakelsen på {{kurs_navn}}!', body: '<p>Takk!</p><p>Med vennlig hilsen,<br>Teamet hos Bjerke Ponniskole</p>' },
];

describe('standard flytmaler', () => {
  it.each(STANDARD_TEMPLATES.map((t) => [t.name, t] as const))('«%s» passerer grafvalideringen', (_name, template) => {
    const copy = buildTemplateCopy(template, ctx);
    expect(validateFlowCopy(copy)).toEqual([]);
    expect(copy.flow.status).toBe('template');
  });

  it('har unike navn og gyldige utløsere', () => {
    expect(new Set(STANDARD_TEMPLATES.map((t) => t.name)).size).toBe(STANDARD_TEMPLATES.length);
    for (const template of STANDARD_TEMPLATES) {
      for (const trigger of template.triggers) expect(isEventType(trigger.eventType)).toBe(true);
    }
  });

  it('markerer markedsføring og forankring riktig', () => {
    const byName = Object.fromEntries(STANDARD_TEMPLATES.map((t) => [t.name, t]));
    expect(byName['Gjenbooking julebord/firmafest']).toMatchObject({ isMarketing: true, anchorMode: 'contact', triggers: [] });
    expect(byName['Oppfølging av forespørsel']).toMatchObject({ isMarketing: false, anchorMode: 'contact', triggers: [{ eventType: 'booking.created' }] });
    expect(byName['Etter arrangementet']).toMatchObject({ isMarketing: true, anchorMode: 'contact' });
    expect(byName['Velkommen ny kontakt']).toMatchObject({
      isMarketing: true,
      triggers: [{ eventType: 'consent.updated', filter: { marketing: true } }],
    });
  });

  it('bruker bare flettefelt som finnes i kontaktflyter', () => {
    for (const template of STANDARD_TEMPLATES) {
      for (const email of emailConfigs(template)) {
        expect(mergeTagsIn(email.subject + email.bodyHtml).every((tag) => tag === 'forelder_navn')).toBe(true);
      }
    }
  });

  it('fyller inn avsender, escaper signaturen og bygger absolutte lenker', () => {
    const [invite] = emailConfigs(REBOOKING_TEMPLATE);
    expect(invite.senderIdentityId).toBe(7);
    expect(invite.bodyHtml).toContain('Hege &lt;Bjerke&gt;');
    expect(invite.bodyHtml).toContain('href="https://registrering.bjerke.no/arrangementer"');
  });

  it('gjenbooking fortsetter ved svar og ender i en oppgave på hver gren', () => {
    const copy = buildTemplateCopy(REBOOKING_TEMPLATE, ctx);
    const configs = copy.nodes.map((n) => ({ type: n.type, config: JSON.parse(n.config) as Record<string, unknown> }));
    expect(configs.some((n) => n.config.kind === 'replied_email')).toBe(true);
    expect(configs.filter((n) => n.config.kind === 'create_task').length).toBeGreaterThanOrEqual(3);
    expect(configs.some((n) => n.config.kind === 'add_tag' && n.config.value === 'i dialog')).toBe(true);
  });

  it('gir hver node en egen plass i editoren', () => {
    for (const template of STANDARD_TEMPLATES) {
      const positions = buildTemplateCopy(template, ctx).nodes.map((n) => `${n.posX},${n.posY}`);
      expect(new Set(positions).size).toBe(positions.length);
    }
  });

  it('avviser en definisjon som peker på en ukjent node', () => {
    const broken: FlowTemplate = { ...REBOOKING_TEMPLATE, nodes: [{ key: 'start', type: 'start', next: 'mangler' }] };
    expect(() => buildTemplateCopy(broken, ctx)).toThrow(/ukjent node/);
  });
});

describe('planTemplateInstall', () => {
  it('hopper over maler som finnes og dupliserer ikke innen samme kjøring', () => {
    const plan = planTemplateInstall([{ name: 'A' }, { name: 'B' }, { name: 'A' }], ['B']);
    expect(plan.toCreate.map((t) => t.name)).toEqual(['A']);
    expect(plan.skipped).toEqual(['B', 'A']);
  });
});

function mockDb(opts: { existingTemplates?: string[]; sender?: { id: number; displayName: string } | null } = {}) {
  let nextId = 100;
  const existing = new Set(opts.existingTemplates ?? []);
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    flow: {
      findMany: vi.fn(async ({ where }: { where: { name: { in: string[] } } }) =>
        where.name.in.filter((n) => existing.has(n)).map((name) => ({ name })),
      ),
      findFirst: vi.fn(async ({ where }: { where: { name: string } }) => (existing.has(where.name) ? { id: 1 } : null)),
      create: vi.fn(async ({ data }: { data: { name: string } }) => {
        existing.add(data.name);
        return { id: ++nextId };
      }),
    },
    flowNode: { create: vi.fn(async () => ({ id: ++nextId })) },
    flowEdge: { createMany: vi.fn(async () => ({ count: 0 })) },
    flowTrigger: { createMany: vi.fn(async () => ({ count: 0 })) },
  };
  const db = {
    ...tx,
    senderIdentity: { findFirst: vi.fn(async () => (opts.sender === undefined ? { id: 3, displayName: 'Stine' } : opts.sender)) },
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
  };
  return { db, tx };
}

type InstallDb = Parameters<typeof installStandardTemplates>[0];

describe('installStandardTemplates', () => {
  it('oppretter alle ved første kjøring og ingen ved andre', async () => {
    const { db, tx } = mockDb();
    const first = await installStandardTemplates(db as unknown as InstallDb, { siteUrl: 'https://x.no' });
    expect(first.created.map((c) => c.name)).toEqual(STANDARD_TEMPLATES.map((t) => t.name));
    expect(first.skipped).toEqual([]);
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.flow.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'template' }) }));

    const second = await installStandardTemplates(db as unknown as InstallDb, { siteUrl: 'https://x.no' });
    expect(second.created).toEqual([]);
    expect(second.skipped).toHaveLength(STANDARD_TEMPLATES.length);
  });

  it('hopper over maler som allerede finnes', async () => {
    const { db } = mockDb({ existingTemplates: ['Velkommen ny kontakt'] });
    const result = await installStandardTemplates(db as unknown as InstallDb, { siteUrl: 'https://x.no' });
    expect(result.skipped).toEqual(['Velkommen ny kontakt']);
    expect(result.created).toHaveLength(STANDARD_TEMPLATES.length - 1);
  });

  it('feiler vennlig uten aktiv avsender', async () => {
    const { db } = mockDb({ sender: null });
    await expect(installStandardTemplates(db as unknown as InstallDb, { siteUrl: 'https://x.no' })).rejects.toBeInstanceOf(TemplateInstallError);
  });
});

describe('legacy-kursmaler', () => {
  it('mapper de opprinnelige malene til livssyklus-stegene etter navn', () => {
    const mapping = mapLegacyToLifecycle(normalizeLegacyTemplates(LEGACY_ROWS));
    expect(mapping.assignments.map((a) => [a.slot, a.template.id, a.via])).toEqual([
      ['reminder_before', 2, 'name'],
      ['welcome_start', 3, 'name'],
      ['midway', 4, 'name'],
      ['after_end', 5, 'name'],
    ]);
    expect(mapping.unmatched).toHaveLength(1);
    expect(mapping.unmatched[0].template.id).toBe(1);
  });

  it('foretrekker gammel utløsertype framfor navn', () => {
    const templates = normalizeLegacyTemplates([
      { id: 10, name: 'Hilsen A', subject: 'A', body: 'a' },
      { id: 11, name: 'Velkommen', subject: 'B', body: 'b' },
    ]);
    const triggers = normalizeLegacyTriggers([
      { id: 1, course_id: 4, template_id: 10, trigger_type: 'after_end', offset_days: 1, enabled: false },
      { id: 2, course_id: 4, template_id: 11, trigger_type: 'midway', offset_days: 0, enabled: false },
    ]);
    const mapping = mapLegacyToLifecycle(templates, triggers);
    expect(mapping.assignments.map((a) => [a.slot, a.template.id, a.via])).toEqual([
      ['midway', 11, 'trigger'],
      ['after_end', 10, 'trigger'],
    ]);
  });

  it('navnet vinner når triggeren sier bekreftelse men teksten er et livssyklus-steg', () => {
    const templates = normalizeLegacyTemplates([
      { id: 20, name: 'Påmelding bekreftet', subject: 'Påmelding mottatt — {{kurs_navn}}', body: 'a' },
      { id: 21, name: 'Velkommen til kursstart', subject: 'Velkommen til {{kurs_navn}}!', body: 'b' },
    ]);
    const triggers = normalizeLegacyTriggers([
      { id: 1, course_id: 4, template_id: 20, trigger_type: 'registration_confirmed', offset_days: 0, enabled: false },
      { id: 2, course_id: 4, template_id: 21, trigger_type: 'registration_confirmed', offset_days: 0, enabled: false },
    ]);
    const mapping = mapLegacyToLifecycle(templates, triggers);
    expect(mapping.assignments.map((a) => [a.slot, a.template.id, a.via])).toEqual([['welcome_start', 21, 'name']]);
    expect(mapping.unmatched.map((u) => u.template.id)).toEqual([20]);
  });

  it('fordeler uklassifiserte tekster på ledige steg i rekkefølge og rapporterer duplikater', () => {
    const templates = normalizeLegacyTemplates([
      { id: 1, name: 'Påminnelse', subject: 'P1', body: 'x' },
      { id: 2, name: 'Påminnelse 2', subject: 'P2', body: 'x' },
      { id: 3, name: 'Diverse', subject: 'D', body: 'x' },
    ]);
    const mapping = mapLegacyToLifecycle(templates);
    expect(mapping.assignments.map((a) => [a.slot, a.template.id, a.via])).toEqual([
      ['reminder_before', 1, 'name'],
      ['welcome_start', 3, 'order'],
    ]);
    expect(mapping.unmatched.map((u) => u.template.id)).toEqual([2]);
  });

  it('tolker ukjente kolonnenavn og bigint-id-er defensivt', () => {
    const [template] = normalizeLegacyTemplates([{ ID: BigInt(9), Title: 'Emne', Content: 'Tekst', created_at: new Date() }]);
    expect(template).toEqual({ id: 9, name: 'Emne', subject: 'Emne', body: 'Tekst' });
    expect(normalizeLegacyTemplates([{ id: 1, name: 'Tom', subject: '', body: '' }])).toEqual([]);
  });

  it('gjør ren tekst om til avsnitt og lar HTML være', () => {
    expect(legacyBodyToHtml('Hei {{forelder_navn}}!\nLinje to\n\n1 < 2 & <avsnitt>')).toBe(
      '<p>Hei {{forelder_navn}}!<br>Linje to</p><p>1 &lt; 2 &amp; &lt;avsnitt&gt;</p>',
    );
    expect(legacyBodyToHtml('<p>Hei</p>')).toBe('<p>Hei</p>');
  });

  it('bygger en gyldig kurs-mal med originaltekstene på riktige steg', () => {
    const mapping = mapLegacyToLifecycle(normalizeLegacyTemplates(LEGACY_ROWS));
    const template = buildLegacyLifecycleTemplate(mapping);
    const copy = buildTemplateCopy(template, ctx);
    expect(validateFlowCopy(copy)).toEqual([]);
    expect(copy.flow).toMatchObject({ name: LEGACY_FLOW_NAME, anchorMode: 'course', isMarketing: false, status: 'template' });
    expect(copy.triggers).toEqual([{ eventType: 'registration.created', filter: '{}' }]);

    const schedules = copy.nodes.filter((n) => n.type === 'schedule').map((n) => JSON.parse(n.config));
    expect(schedules).toEqual(LIFECYCLE_STEPS.map((s) => ({ anchor: s.anchor, offsetDays: s.offsetDays })));
    const subjects = copy.nodes.filter((n) => n.type === 'email').map((n) => JSON.parse(n.config).subject);
    expect(subjects).toEqual(LEGACY_ROWS.slice(1).map((r) => r.subject));
    expect(copy.flow.description).toContain('«Påmelding bekreftet»');
  });

  it('beholder standardteksten på steg uten original tekst', () => {
    const mapping = mapLegacyToLifecycle(normalizeLegacyTemplates([LEGACY_ROWS[3]]));
    const copy = buildTemplateCopy(buildLegacyLifecycleTemplate(mapping), ctx);
    const subjects = copy.nodes.filter((n) => n.type === 'email').map((n) => JSON.parse(n.config).subject);
    expect(subjects).toEqual([LIFECYCLE_STEPS[0].subject, LIFECYCLE_STEPS[1].subject, 'Halvveis i {{kurs_navn}}!', LIFECYCLE_STEPS[3].subject]);
  });

  it('livssyklus-stegene bruker bare kjente kurs-flettefelt', () => {
    for (const step of LIFECYCLE_STEPS) {
      expect(mergeTagsIn(step.subject + step.bodyHtml).every((tag) => MERGE_TAGS.includes(tag))).toBe(true);
    }
  });
});

describe('importLegacyCourseTemplates', () => {
  it('gir vennlig status når tabellen ikke finnes', async () => {
    const { db } = mockDb();
    db.$queryRaw.mockResolvedValue([]);
    const result = await importLegacyCourseTemplates(db as unknown as InstallDb, { siteUrl: 'https://x.no' });
    expect(result).toEqual({ status: 'missing_table' });
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('er idempotent når malen allerede finnes', async () => {
    const { db } = mockDb({ existingTemplates: [LEGACY_FLOW_NAME] });
    const result = await importLegacyCourseTemplates(db as unknown as InstallDb, { siteUrl: 'https://x.no' });
    expect(result).toEqual({ status: 'exists', flowId: 1 });
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('rapporterer tom tabell', async () => {
    const { db } = mockDb();
    db.$queryRaw.mockResolvedValue([{ column_name: 'id' }]);
    db.$queryRawUnsafe.mockResolvedValue([]);
    const result = await importLegacyCourseTemplates(db as unknown as InstallDb, { siteUrl: 'https://x.no' });
    expect(result).toEqual({ status: 'empty' });
  });

  it('oppretter malen fra tabellradene og rapporterer hva som ble brukt', async () => {
    const { db, tx } = mockDb();
    db.$queryRaw.mockResolvedValueOnce([{ column_name: 'id' }, { column_name: 'body' }]).mockResolvedValueOnce([]);
    db.$queryRawUnsafe.mockResolvedValue(LEGACY_ROWS);
    const result = await importLegacyCourseTemplates(db as unknown as InstallDb, { siteUrl: 'https://x.no' });
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith('SELECT * FROM "email_templates" ORDER BY id');
    expect(result.status).toBe('created');
    if (result.status !== 'created') return;
    expect(result.matched).toHaveLength(4);
    expect(result.unmatched).toEqual([expect.objectContaining({ name: 'Påmelding bekreftet' })]);
    expect(tx.flow.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: LEGACY_FLOW_NAME, status: 'template', anchorMode: 'course' }) }),
    );
  });
});
