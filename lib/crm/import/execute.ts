// Kjører en ferdig løst importplan mot databasen i batcher (én transaksjon
// per batch). Feiler en batch, prøves radene én og én så én dårlig rad
// ikke stopper resten. Samme fil to ganger gir oppdateringer, ikke kopier.

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { emitEvent } from '@/lib/events/bus';
import logger from '@/lib/logger';
import { buildContactCreate, buildContactUpdate, type ContactPatch, type PlanContext } from '@/lib/crm/import/plan';
import type { ApplyOptions, ImportPlan, ImportProblem, ImportResult, OrgRef, RowAction } from '@/lib/crm/import/types';

export const IMPORT_BATCH_SIZE = 100;

export interface ExecuteImportInput {
  plan: ImportPlan;
  actions: RowAction[];
  context: PlanContext;
  options: ApplyOptions;
  fileName: string;
  actorEmail: string;
  now?: Date;
}

type Outcome = 'created' | 'updated' | 'unchanged';
type WriteAction = Exclude<RowAction, { kind: 'skip' }>;

interface RowOutcome {
  contactId: number;
  outcome: Outcome;
  consentGranted: boolean;
}

export async function executeImport(input: ExecuteImportInput): Promise<ImportResult> {
  const now = input.now ?? new Date();
  const result: ImportResult = {
    created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0, organizationsCreated: 0, contactIds: [], problems: [],
  };
  const writes: WriteAction[] = [];
  for (const action of input.actions) {
    if (action.kind === 'skip') {
      result.skipped++;
      result.problems.push({ row: action.row, reason: action.reason });
    } else {
      writes.push(action);
    }
  }

  const orgIds = await createOrganizations(input.plan, writes, result);
  const existingById = new Map(input.context.contacts.map((c) => [c.id, c]));
  const consentGranted: number[] = [];

  const apply = async (tx: Prisma.TransactionClient, action: WriteAction): Promise<RowOutcome> => {
    const values = action.planned.values!;
    const organizationId = resolveOrgId(action.planned.organization, orgIds);
    let contactId: number;
    let outcome: Outcome;
    let changes: string[] = [];

    if (action.kind === 'create') {
      const data = buildContactCreate(values, input.options);
      const contact = await tx.contact.create({
        data: {
          ...data,
          tags: JSON.stringify(data.tags),
          customFields: JSON.stringify(data.customFields),
          organizationId,
          source: 'import',
          lastActivityAt: now,
        },
        select: { id: true },
      });
      contactId = contact.id;
      outcome = 'created';
    } else {
      contactId = action.contactId;
      const existing = existingById.get(contactId);
      if (!existing) throw new ImportRowError('Kontakten finnes ikke lenger');
      const orgTarget = organizationId === null ? null : { kind: 'existing' as const, id: organizationId };
      const update = buildContactUpdate(existing, values, orgTarget, input.options);
      changes = update.changes;
      if (changes.length > 0) {
        await tx.contact.update({ where: { id: contactId }, data: { ...patchToData(update.patch, organizationId), lastActivityAt: now } });
      }
      outcome = changes.length > 0 ? 'updated' : 'unchanged';
    }

    if (values.note) {
      const duplicate = await tx.note.findFirst({ where: { contactId, body: values.note }, select: { id: true } });
      if (!duplicate) {
        await tx.note.create({ data: { contactId, body: values.note, authorEmail: input.actorEmail } });
        if (outcome === 'unchanged') { outcome = 'updated'; changes = [...changes, 'notat']; }
      }
    }

    const grant = action.planned.consent === 'grant';
    if (grant) {
      const data = { marketing: true, lawfulBasis: 'consent', consentAt: now, source: 'import' };
      await tx.consent.upsert({ where: { contactId }, create: { contactId, ...data }, update: data });
      if (outcome === 'unchanged') { outcome = 'updated'; changes = [...changes, 'samtykke']; }
    }

    if (outcome !== 'unchanged') {
      await tx.contactActivity.create({
        data: {
          contactId,
          type: 'import',
          title: `Importert fra CSV (${input.fileName})`,
          body: outcome === 'updated' ? `Oppdatert: ${changes.join(', ')}` : null,
          meta: JSON.stringify({ fileName: input.fileName, row: action.row, outcome }),
          actorEmail: input.actorEmail,
          occurredAt: now,
        },
      });
    }
    return { contactId, outcome, consentGranted: grant };
  };

  const record = (outcomes: RowOutcome[]) => {
    for (const o of outcomes) {
      result[o.outcome]++;
      result.contactIds.push(o.contactId);
      if (o.consentGranted) consentGranted.push(o.contactId);
    }
  };

  for (let start = 0; start < writes.length; start += IMPORT_BATCH_SIZE) {
    const batch = writes.slice(start, start + IMPORT_BATCH_SIZE);
    try {
      const outcomes = await prisma.$transaction(
        async (tx) => {
          const done: RowOutcome[] = [];
          for (const action of batch) done.push(await apply(tx, action));
          return done;
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
      record(outcomes);
    } catch {
      for (const action of batch) {
        try {
          record([await prisma.$transaction((tx) => apply(tx, action), { timeout: 15_000 })]);
        } catch (error) {
          result.failed++;
          result.problems.push({ row: action.row, reason: friendlyError(error, action.row) });
        }
      }
    }
  }

  for (const contactId of consentGranted) {
    await emitEvent({
      type: 'consent.updated',
      source: 'server',
      contactId,
      meta: { marketing: true, lawfulBasis: 'consent', kilde: 'import' },
    });
  }

  result.problems.sort((a: ImportProblem, b: ImportProblem) => a.row - b.row);
  return result;
}

async function createOrganizations(plan: ImportPlan, writes: WriteAction[], result: ImportResult): Promise<Map<string, number>> {
  const needed = new Set(
    writes.flatMap((w) => (w.planned.organization?.kind === 'new' ? [w.planned.organization.key] : [])),
  );
  const ids = new Map<string, number>();
  for (const org of plan.newOrganizations) {
    if (!needed.has(org.key)) continue;
    try {
      const created = await prisma.organization.create({
        data: { name: org.name, orgNumber: org.orgNumber, domain: org.domain, stage: 'lead' },
        select: { id: true },
      });
      ids.set(org.key, created.id);
      result.organizationsCreated++;
    } catch (error) {
      // Domenet ble tatt i mellomtiden — bruk bedriften som har det.
      const existing =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && org.domain
          ? await prisma.organization.findFirst({ where: { domain: org.domain }, select: { id: true } })
          : null;
      if (!existing) throw error;
      ids.set(org.key, existing.id);
    }
  }
  return ids;
}

function resolveOrgId(ref: OrgRef | null, created: Map<string, number>): number | null {
  if (!ref) return null;
  return ref.kind === 'existing' ? ref.id : created.get(ref.key) ?? null;
}

function patchToData(patch: ContactPatch, organizationId: number | null): Prisma.ContactUncheckedUpdateInput {
  return {
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.email !== undefined && { email: patch.email }),
    ...(patch.phone !== undefined && { phone: patch.phone }),
    ...(patch.roleTitle !== undefined && { roleTitle: patch.roleTitle }),
    ...(patch.organization !== undefined && organizationId !== null && { organizationId }),
    ...(patch.ownerId !== undefined && { ownerId: patch.ownerId }),
    ...(patch.stage !== undefined && { stage: patch.stage }),
    ...(patch.tags !== undefined && { tags: JSON.stringify(patch.tags) }),
    ...(patch.customFields !== undefined && { customFields: JSON.stringify(patch.customFields) }),
  };
}

class ImportRowError extends Error {}

function friendlyError(error: unknown, row: number): string {
  if (error instanceof ImportRowError) return error.message;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return 'E-postadressen brukes allerede av en annen kontakt';
    if (error.code === 'P2025') return 'Kontakten finnes ikke lenger';
  }
  logger.error('Kontaktimport: rad feilet', { row, error: error instanceof Error ? error.message : String(error) });
  return 'Noe gikk galt med denne raden – prøv igjen senere';
}
