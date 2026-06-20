import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  const VALID_STATUSES = ['new', 'confirmed', 'cancelled'];
  if (!VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: 'Ugyldig status' }, { status: 400 });
  }

  const booking = await prisma.bookingRequest.update({
    where: { id: Number(id) },
    data: { status: body.status },
  });

  logActivity({ action: 'status_change', entity: 'booking', entityId: Number(id), details: JSON.stringify({ status: body.status }), userEmail: session.user.email }).catch(() => {});

  return NextResponse.json({ booking });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  await prisma.bookingRequest.delete({
    where: { id: Number(id) },
  });

  logActivity({ action: 'delete', entity: 'booking', entityId: Number(id), userEmail: session.user.email }).catch(() => {});

  return NextResponse.json({ success: true });
}
