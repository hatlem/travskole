import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { EXCEL_CSV, csvFilename, csvResponse, toCsv } from '@/lib/crm/csv-export';
import { REGISTRATION_EXPORT_HEADERS, registrationExportRow } from '@/lib/registrations/export';
import logger from '@/lib/logger';

/** Påmeldinger som Excel-fil (semikolon, UTF-8 med BOM). `?courseId=` gir deltakerlisten for ett kurs. */
export async function GET(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Du må være logget inn som administrator.' }, { status: 401 });
  }

  const rawCourseId = request.nextUrl.searchParams.get('courseId');
  const courseId = rawCourseId ? Number(rawCourseId) : null;
  if (rawCourseId && !Number.isInteger(courseId)) {
    return NextResponse.json({ error: 'Ugyldig kurs' }, { status: 400 });
  }

  try {
    const course = courseId ? await prisma.course.findUnique({ where: { id: courseId }, select: { name: true } }) : null;
    if (courseId && !course) {
      return NextResponse.json({ error: 'Kurset finnes ikke' }, { status: 404 });
    }

    const registrations = await prisma.registration.findMany({
      where: {
        ...(courseId ? { courseId } : {}),
        parent: { deletedAt: null },
        OR: [{ childId: null }, { child: { deletedAt: null } }],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        course: { select: { name: true, price: true, paymentMethods: true } },
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

    const rows = registrations.map(registrationExportRow);

    logActivity({
      action: 'export',
      entity: 'registration',
      entityId: courseId ?? undefined,
      details: JSON.stringify({ rows: rows.length, ...(courseId ? { courseId } : {}) }),
      userEmail: session.user.email,
    }).catch(() => {});

    const filename = csvFilename(course ? `deltakere ${course.name}` : 'pameldinger');
    return csvResponse(toCsv(REGISTRATION_EXPORT_HEADERS, rows, EXCEL_CSV), filename);
  } catch (error) {
    logger.error('Error exporting registrations', { error });
    return NextResponse.json({ error: 'Kunne ikke eksportere påmeldinger' }, { status: 500 });
  }
}
