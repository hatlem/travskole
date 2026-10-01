import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { EXCEL_CSV, csvFilename, csvResponse, toCsv } from '@/lib/crm/csv-export';
import { formatPhoneForExport } from '@/lib/admin-format';
import { ROLE_LABELS, formatOsloDate, label } from '@/lib/export-labels';
import logger from '@/lib/logger';

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Du må være logget inn som administrator.' }, { status: 401 });
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

    const headers = ['ID', 'E-post', 'Navn', 'Telefon', 'Adresse', 'Rolle', 'Registrert'];

    const rows = users.map((user) => [
      user.id,
      user.email,
      user.parent?.name ?? '',
      formatPhoneForExport(user.parent?.phone),
      user.parent?.address ?? '',
      label(ROLE_LABELS, user.role),
      formatOsloDate(user.createdAt),
    ]);

    logActivity({
      action: 'export',
      entity: 'user',
      details: JSON.stringify({ rows: rows.length }),
      userEmail: session.user.email,
    }).catch(() => {});

    return csvResponse(toCsv(headers, rows, EXCEL_CSV), csvFilename('brukere'));
  } catch (error) {
    logger.error('Error exporting users', { error });
    return NextResponse.json({ error: 'Kunne ikke eksportere brukere' }, { status: 500 });
  }
}
