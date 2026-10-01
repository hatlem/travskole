import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const { prisma, emitEvent } = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(),
    organization: { create: vi.fn(), findFirst: vi.fn() },
    contact: { create: vi.fn(), update: vi.fn() },
    note: { findFirst: vi.fn(), create: vi.fn() },
    consent: { upsert: vi.fn() },
    contactActivity: { create: vi.fn() },
  };
  return { prisma, emitEvent: vi.fn() };
});
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/events/bus', () => ({ emitEvent }));
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { executeImport, IMPORT_BATCH_SIZE } from '@/lib/crm/import/execute';
import { planImport, resolveActions, type ExistingContact, type PlanContext } from '@/lib/crm/import/plan';
import { DEFAULT_APPLY_OPTIONS, type ApplyOptions, type ColumnTarget, type RowDecision } from '@/lib/crm/import/types';

const HEADERS = ['Navn', 'E-post', 'Telefon', 'Bedrift', 'Nettside', 'Notat', 'Samtykke'];
const COLUMNS: ColumnTarget[] = ['name', 'email', 'phone', 'organization', 'website', 'note', 'consent'];
const NOW = new Date('2026-10-01T10:00:00Z');

function existing(patch: Partial<ExistingContact> & { id: number }): ExistingContact {
  return {
    name: 'X', email: null, phone: null, roleTitle: null, organizationId: null, ownerId: null, stage: 'lead',
    tags: [], customFields: {}, marketingConsent: false, consentWithdrawn: false, ...patch,
  };
}

const CONFIRMED: ApplyOptions = { ...DEFAULT_APPLY_OPTIONS, confirmConsent: true };

function run(rows: string[][], context: Partial<PlanContext> = {}, options: ApplyOptions = CONFIRMED, decisions: RowDecision[] = []) {
  const ctx: PlanContext = { contacts: [], organizations: [], suppressedEmails: new Set(), ...context };
  const plan = planImport({ headers: HEADERS, rows, columns: COLUMNS, options }, ctx);
  return executeImport({
    plan, actions: resolveActions(plan, decisions), context: ctx, options, fileName: 'kunder.csv', actorEmail: 'admin@x.no', now: NOW,
  });
}

let nextId = 100;
beforeEach(() => {
  vi.clearAllMocks();
  nextId = 100;
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
  prisma.contact.create.mockImplementation(async () => ({ id: nextId++ }));
  prisma.organization.create.mockImplementation(async () => ({ id: 500 }));
  prisma.note.findFirst.mockResolvedValue(null);
});

describe('executeImport', () => {
  it('creates contacts with organization, timeline entry and counts', async () => {
    const result = await run([['Kari', 'kari@x.no', '912 34 567', 'Nytt Firma AS', 'nytt.no', '', '']]);

    expect(prisma.organization.create).toHaveBeenCalledWith({
      data: { name: 'Nytt Firma AS', orgNumber: null, domain: 'nytt.no', stage: 'lead' }, select: { id: true },
    });
    expect(prisma.contact.create).toHaveBeenCalledWith({
      data: {
        name: 'Kari', email: 'kari@x.no', phone: '+4791234567', roleTitle: null, ownerId: null, stage: 'lead',
        tags: '[]', customFields: '{}', organizationId: 500, source: 'import', lastActivityAt: NOW,
      },
      select: { id: true },
    });
    expect(prisma.contactActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contactId: 100, type: 'import', title: 'Importert fra CSV (kunder.csv)', body: null, actorEmail: 'admin@x.no', occurredAt: NOW,
      }),
    });
    expect(result).toEqual({
      created: 1, updated: 0, unchanged: 0, skipped: 0, failed: 0, organizationsCreated: 1, contactIds: [100], problems: [], consentNotice: null,
    });
  });

  it('updates only changed fields and stays quiet for unchanged contacts', async () => {
    const result = await run(
      [['Kari', 'kari@x.no', '91234567', '', '', '', ''], ['Ola', 'ola@x.no', '', '', '', '', '']],
      { contacts: [existing({ id: 1, name: 'Kari', email: 'kari@x.no' }), existing({ id: 2, name: 'Ola', email: 'ola@x.no' })] },
    );
    expect(prisma.contact.update).toHaveBeenCalledTimes(1);
    expect(prisma.contact.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { phone: '+4791234567', lastActivityAt: NOW } });
    expect(prisma.contactActivity.create).toHaveBeenCalledTimes(1);
    expect(prisma.contactActivity.create.mock.calls[0][0].data.body).toBe('Oppdatert: telefon');
    expect(result).toMatchObject({ updated: 1, unchanged: 1, contactIds: [1, 2] });
  });

  it('adds notes once (re-running the same file does not duplicate them)', async () => {
    await run([['Kari', 'kari@x.no', '', '', '', 'Ringte i mai', '']]);
    expect(prisma.note.create).toHaveBeenCalledWith({ data: { contactId: 100, body: 'Ringte i mai', authorEmail: 'admin@x.no' } });

    vi.clearAllMocks();
    prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
    prisma.note.findFirst.mockResolvedValue({ id: 1 });
    const result = await run([['Kari', 'kari@x.no', '', '', '', 'Ringte i mai', '']], { contacts: [existing({ id: 100, name: 'Kari', email: 'kari@x.no' })] });
    expect(prisma.note.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ unchanged: 1, updated: 0 });
  });

  it('records consent only for rows that said yes, and emits consent.updated after commit', async () => {
    await run([['Kari', 'kari@x.no', '', '', '', '', 'ja'], ['Ola', 'ola@x.no', '', '', '', '', 'nei']]);
    expect(prisma.consent.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.consent.upsert).toHaveBeenCalledWith({
      where: { contactId: 100 },
      create: { contactId: 100, marketing: true, lawfulBasis: 'consent', consentAt: NOW, source: 'import' },
      update: { marketing: true, lawfulBasis: 'consent', consentAt: NOW, source: 'import' },
    });
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'consent.updated', contactId: 100 }));
  });

  it('writes no consent and reports it when the consent column was not confirmed', async () => {
    const result = await run([['Kari', 'kari@x.no', '', '', '', '', 'ja']], {}, DEFAULT_APPLY_OPTIONS);
    expect(prisma.contact.create).toHaveBeenCalled();
    expect(prisma.consent.upsert).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
    expect(result.consentNotice).toMatch(/Samtykke ble ikke registrert/);
  });

  it('never grants consent from a confirmed-looking plan when options are not confirmed', async () => {
    const ctx: PlanContext = { contacts: [], organizations: [], suppressedEmails: new Set() };
    const plan = planImport({ headers: HEADERS, rows: [['Kari', 'kari@x.no', '', '', '', '', 'ja']], columns: COLUMNS, options: CONFIRMED }, ctx);
    await executeImport({
      plan, actions: resolveActions(plan, []), context: ctx, options: DEFAULT_APPLY_OPTIONS,
      fileName: 'x.csv', actorEmail: 'admin@x.no', now: NOW,
    });
    expect(prisma.consent.upsert).not.toHaveBeenCalled();
  });



  it('never grants consent to suppressed addresses', async () => {
    await run([['Kari', 'kari@x.no', '', '', '', '', 'ja']], { suppressedEmails: new Set(['kari@x.no']) });
    expect(prisma.contact.create).toHaveBeenCalled();
    expect(prisma.consent.upsert).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('creating a possible duplicate grants consent as for a brand-new contact', async () => {
    const candidate = existing({ id: 5, name: 'Kari', organizationId: 10, consentWithdrawn: true });
    const orgs = [{ id: 10, name: 'Acme AS', orgNumber: null, domain: null }];
    await run([['Kari', 'kari@ny.no', '', 'Acme', '', '', 'ja']], { contacts: [candidate], organizations: orgs }, CONFIRMED, [{ row: 2, action: 'create' }]);
    expect(prisma.contact.create).toHaveBeenCalled();
    expect(prisma.consent.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { contactId: 100 } }));
  });

  it('reports skipped rows as problems with reasons', async () => {
    const result = await run([['Kari', 'feil', '', '', '', '', ''], ['Ola', 'ola@x.no', '', '', '', '', '']], {}, DEFAULT_APPLY_OPTIONS, [{ row: 3, action: 'skip' }]);
    expect(result.problems).toEqual([
      { row: 2, reason: 'Ugyldig e-postadresse: «feil»' },
      { row: 3, reason: 'Valgt bort før import' },
    ]);
    expect(result.skipped).toBe(2);
    expect(prisma.contact.create).not.toHaveBeenCalled();
  });

  it('only creates organizations used by imported rows', async () => {
    await run([['Kari', 'kari@x.no', '', 'Firma A', '', '', '']], {}, DEFAULT_APPLY_OPTIONS, [{ row: 2, action: 'skip' }]);
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it('reuses an organization whose domain was taken meanwhile', async () => {
    prisma.organization.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }),
    );
    prisma.organization.findFirst.mockResolvedValueOnce({ id: 77 });
    await run([['Kari', 'kari@x.no', '', 'Firma', 'firma.no', '', '']]);
    expect(prisma.organization.findFirst).toHaveBeenCalledWith({ where: { domain: 'firma.no' }, select: { id: true } });
    expect(prisma.contact.create.mock.calls[0][0].data.organizationId).toBe(77);
  });

  it('runs one transaction per batch', async () => {
    const rows = Array.from({ length: IMPORT_BATCH_SIZE * 2 + 5 }, (_, i) => [`P${i}`, `p${i}@x.no`, '', '', '', '', '']);
    const result = await run(rows);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(result.created).toBe(rows.length);
  });

  it('falls back to row-by-row when a batch fails, keeping the good rows', async () => {
    prisma.contact.create.mockImplementation(async ({ data }: { data: { email: string } }) => {
      if (data.email === 'dup@x.no') throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });
      return { id: nextId++ };
    });
    const result = await run([
      ['A', 'a@x.no', '', '', '', '', ''],
      ['Dup', 'dup@x.no', '', '', '', '', ''],
      ['B', 'b@x.no', '', '', '', '', ''],
    ]);
    expect(result).toMatchObject({ created: 2, failed: 1 });
    expect(result.problems).toEqual([{ row: 3, reason: 'E-postadressen brukes allerede av en annen kontakt' }]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(4);
  });

  it('gives a friendly message for unexpected errors', async () => {
    prisma.contact.create.mockRejectedValue(new Error('connection reset'));
    const result = await run([['A', 'a@x.no', '', '', '', '', '']]);
    expect(result.problems).toEqual([{ row: 2, reason: 'Noe gikk galt med denne raden – prøv igjen senere' }]);
  });

  it('applies options (owner, stage, tags) to new contacts', async () => {
    await run([['Kari', 'kari@x.no', '', '', '', '', '']], {}, { policy: 'fill_empty', tags: ['Import'], ownerId: 4, stage: 'customer', confirmConsent: false });
    expect(prisma.contact.create.mock.calls[0][0].data).toMatchObject({ ownerId: 4, stage: 'customer', tags: '["Import"]' });
  });
});
