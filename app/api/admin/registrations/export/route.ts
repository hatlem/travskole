import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

async function requireAdmin() {
  const session = await getServerSession();
  if (!session || session.user.role !== 'admin') {
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
    const registrations = await prisma.registration.findMany({
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
      escapeCsvField(reg.child.name),
      reg.child.birthdate
        ? new Date(reg.child.birthdate).toLocaleDateString('nb-NO')
        : '',
      escapeCsvField(reg.parent.name),
      reg.parent.user.email,
      reg.parent.phone,
      reg.child.allergies ? escapeCsvField(reg.child.allergies) : '',
      reg.status,
      reg.consentActivities ? 'Ja' : 'Nei',
      reg.consentMedia ? 'Ja' : 'Nei',
      reg.consentRisk ? 'Ja' : 'Nei',
      new Date(reg.createdAt).toLocaleDateString('nb-NO'),
    ]);

    const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join(
      '\n'
    );

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
    console.error('Error exporting registrations:', error);
    return NextResponse.json(
      { error: 'Kunne ikke eksportere påmeldinger' },
      { status: 500 }
    );
  }
}
