import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { csvFilename, csvResponse, toCsv } from '@/lib/crm/csv-export';
import { ROLE_LABELS, formatOsloDate, label } from '@/lib/export-labels';
import logger from '@/lib/logger';

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
          where: { deletedAt: null },
          select: {
            name: true,
            phone: true,
            address: true,
          },
        },
      },
    });

    const headers = ['ID', 'E-post', 'Navn', 'Telefon', 'Adresse', 'Rolle', 'Opprettet'];

    const rows = users.map((user) => [
      user.id,
      user.email,
      user.parent?.name ?? '',
      user.parent?.phone ?? '',
      user.parent?.address ?? '',
      label(ROLE_LABELS, user.role),
      formatOsloDate(user.createdAt),
    ]);

    return csvResponse(toCsv(headers, rows), csvFilename('brukere'));
  } catch (error) {
    logger.error('Error exporting users', { error });
    return NextResponse.json({ error: 'Kunne ikke eksportere brukere' }, { status: 500 });
  }
}
