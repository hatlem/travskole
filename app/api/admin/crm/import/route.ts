import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import logger from '@/lib/logger';
import { parseCsv } from '@/lib/crm/csv';
import { INVALID_ASSIGNEE_ERROR, isAssignableUser } from '@/lib/crm/assignees';
import { MAX_TAGS, MAX_TAG_LENGTH } from '@/lib/crm/form-utils';
import { repairMojibake } from '@/lib/crm/import/encoding';
import { columnProblems } from '@/lib/crm/import/columns';
import { loadPlanContext } from '@/lib/crm/import/context';
import { planImport, resolveActions } from '@/lib/crm/import/plan';
import { executeImport } from '@/lib/crm/import/execute';
import {
  CONTACT_STAGES, IMPORT_FIELDS, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, type ApplyOptions,
} from '@/lib/crm/import/types';

const columnTarget = z.enum([...IMPORT_FIELDS, 'ignore', 'custom']);

const importSchema = z.object({
  text: z.string().min(1, 'Fila er tom').max(MAX_IMPORT_BYTES, 'Fila er for stor (maks 5 MB)'),
  fileName: z.string().trim().max(200).default('import.csv'),
  columns: z.array(columnTarget).max(200),
  options: z.object({
    policy: z.enum(['fill_empty', 'overwrite']).default('fill_empty'),
    tags: z.array(z.string().trim().min(1).max(MAX_TAG_LENGTH)).max(MAX_TAGS).default([]),
    ownerId: z.number().int().positive().nullable().default(null),
    stage: z.enum(CONTACT_STAGES).nullable().default(null),
    list: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('existing'), id: z.number().int().positive() }),
        z.object({ kind: z.literal('new'), name: z.string().trim().min(1, 'Gi listen et navn').max(200) }),
      ])
      .nullable()
      .default(null),
  }),
  decisions: z
    .array(z.object({
      row: z.number().int().min(2),
      action: z.enum(['import', 'skip', 'merge', 'create']),
      contactId: z.number().int().positive().optional(),
    }))
    .max(MAX_IMPORT_ROWS)
    .default([]),
  dryRun: z.boolean(),
});

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ugyldig forespørsel' }, { status: 400 });
  }

  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const friendly = issue.path[0] === 'text' || issue.path.at(-1) === 'name';
    return NextResponse.json(
      { error: friendly ? issue.message : 'Noe stemmer ikke med importen. Last opp fila på nytt og prøv igjen.' },
      { status: 400 },
    );
  }
  const { text, fileName, columns, options, decisions, dryRun } = parsed.data;

  // Planen lages alltid på nytt her — klientens forhåndsvisning stoles aldri på.
  const { headers, rows } = parseCsv(repairMojibake(text).text);
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Fant ingen kontakter i fila. Første rad skal være kolonnenavn, og kontaktene på radene under.' }, { status: 400 });
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return NextResponse.json({
      error: `Fila har ${rows.length.toLocaleString('nb-NO')} rader. Maks ${MAX_IMPORT_ROWS.toLocaleString('nb-NO')} per import – del fila i flere.`,
    }, { status: 400 });
  }
  if (columns.length !== headers.length) {
    return NextResponse.json({ error: 'Kolonnene passer ikke med fila. Last opp fila på nytt.' }, { status: 400 });
  }
  const problems = columnProblems(columns);
  if (problems.length > 0) {
    return NextResponse.json({ error: problems[0] }, { status: 400 });
  }
  if (!(await isAssignableUser(options.ownerId))) {
    return NextResponse.json({ error: INVALID_ASSIGNEE_ERROR }, { status: 400 });
  }

  const applyOptions: ApplyOptions = {
    policy: options.policy, tags: options.tags, ownerId: options.ownerId, stage: options.stage,
  };
  const context = await loadPlanContext();
  const plan = planImport({ headers, rows, columns, options: applyOptions }, context);
  if (dryRun) {
    return NextResponse.json({ plan });
  }

  let list: { id: number; name: string } | null = null;
  if (options.list?.kind === 'existing') {
    list = await prisma.contactList.findUnique({ where: { id: options.list.id }, select: { id: true, name: true } });
    if (!list) {
      return NextResponse.json({ error: 'Listen finnes ikke lenger. Velg en annen liste.' }, { status: 404 });
    }
  } else if (options.list?.kind === 'new') {
    list = await findOrCreateList(options.list.name);
  }

  try {
    const result = await executeImport({
      plan,
      actions: resolveActions(plan, decisions),
      context,
      options: applyOptions,
      fileName: fileName || 'import.csv',
      actorEmail: session.user.email,
    });

    if (list) await addImportedToList(list.id, result.contactIds);

    logActivity({
      action: 'create', entity: 'contact_import',
      details: JSON.stringify({
        fileName, created: result.created, updated: result.updated, unchanged: result.unchanged,
        skipped: result.skipped, failed: result.failed, listId: list?.id ?? null,
      }),
      userEmail: session.user.email,
    }).catch(() => {});

    return NextResponse.json({ result, list });
  } catch (error) {
    logger.error('Kontaktimport feilet', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: 'Importen stoppet underveis. Kontakter som allerede er lagret blir gjenkjent hvis du prøver igjen.' },
      { status: 500 },
    );
  }
}

/** Samme listenavn gjenbrukes, så en ny kjøring av samme import ikke lager en ny liste. */
async function findOrCreateList(name: string): Promise<{ id: number; name: string }> {
  const existing = await prisma.contactList.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    orderBy: { id: 'asc' },
    select: { id: true, name: true },
  });
  return existing ?? prisma.contactList.create({ data: { name }, select: { id: true, name: true } });
}

async function addImportedToList(listId: number, contactIds: number[]): Promise<void> {
  if (contactIds.length === 0) return;
  await prisma.contactListMembership.createMany({
    data: contactIds.map((contactId) => ({ listId, contactId })),
    skipDuplicates: true,
  });
}
