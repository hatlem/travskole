import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { occupiedRegistrationsCount } from '@/lib/registrations/capacity';
import { csvFilename, csvResponse, toCsv } from '@/lib/crm/csv-export';
import { COURSE_STATUS_LABELS, formatOsloDate, label } from '@/lib/export-labels';
import logger from '@/lib/logger';

const TYPE_LABELS: Record<string, string> = {
  kurs: 'Kurs',
  leir: 'Leir',
};

function ageRange(ageMin: number | null, ageMax: number | null): string {
  if (ageMin != null && ageMax != null) return `${ageMin}–${ageMax}`;
  if (ageMin != null) return `${ageMin}+`;
  if (ageMax != null) return `0–${ageMax}`;
  return '';
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const courses = await prisma.course.findMany({
      orderBy: { startDate: 'desc' },
      include: occupiedRegistrationsCount,
    });

    const headers = [
      'ID',
      'Navn',
      'Type',
      'Status',
      'Startdato',
      'Sluttdato',
      'Alder (min–maks)',
      'Pris',
      'Maks deltakere',
      'Påmeldinger (aktive)',
      'Opprettet',
    ];

    const rows = courses.map((course) => [
      course.id,
      course.name,
      label(TYPE_LABELS, course.type),
      label(COURSE_STATUS_LABELS, course.status),
      formatOsloDate(course.startDate),
      formatOsloDate(course.endDate),
      ageRange(course.ageMin, course.ageMax),
      course.price ?? 0,
      course.maxParticipants,
      course._count.registrations,
      formatOsloDate(course.createdAt),
    ]);

    return csvResponse(toCsv(headers, rows), csvFilename('kurs'));
  } catch (error) {
    logger.error('Error exporting courses', { error });
    return NextResponse.json({ error: 'Kunne ikke eksportere kurs' }, { status: 500 });
  }
}
