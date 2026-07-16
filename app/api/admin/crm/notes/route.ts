import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

const createSchema = z.object({
  body: z.string().min(1, 'Notatet kan ikke være tomt').max(10000),
  contactId: z.number().int().positive().nullable().optional(),
  organizationId: z.number().int().positive().nullable().optional(),
  dealId: z.number().int().positive().nullable().optional(),
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

  if (!data.contactId && !data.organizationId && !data.dealId) {
    return NextResponse.json(
      { error: 'Notat må knyttes til kontakt, bedrift eller deal' },
      { status: 400 },
    );
  }

  try {
    const note = await prisma.note.create({
      data: {
        body: data.body,
        contactId: data.contactId ?? null,
        organizationId: data.organizationId ?? null,
        dealId: data.dealId ?? null,
        authorEmail: session.user.email,
      },
    });

    let activityContactId = note.contactId;
    let activityOrganizationId = note.organizationId;

    // If no direct contact/org but deal exists, use deal's contact/org
    if (!activityContactId && !activityOrganizationId && note.dealId) {
      const deal = await prisma.deal.findUnique({
        where: { id: note.dealId },
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
          type: 'note',
          title: 'Notat',
          body: note.body.slice(0, 500),
          actorEmail: session.user.email,
          meta: JSON.stringify({ noteId: note.id, dealId: note.dealId }),
        },
      });
    }

    logActivity({
      action: 'create',
      entity: 'note',
      entityId: note.id,
      userEmail: session.user.email,
    }).catch(() => {});
    return NextResponse.json({ note }, { status: 201 });
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
