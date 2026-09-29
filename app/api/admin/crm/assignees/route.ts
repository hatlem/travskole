import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { assigneeUserWhere } from '@/lib/crm/assignees';

// Mulige ansvarlige (aktive admin/superadmin) + innlogget brukers id,
// slik at klienten kan forhåndsvelge «Mine».
export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const users = await prisma.user.findMany({
    where: assigneeUserWhere,
    orderBy: { email: 'asc' },
    select: { id: true, email: true, role: true, parent: { select: { name: true } } },
  });

  const currentUserId = Number(session.user.id);
  return NextResponse.json({
    assignees: users.map((u) => ({ id: u.id, email: u.email, name: u.parent?.name ?? null, role: u.role })),
    currentUserId: Number.isInteger(currentUserId) ? currentUserId : null,
  });
}
