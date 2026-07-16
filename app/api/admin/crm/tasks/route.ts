import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

export async function GET(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const status = sp.get('status') ?? '';
  const assigneeId = Number(sp.get('assigneeId')) || null;

  const tasks = await prisma.task.findMany({
    where: {
      ...(status && { status }),
      ...(assigneeId && { assigneeId }),
    },
    orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { id: 'desc' }],
    select: {
      id: true,
      title: true,
      dueAt: true,
      status: true,
      contact: { select: { id: true, name: true } },
      assignee: { select: { id: true, email: true } },
    },
  });

  return NextResponse.json({ tasks });
}

const createSchema = z.object({
  title: z.string().min(1, 'Tittel er påkrevd').max(300),
  contactId: z.number().int().positive().nullable().optional(),
  organizationId: z.number().int().positive().nullable().optional(),
  dealId: z.number().int().positive().nullable().optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
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

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;

  try {
    const task = await prisma.task.create({
      data: {
        title: data.title,
        contactId: data.contactId ?? null,
        organizationId: data.organizationId ?? null,
        dealId: data.dealId ?? null,
        assigneeId: data.assigneeId ?? null,
        dueAt: data.dueAt ? new Date(data.dueAt) : null,
      },
    });

    let activityContactId = task.contactId;
    let activityOrganizationId = task.organizationId;

    // If no direct contact/org but deal exists, use deal's contact/org
    if (!activityContactId && !activityOrganizationId && task.dealId) {
      const deal = await prisma.deal.findUnique({
        where: { id: task.dealId },
        select: { contactId: true, organizationId: true },
      });
      if (deal) {
        activityContactId = deal.contactId;
        activityOrganizationId = deal.organizationId;
      }
    }

    if (activityContactId || activityOrganizationId) {
      await prisma.contactActivity.create({
        data: {
          contactId: activityContactId,
          organizationId: activityOrganizationId,
          type: 'task',
          title: `Oppgave opprettet: ${task.title}`,
          actorEmail: session.user.email,
        },
      });
    }

    logActivity({
      action: 'create',
      entity: 'task',
      entityId: task.id,
      userEmail: session.user.email,
    }).catch(() => {});
    return NextResponse.json({ task }, { status: 201 });
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
}
