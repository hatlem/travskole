import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { logCrmChanges } from '@/lib/crm/change-log';
import { normalizeEmail, parseJsonArray } from '@/lib/crm/normalize';
import { INVALID_ASSIGNEE_ERROR, isAssignableUser } from '@/lib/crm/assignees';
import { purgeReviewDraftsForContact } from '@/lib/ai/review';
import { suggestOrganization, suggestionDomain } from '@/lib/crm/org-suggestion';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const contactId = Number(id);
  if (!Number.isInteger(contactId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: {
      organization: { select: { id: true, name: true } },
      owner: { select: { id: true, email: true } },
      consent: true,
      deals: {
        orderBy: { createdAt: 'desc' },
        include: { stage: { select: { name: true } }, pipeline: { select: { name: true } } },
      },
      tasks: { orderBy: [{ status: 'asc' }, { dueAt: 'asc' }] },
      notes: { orderBy: { createdAt: 'desc' } },
      activities: { orderBy: { occurredAt: 'desc' }, take: 100 },
      memberships: {
        orderBy: { addedAt: 'desc' },
        select: { addedAt: true, list: { select: { id: true, name: true } } },
      },
      flowEnrollments: {
        where: { status: 'active' },
        orderBy: { enteredAt: 'desc' },
        select: { id: true, enteredAt: true, flow: { select: { id: true, name: true, status: true } } },
      },
    },
  });
  if (!contact) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }

  // Ikke-kontakt-listen er global og nøkles på normalisert e-post.
  const suppression = contact.email
    ? await prisma.suppression.findUnique({
        where: { email: contact.email },
        select: { reason: true, createdAt: true },
      })
    : null;

  const domain = suggestionDomain(contact.email, contact.organizationId !== null);
  const orgWithDomain = domain
    ? await prisma.organization.findFirst({ where: { domain }, select: { id: true, name: true } })
    : null;
  const organizationSuggestion = suggestOrganization(contact.email, contact.organizationId !== null, orgWithDomain);

  const { memberships, flowEnrollments, ...rest } = contact;
  const lists = memberships.map((m) => ({ id: m.list.id, name: m.list.name, addedAt: m.addedAt }));
  const flows = flowEnrollments.map((e) => ({
    enrollmentId: e.id, flowId: e.flow.id, name: e.flow.name, flowStatus: e.flow.status, enteredAt: e.enteredAt,
  }));
  return NextResponse.json({
    contact: { ...rest, tags: parseJsonArray(contact.tags), suppression, lists, flows, organizationSuggestion },
  });
}

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().trim().email('Ugyldig e-postadresse').nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  organizationId: z.number().int().positive().nullable().optional(),
  ownerId: z.number().int().positive().nullable().optional(),
  stage: z.enum(['lead', 'active', 'customer', 'dormant', 'lost']).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  roleTitle: z.string().max(100).nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const contactId = Number(id);
  if (!Number.isInteger(contactId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;

  if (!(await isAssignableUser(data.ownerId))) {
    return NextResponse.json({ error: INVALID_ASSIGNEE_ERROR }, { status: 400 });
  }

  const email = data.email !== undefined ? normalizeEmail(data.email) : undefined;
  if (email) {
    const existing = await prisma.contact.findUnique({ where: { email } });
    if (existing && existing.id !== contactId) {
      return NextResponse.json({ error: 'En annen kontakt har denne e-posten' }, { status: 409 });
    }
  }

  const tracksChanges = data.stage !== undefined || data.ownerId !== undefined;
  const before = tracksChanges
    ? await prisma.contact.findUnique({ where: { id: contactId }, select: { stage: true, ownerId: true } })
    : null;

  try {
    const contact = await prisma.contact.update({
      where: { id: contactId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(email !== undefined && { email }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.organizationId !== undefined && { organizationId: data.organizationId }),
        ...(data.ownerId !== undefined && { ownerId: data.ownerId }),
        ...(data.stage !== undefined && { stage: data.stage }),
        ...(data.tags !== undefined && { tags: JSON.stringify(data.tags) }),
        ...(data.roleTitle !== undefined && { roleTitle: data.roleTitle }),
      },
    });

    if (before) {
      await logCrmChanges({ contactId: contact.id, organizationId: null }, before, data, session.user.email).catch(() => {});
    }

    logActivity({ action: 'update', entity: 'contact', entityId: contact.id, userEmail: session.user.email }).catch(() => {});
    return NextResponse.json({ contact });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2025' || error.code === 'P2003')) {
      return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'En annen kontakt har denne e-posten' }, { status: 409 });
    }
    throw error;
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const contactId = Number(id);
  if (!Number.isInteger(contactId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  try {
    // Før sletting: enrollments (og dermed koblingen til utkastene) forsvinner med kontakten.
    await purgeReviewDraftsForContact(contactId);
    await prisma.contact.delete({ where: { id: contactId } });
    logActivity({ action: 'delete', entity: 'contact', entityId: contactId, userEmail: session.user.email }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2025' || error.code === 'P2003')) {
      return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
    }
    throw error;
  }
}
