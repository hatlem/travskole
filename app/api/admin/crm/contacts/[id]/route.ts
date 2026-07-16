import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { normalizeEmail, parseJsonArray } from '@/lib/crm/normalize';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const contact = await prisma.contact.findUnique({
    where: { id: Number(id) },
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
    },
  });
  if (!contact) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }

  return NextResponse.json({ contact: { ...contact, tags: parseJsonArray(contact.tags) } });
}

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().nullable().optional(),
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

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;

  const email = data.email !== undefined ? normalizeEmail(data.email) : undefined;
  if (email) {
    const existing = await prisma.contact.findUnique({ where: { email } });
    if (existing && existing.id !== Number(id)) {
      return NextResponse.json({ error: 'En annen kontakt har denne e-posten' }, { status: 409 });
    }
  }

  const contact = await prisma.contact.update({
    where: { id: Number(id) },
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

  logActivity({ action: 'update', entity: 'contact', entityId: contact.id, userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ contact });
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

  await prisma.contact.delete({ where: { id: Number(id) } });
  logActivity({ action: 'delete', entity: 'contact', entityId: Number(id), userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ ok: true });
}
