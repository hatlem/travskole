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
    const courses = await prisma.course.findMany({
      orderBy: { startDate: 'desc' },
      include: {
        _count: { select: { registrations: true } },
      },
    });

    const headers = [
      'ID',
      'Navn',
      'Type',
      'Status',
      'Startdato',
      'Sluttdato',
      'Alder (min-max)',
      'Pris',
      'Maks deltakere',
      'Pameldinger',
      'Opprettet',
    ];

    const statusLabels: Record<string, string> = {
      open: 'Apen',
      full: 'Fullt',
      closed: 'Stengt',
    };

    const typeLabels: Record<string, string> = {
      kurs: 'Kurs',
      leir: 'Leir',
    };

    const rows = courses.map((course) => [
      String(course.id),
      escapeCsvField(course.name),
      typeLabels[course.type] || course.type,
      statusLabels[course.status] || course.status,
      new Date(course.startDate).toLocaleDateString('nb-NO'),
      course.endDate ? new Date(course.endDate).toLocaleDateString('nb-NO') : '',
      course.ageMin != null && course.ageMax != null
        ? `${course.ageMin}-${course.ageMax}`
        : course.ageMin != null
          ? `${course.ageMin}+`
          : course.ageMax != null
            ? `0-${course.ageMax}`
            : '',
      course.price != null ? String(course.price) : '0',
      course.maxParticipants != null ? String(course.maxParticipants) : '',
      String(course._count.registrations),
      new Date(course.createdAt).toLocaleDateString('nb-NO'),
    ]);

    const csv =
      '\uFEFF' +
      [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

    const today = new Date().toISOString().split('T')[0];
    const filename = `kurs-${today}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error exporting courses:', error);
    return NextResponse.json(
      { error: 'Kunne ikke eksportere kurs' },
      { status: 500 }
    );
  }
}
