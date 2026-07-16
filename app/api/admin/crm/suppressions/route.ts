import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { normalizeEmail } from '@/lib/crm/normalize';

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const suppressions = await prisma.suppression.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ suppressions });
}

const createSchema = z.object({
  email: z.string().email('Ugyldig e-postadresse'),
  reason: z.enum(['unsubscribe', 'bounce', 'complaint', 'manual']).optional(),
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
  const email = normalizeEmail(parsed.data.email);
  if (!email) {
    return NextResponse.json({ error: 'Ugyldig e-postadresse' }, { status: 400 });
  }

  try {
    const suppression = await prisma.suppression.upsert({
      where: { email },
      create: { email, reason: parsed.data.reason ?? 'manual' },
      update: { reason: parsed.data.reason ?? 'manual' },
    });

    logActivity({ action: 'create', entity: 'suppression', entityId: suppression.id, userEmail: session.user.email }).catch(() => {});
    return NextResponse.json({ suppression }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return NextResponse.json({ error: 'Duplikat: raden finnes allerede' }, { status: 409 });
    }
    throw error;
  }
}

export async function DELETE(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const email = normalizeEmail(request.nextUrl.searchParams.get('email'));
  if (!email) {
    return NextResponse.json({ error: 'Ugyldig e-postadresse' }, { status: 400 });
  }

  try {
    await prisma.suppression.delete({ where: { email } });
    logActivity({ action: 'delete', entity: 'suppression', details: JSON.stringify({ email }), userEmail: session.user.email }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2025' || error.code === 'P2003')
    ) {
      return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
    }
    throw error;
  }
}
