import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import logger from '@/lib/logger';

function escapeCsvField(value: string): string {
  // SECURITY: nøytraliser formelinjeksjon i Excel/Sheets (=, +, -, @, tab, CR)
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) {
    v = `'${v}`;
  }
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
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
    logger.error('Error exporting users', { error });
    return NextResponse.json(
      { error: 'Kunne ikke eksportere brukere' },
      { status: 500 }
    );
  }
}
