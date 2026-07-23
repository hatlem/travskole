/**
 * Live kurs-flettekontekst for kurs-forankrede flyt-enrollments. Leser
 * registrering→barn/forelder/kurs ved send (ingen snapshot) og returnerer
 * nøyaktig legacy-flettefeltene, så migrerte maler rendrer identisk.
 */
import { prisma } from '@/lib/prisma';
import { getSetting } from '@/lib/settings';
import type { MergeTagData } from '@/lib/email-templates';

function formatDate(date: Date): string {
  return date.toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export async function resolveCourseMergeContext(registrationId: number): Promise<MergeTagData | null> {
  const reg = await prisma.registration.findUnique({
    where: { id: registrationId },
    select: {
      child: { select: { name: true, allergies: true } },
      parent: { select: { name: true } },
      course: { select: { name: true, startDate: true, endDate: true } },
    },
  });
  if (!reg) return null;
  const contactEmail = await getSetting('contact_email');
  return {
    forelder_navn: reg.parent.name,
    barnets_navn: reg.child?.name ?? reg.parent.name,
    kurs_navn: reg.course.name,
    kurs_startdato: reg.course.startDate ? formatDate(reg.course.startDate) : '',
    kurs_sluttdato: reg.course.endDate ? formatDate(reg.course.endDate) : '',
    allergier: reg.child?.allergies || 'Ingen',
    kontakt_epost: contactEmail ?? '',
  };
}
