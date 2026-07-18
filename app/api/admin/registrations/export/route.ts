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
    const registrations = await prisma.registration.findMany({
      where: {
        parent: { deletedAt: null },
        OR: [
          { childId: null },
          { child: { deletedAt: null } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        course: { select: { name: true } },
        child: { select: { name: true, birthdate: true, allergies: true } },
        parent: {
          select: {
            name: true,
            phone: true,
            user: { select: { email: true } },
          },
        },
      },
    });

    const headers = [
      'ID',
      'Kurs',
      'Barn',
      'Fodselsdato',
      'Forelder',
      'E-post',
      'Telefon',
      'Allergier',
      'Status',
      'Samtykke aktiviteter',
      'Samtykke media',
      'Samtykke risiko',
      'Dato',
    ];

    const rows = registrations.map((reg) => [
      String(reg.id),
      escapeCsvField(reg.course.name),
      escapeCsvField(reg.child?.name ?? `${reg.parent.name} (voksen)`),
      reg.child?.birthdate
        ? new Date(reg.child.birthdate).toLocaleDateString('nb-NO')
        : '',
      escapeCsvField(reg.parent.name),
      escapeCsvField(reg.parent.user.email),
      escapeCsvField(reg.parent.phone),
      reg.child?.allergies ? escapeCsvField(reg.child.allergies) : '',
      reg.status,
      reg.consentActivities ? 'Ja' : 'Nei',
      reg.consentMedia ? 'Ja' : 'Nei',
      reg.consentRisk ? 'Ja' : 'Nei',
      new Date(reg.createdAt).toLocaleDateString('nb-NO'),
    ]);

    const csv =
      '\uFEFF' +
      [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

    const today = new Date().toISOString().split('T')[0];
    const filename = `pameldinger-${today}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    logger.error('Error exporting registrations', { error });
    return NextResponse.json(
      { error: 'Kunne ikke eksportere påmeldinger' },
      { status: 500 }
    );
  }
}
