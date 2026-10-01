import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/settings-shared';
import { logActivity } from '@/lib/activity';
import { countNodesUsingSender } from '@/lib/crm/sender-identities';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Du må være logget inn som administrator.' }, { status: 401 });
  }
  if (!isSuperAdmin(session.user.role)) {
    return NextResponse.json({ error: 'Kun superadmin kan slette avsendere' }, { status: 403 });
  }

  const { id } = await params;
  const identityId = Number(id);
  if (!Number.isInteger(identityId) || identityId <= 0) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  const identity = await prisma.senderIdentity.findUnique({
    where: { id: identityId },
    select: { id: true, email: true, _count: { select: { messageSends: true } } },
  });
  if (!identity) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }

  // Sendehistorikken skal beholde avsenderen sin — deaktivering er veien videre.
  if (identity._count.messageSends > 0) {
    return NextResponse.json(
      {
        error: `Avsenderen har sendt ${identity._count.messageSends} e-post(er) og kan ikke slettes. Deaktiver den i stedet.`,
      },
      { status: 409 },
    );
  }

  const emailNodes = await prisma.flowNode.findMany({
    where: { type: 'email' },
    select: { config: true },
  });
  const usedBy = countNodesUsingSender(emailNodes.map((n) => n.config), identityId);
  if (usedBy > 0) {
    return NextResponse.json(
      {
        error: `Avsenderen brukes i ${usedBy} e-poststeg i flyter. Bytt avsender i flytene eller deaktiver den i stedet.`,
      },
      { status: 409 },
    );
  }

  try {
    await prisma.senderIdentity.delete({ where: { id: identityId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
    }
    throw error;
  }

  logActivity({
    action: 'delete',
    entity: 'sender_identity',
    entityId: identityId,
    details: JSON.stringify({ email: identity.email }),
    userEmail: session.user.email,
  }).catch(() => {});
  return NextResponse.json({ ok: true });
}
