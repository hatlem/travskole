/**
 * Innsetting av standardmaler og import av de gamle kursmalene som flyter med
 * status `template`. Idempotent på navn blant maler; en advisory-lås i
 * transaksjonen hindrer duplikater ved dobbeltklikk.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { writeFlowCopy, type FlowCopy } from '../clone';
import { buildTemplateCopy, validateFlowCopy, type FlowTemplate, type TemplateContext } from './builder';
import { STANDARD_TEMPLATES } from './library';
import {
  LEGACY_FLOW_NAME,
  buildLegacyLifecycleTemplate,
  mapLegacyToLifecycle,
  normalizeLegacyTemplates,
  normalizeLegacyTriggers,
  type LegacyMapping,
} from './legacy';

type Db = Pick<PrismaClient, 'flow' | 'senderIdentity' | '$transaction' | '$queryRaw' | '$queryRawUnsafe'>;
type Tx = Pick<Prisma.TransactionClient, 'flow' | 'flowNode' | 'flowEdge' | 'flowTrigger' | '$executeRaw'>;

const TEMPLATE_INSTALL_LOCK = 7_412_001;

export class TemplateInstallError extends Error {}

export async function resolveSender(
  db: Pick<Db, 'senderIdentity'>,
  requestedId?: number,
): Promise<{ id: number; displayName: string }> {
  const sender = await db.senderIdentity.findFirst({
    where: { active: true, ...(requestedId !== undefined && { id: requestedId }) },
    orderBy: { id: 'asc' },
    select: { id: true, displayName: true },
  });
  if (!sender) {
    throw new TemplateInstallError(
      requestedId !== undefined
        ? 'Avsenderen finnes ikke eller er deaktivert.'
        : 'Ingen aktiv avsender er satt opp. Legg til en avsender under CRM-innstillingene først.',
    );
  }
  return sender;
}

/** Hvilke maler som mangler, gitt navnene på eksisterende maler. */
export function planTemplateInstall<T extends { name: string }>(
  templates: readonly T[],
  existingNames: Iterable<string>,
): { toCreate: T[]; skipped: string[] } {
  const existing = new Set(existingNames);
  const toCreate: T[] = [];
  const skipped: string[] = [];
  for (const template of templates) {
    if (existing.has(template.name)) {
      skipped.push(template.name);
    } else {
      existing.add(template.name);
      toCreate.push(template);
    }
  }
  return { toCreate, skipped };
}

function assertValid(copy: FlowCopy): void {
  const errors = validateFlowCopy(copy);
  if (errors.length > 0) {
    throw new Error(`Malen «${copy.flow.name}» er ugyldig: ${errors.map((e) => e.message).join(' ')}`);
  }
}

async function existingTemplateNames(tx: Pick<Tx, 'flow'>, names: string[]): Promise<string[]> {
  const rows = await tx.flow.findMany({ where: { status: 'template', name: { in: names } }, select: { name: true } });
  return rows.map((r) => r.name);
}

async function findTemplateId(db: Pick<Tx, 'flow'>, name: string): Promise<number | null> {
  const row = await db.flow.findFirst({ where: { status: 'template', name }, select: { id: true } });
  return row?.id ?? null;
}

export interface InstallResult {
  created: { id: number; name: string }[];
  skipped: string[];
}

export async function installStandardTemplates(
  db: Db,
  opts: { senderIdentityId?: number; siteUrl: string },
  templates: readonly FlowTemplate[] = STANDARD_TEMPLATES,
): Promise<InstallResult> {
  const sender = await resolveSender(db, opts.senderIdentityId);
  const ctx: TemplateContext = { senderIdentityId: sender.id, senderName: sender.displayName, siteUrl: opts.siteUrl };
  const copies = templates.map((template) => buildTemplateCopy(template, ctx));
  copies.forEach(assertValid);

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TEMPLATE_INSTALL_LOCK})`;
    const existing = await existingTemplateNames(tx, copies.map((c) => c.flow.name));
    const { toCreate, skipped } = planTemplateInstall(copies.map((c) => ({ name: c.flow.name, copy: c })), existing);
    const created: InstallResult['created'] = [];
    for (const { name, copy } of toCreate) {
      created.push({ id: await writeFlowCopy(tx, copy), name });
    }
    return { created, skipped };
  });
}

type LegacyTable = 'email_templates' | 'email_triggers';

/** Leser hele legacy-tabellen, eller null hvis den ikke finnes. Kolonnene oppdages via information_schema. */
export async function readLegacyTable(
  db: Pick<Db, '$queryRaw' | '$queryRawUnsafe'>,
  table: LegacyTable,
): Promise<Record<string, unknown>[] | null> {
  const columns = await db.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = ${table}`;
  if (columns.length === 0) return null;
  const hasId = columns.some((c) => c.column_name === 'id');
  return db.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "${table}"${hasId ? ' ORDER BY id' : ''}`);
}

export type LegacyImportResult =
  | { status: 'exists'; flowId: number }
  | { status: 'missing_table' }
  | { status: 'empty' }
  | {
      status: 'created';
      flowId: number;
      name: string;
      matched: { slot: string; templateName: string; via: string }[];
      unmatched: { name: string; subject: string; reason: string }[];
    };

export async function importLegacyCourseTemplates(
  db: Db,
  opts: { senderIdentityId?: number; siteUrl: string },
): Promise<LegacyImportResult> {
  const existingId = await findTemplateId(db, LEGACY_FLOW_NAME);
  if (existingId !== null) return { status: 'exists', flowId: existingId };

  const templateRows = await readLegacyTable(db, 'email_templates');
  if (templateRows === null) return { status: 'missing_table' };
  const templates = normalizeLegacyTemplates(templateRows);
  if (templates.length === 0) return { status: 'empty' };
  const triggers = normalizeLegacyTriggers((await readLegacyTable(db, 'email_triggers')) ?? []);

  const mapping: LegacyMapping = mapLegacyToLifecycle(templates, triggers);
  const sender = await resolveSender(db, opts.senderIdentityId);
  const copy = buildTemplateCopy(buildLegacyLifecycleTemplate(mapping), {
    senderIdentityId: sender.id,
    senderName: sender.displayName,
    siteUrl: opts.siteUrl,
  });
  assertValid(copy);

  const outcome = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TEMPLATE_INSTALL_LOCK})`;
    const racedId = await findTemplateId(tx, LEGACY_FLOW_NAME);
    if (racedId !== null) return { created: false as const, flowId: racedId };
    return { created: true as const, flowId: await writeFlowCopy(tx, copy) };
  });
  if (!outcome.created) return { status: 'exists', flowId: outcome.flowId };
  const { flowId } = outcome;

  return {
    status: 'created',
    flowId,
    name: LEGACY_FLOW_NAME,
    matched: mapping.assignments.map((a) => ({ slot: a.slot, templateName: a.template.name, via: a.via })),
    unmatched: mapping.unmatched.map((u) => ({ name: u.template.name, subject: u.template.subject, reason: u.reason })),
  };
}
