import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin, requireSuperAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { normalizeEmail } from '@/lib/crm/normalize';

// Ikke-kontakt-status for en kontakts e-post. Alle admins kan legge til;
// kun superadmin kan fjerne (avmelding/klage skal ikke overstyres lett).

async function contactEmail(id: string): Promise<{ email: string | null; contactId: number } | null> {
  const contactId = Number(id);
  if (!Number.isInteger(contactId)) return null;
  const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { email: true } });
  if (!contact) return null;
  return { email: normalizeEmail(contact.email), contactId };
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Du må være logget inn som administrator.' }, { status: 401 });
  }
  const { id } = await params;
  const found = await contactEmail(id);
  if (!found) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }
  if (!found.email) {
    return NextResponse.json({ error: 'Kontakten har ingen e-postadresse' }, { status: 400 });
  }

  const suppression = await prisma.suppression.upsert({
    where: { email: found.email },
    create: { email: found.email, reason: 'manual' },
    update: {},
  });

  logActivity({
    action: 'create',
    entity: 'suppression',
    entityId: suppression.id,
    details: JSON.stringify({ contactId: found.contactId }),
    userEmail: session.user.email,
  }).catch(() => {});
  return NextResponse.json({ suppression: { reason: suppression.reason, createdAt: suppression.createdAt } }, { status: 201 });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Du må være logget inn som administrator.' }, { status: 401 });
  }
  const session = await requireSuperAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Kun superadmin kan fjerne fra ikke-kontakt-listen' }, { status: 403 });
  }
  const { id } = await params;
  const found = await contactEmail(id);
  if (!found || !found.email) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }

  try {
    await prisma.suppression.delete({ where: { email: found.email } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: 'E-posten står ikke på ikke-kontakt-listen' }, { status: 404 });
    }
    throw error;
  }

  logActivity({
    action: 'delete',
    entity: 'suppression',
    details: JSON.stringify({ contactId: found.contactId }),
    userEmail: session.user.email,
  }).catch(() => {});
  return NextResponse.json({ ok: true });
}
