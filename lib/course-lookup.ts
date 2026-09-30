/** Oppslag av kurs fra offentlige URL-er (/arrangementer/{type}/{år}/{slug}). */
import { prisma } from '@/lib/prisma';
import { generateSlug } from '@/lib/slug';

const COURSE_PATH = /^\/arrangementer\/([^/]+)\/(\d{4})\/([^/]+)(?:\/pamelding)?\/?$/;
const TYPE_PATTERN = /^[a-z0-9-]+$/;

/** Plukker type og slug ut av en kurs- eller påmeldingssti. Null for andre stier. */
export function parseCoursePath(pathname: string): { type: string; slug: string } | null {
  const match = COURSE_PATH.exec(pathname);
  if (!match) return null;
  try {
    return { type: decodeURIComponent(match[1]), slug: decodeURIComponent(match[3]) };
  } catch {
    return null;
  }
}

export async function findCourseBySlug(type: string, slug: string) {
  if (!TYPE_PATTERN.test(type)) return null;
  const course = await prisma.course.findFirst({ where: { type, slug } });
  if (course) return course;
  // Legacy fallback: kurs opprettet før slug ble lagret.
  const candidates = await prisma.course.findMany({
    where: { type, OR: [{ slug: null }, { slug: '' }] },
    select: { id: true, name: true },
  });
  const legacy = candidates.find((c) => generateSlug(c.name) === slug);
  if (!legacy) return null;
  return prisma.course.findUnique({ where: { id: legacy.id } });
}
