import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { parseCsv } from '@/lib/crm/csv';
import { planImport, type ImportRow } from '@/lib/crm/import';

const importSchema = z.object({
  csv: z.string().min(1, 'CSV-innhold mangler').max(5_000_000),
  mapping: z.object({
    name: z.number().int().nullable(),
    email: z.number().int().nullable(),
    phone: z.number().int().nullable(),
    organization: z.number().int().nullable(),
  }),
  listId: z.number().int().positive().nullable().optional(),
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
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }

  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { csv, mapping, listId, dryRun } = parsed.data;

  const { rows } = parseCsv(csv);
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Fant ingen rader i CSV-en' }, { status: 400 });
  }
  if (rows.length > 10000) {
    return NextResponse.json({ error: 'Maks 10 000 rader per import' }, { status: 400 });
  }

  const existing = await prisma.contact.findMany({
    where: { email: { not: null } },
    select: { email: true },
  });
  const existingEmails = new Set(existing.map((c) => c.email!));

  const plan = planImport(rows, mapping, existingEmails);
  if (dryRun) {
    return NextResponse.json({ plan });
  }

  if (listId) {
    const list = await prisma.contactList.findUnique({
      where: { id: listId },
    });
    if (!list) {
      return NextResponse.json({ error: 'Listen finnes ikke' }, { status: 404 });
    }
  }

  const touchedIds: number[] = [];

  async function orgIdFor(row: ImportRow): Promise<number | null> {
    if (!row.organizationName) return null;
    const found = await prisma.organization.findFirst({
      where: { name: { equals: row.organizationName, mode: 'insensitive' } },
    });
    if (found) return found.id;
    const created = await prisma.organization.create({
      data: { name: row.organizationName, stage: 'lead' },
    });
    return created.id;
  }

  try {
    for (const row of plan.create) {
      const contact = await prisma.contact.create({
        data: {
          name: row.name, email: row.email, phone: row.phone,
          organizationId: await orgIdFor(row), source: 'import',
        },
      });
      touchedIds.push(contact.id);
      await prisma.contactActivity.create({
        data: { contactId: contact.id, type: 'import', title: 'Importert fra CSV', actorEmail: session.user.email },
      });
    }

    for (const row of plan.update) {
      const contact = await prisma.contact.update({
        where: { email: row.email! },
        data: {
          name: row.name,
          ...(row.phone && { phone: row.phone }),
        },
      });
      touchedIds.push(contact.id);
      await prisma.contactActivity.create({
        data: { contactId: contact.id, type: 'import', title: 'Oppdatert via import', actorEmail: session.user.email },
      });
    }

    if (listId && touchedIds.length > 0) {
      await prisma.contactListMembership.createMany({
        data: touchedIds.map((contactId) => ({ listId, contactId })),
        skipDuplicates: true,
      });
    }
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2025' || error.code === 'P2003')
    ) {
      return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return NextResponse.json({ error: 'Duplikat: raden finnes allerede' }, { status: 409 });
    }
    throw error;
  }

  logActivity({
    action: 'create', entity: 'contact_import',
    details: JSON.stringify({ created: plan.create.length, updated: plan.update.length, skipped: plan.skip.length }),
    userEmail: session.user.email,
  }).catch(() => {});

  return NextResponse.json({
    created: plan.create.length,
    updated: plan.update.length,
    skipped: plan.skip.length,
  });
}
