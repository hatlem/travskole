import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { prisma, requireAdmin, loadPlanContext, executeImport, logActivity, addContactsToList } = vi.hoisted(() => ({
  addContactsToList: vi.fn(),
  prisma: {
    user: { findFirst: vi.fn() },
    contactList: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    contactListMembership: { createMany: vi.fn() },
  },
  requireAdmin: vi.fn(),
  loadPlanContext: vi.fn(),
  executeImport: vi.fn(),
  logActivity: vi.fn(async () => {}),
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({ requireAdmin }));
vi.mock('@/lib/activity', () => ({ logActivity }));
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/crm/import/context', () => ({ loadPlanContext }));
vi.mock('@/lib/crm/import/execute', () => ({ executeImport }));
vi.mock('@/lib/crm/list-membership', () => ({ addContactsToList }));

import { POST } from '@/app/api/admin/crm/import/route';
import type { ImportPlan, RowAction } from '@/lib/crm/import/types';

const TEXT = 'Navn;E-post;Bedrift\nKari;kari@x.no;Acme\nPer;per@ny.no;Acme\nFeil;feil;\n';
const COLUMNS = ['name', 'email', 'organization'];

function req(body: unknown) {
  return new NextRequest('http://x/api/admin/crm/import', { method: 'POST', body: JSON.stringify(body) });
}

function body(patch: Record<string, unknown> = {}) {
  return { text: TEXT, fileName: 'kunder.csv', columns: COLUMNS, options: {}, dryRun: true, ...patch };
}

const EMPTY_RESULT = { created: 1, updated: 1, unchanged: 0, skipped: 1, failed: 0, organizationsCreated: 0, contactIds: [100, 5], problems: [] };

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ user: { email: 'admin@x.no' } });
  loadPlanContext.mockResolvedValue({
    contacts: [{
      id: 5, name: 'Per', email: 'per@gammel.no', phone: null, roleTitle: null, organizationId: 10, ownerId: null,
      stage: 'lead', tags: [], customFields: {}, marketingConsent: false, consentWithdrawn: false,
    }],
    organizations: [{ id: 10, name: 'Acme AS', orgNumber: null, domain: null }],
    suppressedEmails: new Set(),
  });
  executeImport.mockResolvedValue(EMPTY_RESULT);
});

describe('POST /api/admin/crm/import', () => {
  it('requires admin', async () => {
    requireAdmin.mockResolvedValue(null);
    expect((await POST(req(body()))).status).toBe(401);
    expect(loadPlanContext).not.toHaveBeenCalled();
  });

  it('rejects malformed bodies with a friendly message', async () => {
    const res = await POST(req(body({ columns: ['hacker'] })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Last opp fila på nytt/);
  });

  it('rejects files over the row limit', async () => {
    const text = ['E-post', ...Array.from({ length: 5001 }, (_, i) => `p${i}@x.no`)].join('\n');
    const res = await POST(req(body({ text, columns: ['email'] })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Maks 5\s000 per import/);
  });

  it('rejects column setups that do not match the file or lack identifiers', async () => {
    expect((await POST(req(body({ columns: ['name', 'email'] })))).status).toBe(400);
    const res = await POST(req(body({ columns: ['name', 'ignore', 'organization'] })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/e-post eller telefon/);
  });

  it('rejects an owner who is not an active admin', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    const res = await POST(req(body({ options: { ownerId: 99 } })));
    expect(res.status).toBe(400);
  });

  it('dry run returns the server-side plan without writing', async () => {
    const res = await POST(req(body()));
    expect(res.status).toBe(200);
    const { plan } = (await res.json()) as { plan: ImportPlan };
    expect(plan.rows.map((r) => r.status)).toEqual(['new', 'possible_duplicate', 'invalid']);
    expect(plan.counts).toMatchObject({ new: 1, possible_duplicate: 1, invalid: 1 });
    expect(executeImport).not.toHaveBeenCalled();
  });

  it('repairs mojibake in the submitted text', async () => {
    const broken = new TextDecoder('windows-1252').decode(Buffer.from('Navn;E-post\nBjørn;b@x.no', 'utf8'));
    const res = await POST(req(body({ text: broken, columns: ['name', 'email'] })));
    const { plan } = (await res.json()) as { plan: ImportPlan };
    expect(plan.rows[0].values?.name).toBe('Bjørn');
  });

  it('import re-plans on the server and applies the admin decisions', async () => {
    const res = await POST(req(body({
      dryRun: false,
      decisions: [{ row: 3, action: 'merge', contactId: 5 }],
      // Klienten kan ikke smugle inn en egen plan — ekstra felt ignoreres.
      plan: { rows: [{ row: 2, status: 'update_email', match: { contactId: 1 } }] },
    })));
    expect(res.status).toBe(200);
    const actions = executeImport.mock.calls[0][0].actions as RowAction[];
    expect(actions.map((a) => [a.row, a.kind])).toEqual([[2, 'create'], [3, 'update'], [4, 'skip']]);
    expect(executeImport.mock.calls[0][0]).toMatchObject({ fileName: 'kunder.csv', actorEmail: 'admin@x.no' });
    expect(await res.json()).toEqual({ result: EMPTY_RESULT, list: null });
  });

  it('adds imported contacts to an existing list', async () => {
    prisma.contactList.findUnique.mockResolvedValue({ id: 7, name: 'Høst' });
    const res = await POST(req(body({ dryRun: false, options: { list: { kind: 'existing', id: 7 } } })));
    expect(res.status).toBe(200);
    expect(addContactsToList).toHaveBeenCalledWith(7, [100, 5], { source: 'import', actorEmail: 'admin@x.no' });
  });

  it('404s when the chosen list is gone, before writing anything', async () => {
    prisma.contactList.findUnique.mockResolvedValue(null);
    const res = await POST(req(body({ dryRun: false, options: { list: { kind: 'existing', id: 7 } } })));
    expect(res.status).toBe(404);
    expect(executeImport).not.toHaveBeenCalled();
  });

  it('reuses a list with the same name instead of creating a duplicate', async () => {
    prisma.contactList.findFirst.mockResolvedValue({ id: 3, name: 'Messe 2026' });
    await POST(req(body({ dryRun: false, options: { list: { kind: 'new', name: ' messe 2026 ' } } })));
    expect(prisma.contactList.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { name: { equals: 'messe 2026', mode: 'insensitive' } },
    }));
    expect(prisma.contactList.create).not.toHaveBeenCalled();
    expect(addContactsToList.mock.calls[0][0]).toBe(3);
  });

  it('creates a new list when none exists', async () => {
    prisma.contactList.findFirst.mockResolvedValue(null);
    prisma.contactList.create.mockResolvedValue({ id: 9, name: 'Messe 2026' });
    const res = await POST(req(body({ dryRun: false, options: { list: { kind: 'new', name: 'Messe 2026' } } })));
    expect(prisma.contactList.create).toHaveBeenCalledWith({ data: { name: 'Messe 2026' }, select: { id: true, name: true } });
    expect((await res.json()).list).toEqual({ id: 9, name: 'Messe 2026' });
  });

  it('logs the import', async () => {
    await POST(req(body({ dryRun: false })));
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', entity: 'contact_import', userEmail: 'admin@x.no' }));
  });

  it('returns a friendly 500 when the import crashes', async () => {
    executeImport.mockRejectedValue(new Error('db down'));
    const res = await POST(req(body({ dryRun: false })));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/blir gjenkjent hvis du prøver igjen/);
  });
});
