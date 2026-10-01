import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

// Liten minne-DB som teller spørringer, så bulk-stiene kan måles (O(biter), ikke O(kontakter)).
const { db, prisma, calls } = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const db = {
    contacts: new Map<number, { id: number; lastActivityAt: Date | null }>(),
    events: [] as Row[],
    activities: [] as Row[],
    memberships: [] as { listId: number; contactId: number; addedAt: Date }[],
    enrollments: [] as { flowId: number; contactId: number; status: string; registrationId?: number | null }[],
    triggers: [] as { flowId: number; eventType: string; filter: string; flow: { anchorMode: string } }[],
  };
  const calls = new Map<string, number>();
  const count = (name: string) => calls.set(name, (calls.get(name) ?? 0) + 1);
  const idIn = (where: { id?: { in: number[] } | number }) =>
    typeof where.id === 'number' ? [where.id] : where.id?.in ?? [];

  const prisma = {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    appEvent: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        count('appEvent.create');
        if (data.dedupeKey && db.events.some((e) => e.dedupeKey === data.dedupeKey)) {
          throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
        }
        db.events.push(data);
        return data;
      }),
      createManyAndReturn: vi.fn(async ({ data }: { data: Row[] }) => {
        count('appEvent.createManyAndReturn');
        const inserted: Row[] = [];
        for (const row of data) {
          if (db.events.some((e) => e.dedupeKey === row.dedupeKey)) continue;
          db.events.push(row);
          inserted.push({ dedupeKey: row.dedupeKey, occurredAt: row.occurredAt });
        }
        return inserted;
      }),
    },
    contact: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: number[] } } }) => {
        count('contact.findMany');
        return where.id.in.filter((id) => db.contacts.has(id)).map((id) => ({ id }));
      }),
      update: vi.fn(async ({ where, data }: { where: { id: number }; data: { lastActivityAt?: Date } }) => {
        count('contact.update');
        const c = db.contacts.get(where.id);
        if (c && data.lastActivityAt) c.lastActivityAt = data.lastActivityAt;
        return c;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: { in: number[] } }; data: { lastActivityAt?: Date } }) => {
        count('contact.updateMany');
        for (const id of idIn(where)) {
          const c = db.contacts.get(id);
          if (c && data.lastActivityAt) c.lastActivityAt = data.lastActivityAt;
        }
        return { count: 0 };
      }),
      create: vi.fn(),
    },
    contactActivity: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        count('contactActivity.create');
        db.activities.push(data);
        return data;
      }),
      createMany: vi.fn(async ({ data }: { data: Row[] }) => {
        count('contactActivity.createMany');
        db.activities.push(...data);
        return { count: data.length };
      }),
    },
    visitor: { update: vi.fn() },
    contactList: { findUnique: vi.fn(async () => ({ id: 3, name: 'Høst' })) },
    contactListMembership: {
      findMany: vi.fn(async ({ where }: { where: { listId: number; contactId: { in: number[] } } }) => {
        count('contactListMembership.findMany');
        const ids = new Set(where.contactId.in);
        return db.memberships.filter((m) => m.listId === where.listId && ids.has(m.contactId)).map((m) => ({ id: m.contactId, ...m }));
      }),
      createMany: vi.fn(async ({ data }: { data: { listId: number; contactId: number }[] }) => {
        count('contactListMembership.createMany');
        const addedAt = new Date('2026-10-01T12:00:00Z');
        for (const row of data) {
          if (!db.memberships.some((m) => m.listId === row.listId && m.contactId === row.contactId)) {
            db.memberships.push({ ...row, addedAt });
          }
        }
        return { count: data.length };
      }),
      deleteMany: vi.fn(async ({ where }: { where: { id: { in: number[] } } }) => {
        count('contactListMembership.deleteMany');
        const ids = new Set(where.id.in);
        db.memberships = db.memberships.filter((m) => !ids.has(m.contactId));
        return { count: ids.size };
      }),
    },
    flowTrigger: {
      findMany: vi.fn(async () => {
        count('flowTrigger.findMany');
        return db.triggers;
      }),
    },
    flowEnrollment: {
      findFirst: vi.fn(async ({ where }: { where: { flowId: number; contactId: number; status: string } }) => {
        count('flowEnrollment.findFirst');
        return db.enrollments.find((e) => e.flowId === where.flowId && e.contactId === where.contactId && e.status === where.status) ?? null;
      }),
      findMany: vi.fn(async ({ where }: { where: { flowId: number; status: string; contactId: { in: number[] } } }) => {
        count('flowEnrollment.findMany');
        const ids = new Set(where.contactId.in);
        return db.enrollments.filter((e) => e.flowId === where.flowId && e.status === where.status && ids.has(e.contactId));
      }),
      create: vi.fn(async ({ data }: { data: { flowId: number; contactId: number; status: string } }) => {
        count('flowEnrollment.create');
        db.enrollments.push(data);
        return data;
      }),
      createMany: vi.fn(async ({ data }: { data: { flowId: number; contactId: number; status: string }[] }) => {
        count('flowEnrollment.createMany');
        for (const row of data) {
          const clash = db.enrollments.some((e) => e.flowId === row.flowId && e.contactId === row.contactId && e.status === 'active');
          if (!clash) db.enrollments.push(row);
        }
        return { count: data.length };
      }),
    },
    note: { findFirst: vi.fn(async () => null), create: vi.fn() },
    consent: { upsert: vi.fn() },
  };
  return { db, prisma, calls };
});

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { BULK_EVENT_CHUNK, emitEvent, emitEvents } from '@/lib/events/bus';
import { addContactsToList, removeContactsFromList } from '@/lib/crm/list-membership';
import { contactMatchesSegment, type SegmentRules } from '@/lib/crm/segments';
import { executeImport } from '@/lib/crm/import/execute';
import { planImport, resolveActions, type PlanContext } from '@/lib/crm/import/plan';
import { DEFAULT_APPLY_OPTIONS } from '@/lib/crm/import/types';

const OLD = new Date('2025-01-15T10:00:00Z');
const SOVENDE: SegmentRules = { all: [{ field: 'lastActivityAt', op: 'lt', value: '2026-01-01' }] };

function seedContacts(n: number) {
  for (let id = 1; id <= n; id++) db.contacts.set(id, { id, lastActivityAt: OLD });
}

function isSovende(id: number): boolean {
  const c = db.contacts.get(id)!;
  return contactMatchesSegment(
    { stage: 'lead', source: 'import', email: null, organizationId: null, lastActivityAt: c.lastActivityAt, tags: [], deals: [] },
    SOVENDE,
  );
}

function listTrigger(flowId: number) {
  db.triggers.push({ flowId, eventType: 'list.member_added', filter: '{"listId":3}', flow: { anchorMode: 'contact' } });
}

const total = () => [...calls.values()].reduce((a, b) => a + b, 0);

beforeEach(() => {
  vi.clearAllMocks();
  calls.clear();
  db.contacts.clear();
  db.events = [];
  db.activities = [];
  db.memberships = [];
  db.enrollments = [];
  db.triggers = [];
});

describe('emitEvent – touchActivity', () => {
  it('flytter «Sist aktiv» som standard', async () => {
    seedContacts(1);
    const at = new Date('2026-10-01T09:00:00Z');
    expect(await emitEvent({ type: 'email.opened', source: 'server', contactId: 1, occurredAt: at })).toBe(true);
    expect(db.contacts.get(1)!.lastActivityAt).toEqual(at);
  });

  it('touchActivity: false lar «Sist aktiv» stå, men lagrer hendelsen og starter flyter', async () => {
    seedContacts(1);
    db.triggers.push({ flowId: 7, eventType: 'consent.updated', filter: '', flow: { anchorMode: 'contact' } });
    await emitEvent({ type: 'consent.updated', source: 'server', contactId: 1, touchActivity: false });
    expect(db.contacts.get(1)!.lastActivityAt).toEqual(OLD);
    expect(db.events).toHaveLength(1);
    expect(db.enrollments).toEqual([expect.objectContaining({ flowId: 7, contactId: 1 })]);
  });
});

describe('emitEvents (bulk)', () => {
  it('dedup: hendelser som finnes fra før gir ingen bivirkninger og returneres ikke', async () => {
    seedContacts(2);
    listTrigger(9);
    db.events.push({ dedupeKey: 'k1' });
    const meta = { listId: 3 };
    const inserted = await emitEvents([
      { type: 'list.member_added', source: 'server', contactId: 1, dedupeKey: 'k1', meta },
      { type: 'list.member_added', source: 'server', contactId: 2, dedupeKey: 'k2', meta },
      { type: 'list.member_added', source: 'server', contactId: 2, dedupeKey: 'k2', meta },
    ]);
    expect(inserted.map((e) => e.dedupeKey)).toEqual(['k2']);
    expect(db.enrollments).toEqual([expect.objectContaining({ flowId: 9, contactId: 2 })]);
  });

  it('avviser ukjente typer og respekterer suppressFlows', async () => {
    seedContacts(1);
    db.triggers.push({ flowId: 4, eventType: 'consent.updated', filter: '', flow: { anchorMode: 'contact' } });
    const inserted = await emitEvents([
      { type: 'finnes.ikke', source: 'server', contactId: 1, dedupeKey: 'x' },
      { type: 'consent.updated', source: 'server', contactId: 1, dedupeKey: 'y', meta: { suppressFlows: true } },
    ]);
    expect(inserted).toHaveLength(1);
    expect(db.enrollments).toEqual([]);
  });

  it('skriver tidslinje og «Sist aktiv» i bulk når hendelsen er kontaktens egen', async () => {
    seedContacts(2);
    const at = new Date('2026-10-01T09:00:00Z');
    await emitEvents([1, 2].map((contactId) => ({
      type: 'email.opened', source: 'server' as const, contactId, dedupeKey: `o${contactId}`, occurredAt: at,
    })));
    expect(db.contacts.get(1)!.lastActivityAt).toEqual(at);
    expect(calls.get('contact.updateMany')).toBe(1);
    expect(calls.get('contactActivity.createMany')).toBe(1);
    expect(db.activities).toHaveLength(2);
  });
});

describe('addContactsToList i bulk (5 000 kontakter)', () => {
  it('antall spørringer vokser med antall biter, ikke kontakter — og innmeldingen er like riktig', async () => {
    const N = 5000;
    seedContacts(N);
    listTrigger(1);
    listTrigger(2);
    db.triggers.push({ flowId: 3, eventType: 'list.member_added', filter: '{"listId":99}', flow: { anchorMode: 'contact' } });
    db.enrollments.push({ flowId: 1, contactId: 42, status: 'active' });

    const started = Date.now();
    const result = await addContactsToList(3, Array.from({ length: N }, (_, i) => i + 1), { source: 'import', actorEmail: 'a@x.no' });
    const elapsed = Date.now() - started;

    const chunks = Math.ceil(N / BULK_EVENT_CHUNK);
    expect(result).toMatchObject({ added: N, alreadyMember: 0, missing: 0 });
    expect(calls.get('flowTrigger.findMany')).toBe(1);
    expect(calls.get('appEvent.createManyAndReturn')).toBe(chunks);
    expect(calls.get('flowEnrollment.findMany')).toBe(chunks * 2);
    expect(calls.get('flowEnrollment.createMany')).toBe(chunks * 2);
    expect(calls.get('contactActivity.createMany')).toBe(chunks);
    expect(calls.get('appEvent.create')).toBeUndefined();
    expect(calls.get('flowEnrollment.create')).toBeUndefined();
    expect(total()).toBeLessThanOrEqual(5 + chunks * 6);
    expect(elapsed).toBeLessThan(5000);

    const perFlow = (flowId: number) => db.enrollments.filter((e) => e.flowId === flowId && e.contactId === 42).length;
    expect(db.enrollments.filter((e) => e.flowId === 1)).toHaveLength(N);
    expect(db.enrollments.filter((e) => e.flowId === 2)).toHaveLength(N);
    expect(db.enrollments.filter((e) => e.flowId === 3)).toHaveLength(0);
    expect(perFlow(1)).toBe(1);
    expect(db.activities.filter((a) => a.type === 'list')).toHaveLength(N);
  });

  it('ny kjøring av samme innmelding gir ingen nye hendelser, tidslinjer eller innmeldinger', async () => {
    seedContacts(3);
    listTrigger(1);
    await addContactsToList(3, [1, 2, 3], { source: 'manual' });
    const before = { events: db.events.length, activities: db.activities.length, enrollments: db.enrollments.length };
    await addContactsToList(3, [1, 2, 3], { source: 'manual' });
    expect({ events: db.events.length, activities: db.activities.length, enrollments: db.enrollments.length }).toEqual(before);
  });
});

describe('«Sovende»-segment (Sist aktiv) påvirkes ikke av listeendringer eller import', () => {
  it('innmelding og utmelding av liste flytter ikke kontakter ut av «sovende»', async () => {
    seedContacts(3);
    listTrigger(1);
    expect([1, 2, 3].every(isSovende)).toBe(true);

    await addContactsToList(3, [1, 2, 3], { source: 'manual' });
    await removeContactsFromList(3, [1], { source: 'manual' });

    expect([1, 2, 3].every(isSovende)).toBe(true);
    expect(calls.get('contact.update')).toBeUndefined();
    expect(calls.get('contact.updateMany')).toBeUndefined();
  });

  it('import som oppdaterer en kontakt og registrerer samtykke flytter den ikke ut av «sovende»', async () => {
    seedContacts(1);
    const context: PlanContext = {
      contacts: [{
        id: 1, name: 'Kari', email: 'kari@x.no', phone: null, roleTitle: null, organizationId: null, ownerId: null,
        stage: 'lead', tags: [], customFields: {}, marketingConsent: false, consentWithdrawn: false,
      }],
      organizations: [],
      suppressedEmails: new Set(),
    };
    const options = { ...DEFAULT_APPLY_OPTIONS, confirmConsent: true };
    const plan = planImport(
      { headers: ['Navn', 'E-post', 'Telefon', 'Samtykke'], rows: [['Kari', 'kari@x.no', '91234567', 'ja']], columns: ['name', 'email', 'phone', 'consent'], options },
      context,
    );
    const result = await executeImport({
      plan, actions: resolveActions(plan, []), context, options, fileName: 'f.csv', actorEmail: 'a@x.no',
    });

    expect(result.updated).toBe(1);
    expect(prisma.consent.upsert).toHaveBeenCalled();
    expect(db.events).toEqual([expect.objectContaining({ type: 'consent.updated', contactId: 1 })]);
    expect(isSovende(1)).toBe(true);
  });
});
