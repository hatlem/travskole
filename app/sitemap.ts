import type { MetadataRoute } from 'next';
import { getBaseUrl } from '@/lib/site';
import { prisma } from '@/lib/prisma';
import { SITEMAP_COURSE_STATUSES, courseSitemapEntries } from '@/lib/sitemap';

// Bygges uten DB-tilgang (brannmur) — må genereres ved forespørsel for å få med kursene.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getBaseUrl();
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${baseUrl}/arrangementer`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${baseUrl}/vilkar`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/personvern`, changeFrequency: 'yearly', priority: 0.3 },
  ];

  try {
    const courses = await prisma.course.findMany({
      where: { status: { in: SITEMAP_COURSE_STATUSES } },
      select: {
        name: true,
        slug: true,
        type: true,
        startDate: true,
        endDate: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return [...staticPages, ...courseSitemapEntries(courses, baseUrl, now)];
  } catch {
    return staticPages;
  }
}
