import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

async function requireAdmin() {
  const session = await getServerSession();
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'superadmin')) {
    return null;
  }
  return session;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const { role } = body;

    const validRoles = session.user.role === 'superadmin'
      ? ['parent', 'admin', 'superadmin']
      : ['parent', 'admin'];

    if (!role || !validRoles.includes(role)) {
      return NextResponse.json({ error: 'Ugyldig rolle' }, { status: 400 });
    }

    // Only superadmin can assign superadmin role
    if (role === 'superadmin' && session.user.role !== 'superadmin') {
      return NextResponse.json({ error: 'Kun superadmin kan tildele superadmin-rolle' }, { status: 403 });
    }

    // Prevent admin from demoting themselves
    if (Number(id) === Number(session.user.id) && !['admin', 'superadmin'].includes(role)) {
      return NextResponse.json(
        { error: 'Du kan ikke fjerne din egen admin-rolle' },
        { status: 400 }
      );
    }

    const user = await prisma.user.update({
      where: { id: Number(id) },
      data: { role },
      select: {
        id: true,
        email: true,
        role: true,
      },
    });

    logActivity({ action: 'status_change', entity: 'user', entityId: Number(id), details: JSON.stringify({ role }), userEmail: session.user.email }).catch(() => {});

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Error updating user:', error);
    return NextResponse.json({ error: 'Kunne ikke oppdatere bruker' }, { status: 500 });
  }
}
