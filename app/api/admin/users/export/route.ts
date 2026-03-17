import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

async function requireAdmin() {
  const session = await getServerSession();
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'superadmin')) {
    return null;
  }
  return session;
}

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        parent: {
          select: {
            name: true,
            phone: true,
            address: true,
          },
        },
      },
    });

    const headers = ['ID', 'E-post', 'Navn', 'Telefon', 'Adresse', 'Rolle', 'Opprettet'];

    const roleLabels: Record<string, string> = {
      parent: 'Forelder',
      admin: 'Administrator',
      superadmin: 'Superadmin',
    };

    const rows = users.map((user) => [
      String(user.id),
      escapeCsvField(user.email),
      user.parent ? escapeCsvField(user.parent.name) : '',
      user.parent?.phone || '',
      user.parent?.address ? escapeCsvField(user.parent.address) : '',
      roleLabels[user.role] || user.role,
      new Date(user.createdAt).toLocaleDateString('nb-NO'),
    ]);

    const csv =
      '\uFEFF' +
      [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

    const today = new Date().toISOString().split('T')[0];
    const filename = `brukere-${today}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error exporting users:', error);
    return NextResponse.json(
      { error: 'Kunne ikke eksportere brukere' },
      { status: 500 }
    );
  }
}
