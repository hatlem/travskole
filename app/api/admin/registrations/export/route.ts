import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { csvFilename, csvResponse, toCsv } from '@/lib/crm/csv-export';
import { REGISTRATION_STATUS_LABELS, formatOsloDate, label } from '@/lib/export-labels';
import logger from '@/lib/logger';

const yesNo = (value: boolean) => (value ? 'Ja' : 'Nei');

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const registrations = await prisma.registration.findMany({
      where: {
        parent: { deletedAt: null },
        OR: [{ childId: null }, { child: { deletedAt: null } }],
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
      'Deltaker',
      'Fødselsdato',
      'Foresatt',
      'E-post',
      'Telefon',
      'Allergier',
      'Status',
      'Samtykke aktiviteter',
      'Samtykke bilder/video',
      'Samtykke risiko',
      'Påmeldt',
    ];

    // Fødselsdato er en ren dato (UTC-midnatt) — formateres i UTC for å unngå dagsforskyvning.
    const rows = registrations.map((reg) => [
      reg.id,
      reg.course.name,
      reg.child?.name ?? `${reg.parent.name} (voksen)`,
      reg.child?.birthdate ? reg.child.birthdate.toLocaleDateString('nb-NO', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }) : '',
      reg.parent.name,
      reg.parent.user.email,
      reg.parent.phone,
      reg.child?.allergies ?? '',
      label(REGISTRATION_STATUS_LABELS, reg.status),
      yesNo(reg.consentActivities),
      yesNo(reg.consentMedia),
      yesNo(reg.consentRisk),
      formatOsloDate(reg.createdAt),
    ]);

    return csvResponse(toCsv(headers, rows), csvFilename('pameldinger'));
  } catch (error) {
    logger.error('Error exporting registrations', { error });
    return NextResponse.json({ error: 'Kunne ikke eksportere påmeldinger' }, { status: 500 });
  }
}
