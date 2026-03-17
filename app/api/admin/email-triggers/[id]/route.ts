import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

async function requireSuperAdmin() {
  const session = await getServerSession();
  if (!session || session.user.role !== 'superadmin') return null;
  return session;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSuperAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const { templateId, offsetDays, enabled } = body;

    const data: Record<string, unknown> = {};
    if (templateId !== undefined) data.templateId = templateId != null ? Number(templateId) : null;
    if (offsetDays !== undefined) data.offsetDays = Number(offsetDays);
    if (enabled !== undefined) data.enabled = enabled;

    const trigger = await prisma.emailTrigger.update({
      where: { id: Number(id) },
      data,
    });

    return NextResponse.json({ trigger });
  } catch (error) {
    console.error('Error updating email trigger:', error);
    return NextResponse.json({ error: 'Kunne ikke oppdatere trigger' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSuperAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    await prisma.emailTrigger.delete({
      where: { id: Number(id) },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting email trigger:', error);
    return NextResponse.json({ error: 'Kunne ikke slette trigger' }, { status: 500 });
  }
}
