import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { occupiedRegistrationsCount } from '@/lib/registrations/capacity';
import { EXCEL_CSV, csvFilename, csvResponse, excelNumber, toCsv } from '@/lib/crm/csv-export';
import { COURSE_STATUS_LABELS, formatOsloDate, label } from '@/lib/export-labels';
import logger from '@/lib/logger';
import { courseTypeLabel, getSetting, parseCourseTypes } from '@/lib/settings';

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
    const courseTypes = parseCourseTypes(await getSetting('course_types'));
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
      'Pris (kr)',
      'Maks deltakere',
      'Påmeldinger (aktive)',
      'Opprettet',
    ];

    const rows = courses.map((course) => [
      course.id,
      course.name,
      courseTypeLabel(courseTypes, course.type),
      label(COURSE_STATUS_LABELS, course.status),
      formatOsloDate(course.startDate),
      formatOsloDate(course.endDate),
      ageRange(course.ageMin, course.ageMax),
      excelNumber(course.price ?? 0),
      course.maxParticipants ?? 'Ubegrenset',
      course._count.registrations,
      formatOsloDate(course.createdAt),
    ]);

    logActivity({
      action: 'export',
      entity: 'course',
      details: JSON.stringify({ rows: rows.length }),
      userEmail: session.user.email,
    }).catch(() => {});

    return csvResponse(toCsv(headers, rows, EXCEL_CSV), csvFilename('kurs'));
  } catch (error) {
    logger.error('Error exporting courses', { error });
    return NextResponse.json({ error: 'Kunne ikke eksportere kurs' }, { status: 500 });
  }
}
