import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { emitEvent } from '@/lib/events/bus';

const consentSchema = z.object({
  marketing: z.boolean(),
  lawfulBasis: z.enum(['consent', 'legitimate_interest', 'contract']).nullable().optional(),
  source: z.string().max(200).nullable().optional(),
});

export async function PUT(
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

  const parsed = consentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;

  try {
    const consent = await prisma.consent.upsert({
      where: { contactId },
      create: {
        contactId,
        marketing: data.marketing,
        lawfulBasis: data.lawfulBasis ?? null,
        source: data.source ?? `admin:${session.user.email}`,
        consentAt: data.marketing ? new Date() : null,
      },
      update: {
        marketing: data.marketing,
        lawfulBasis: data.lawfulBasis ?? null,
        source: data.source ?? `admin:${session.user.email}`,
        consentAt: data.marketing ? new Date() : null,
      },
    });

    logActivity({ action: 'update', entity: 'consent', entityId: consent.id, details: JSON.stringify({ marketing: data.marketing }), userEmail: session.user.email }).catch(() => {});

    emitEvent({
      type: 'consent.updated',
      source: 'server',
      contactId,
      meta: { marketing: data.marketing ?? null, lawfulBasis: data.lawfulBasis ?? null },
    }).catch(() => {});

    return NextResponse.json({ consent });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2025' || error.code === 'P2003')) {
      return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
    }
    throw error;
  }
}
