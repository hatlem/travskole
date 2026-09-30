import type { MetadataRoute } from 'next';
import { generateSlug } from '@/lib/slug';
import { isUpcomingOrOngoing } from '@/lib/course-card';

export interface SitemapCourse {
  name: string;
  slug: string | null;
  type: string;
  startDate: Date | null;
  endDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Kurssider i sitemapen — samme utvalg og URL-er som arrangementslisten
 * (udaterte «avtal tid»-kurs bruker opprettelsesåret, som i CourseCard).
 */
export function courseSitemapEntries(
  courses: SitemapCourse[],
  baseUrl: string,
  now: Date = new Date()
): MetadataRoute.Sitemap {
  return courses
    .filter((course) => isUpcomingOrOngoing(course, now))
    .map((course) => {
      const slug = course.slug || generateSlug(course.name);
      const year = (course.startDate ?? course.createdAt).getFullYear();
      return {
        url: `${baseUrl}/arrangementer/${course.type}/${year}/${slug}`,
        lastModified: course.updatedAt,
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      };
    });
}
