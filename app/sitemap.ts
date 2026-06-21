import type { MetadataRoute } from 'next';
import { getBaseUrl } from '@/lib/site';
import { prisma } from '@/lib/prisma';
import { generateSlug } from '@/lib/slug';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getBaseUrl();

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${baseUrl}/arrangementer`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.9,
    },
  ];

  // Dynamic course pages
  try {
    const courses = await prisma.course.findMany({
      where: { status: { in: ['open', 'full'] }, startDate: { not: null } },
      select: { name: true, slug: true, type: true, startDate: true, updatedAt: true },
    });

    const coursePages: MetadataRoute.Sitemap = courses.map((course) => {
      const slug = course.slug || generateSlug(course.name);
      const year = course.startDate!.getFullYear();
      return {
        url: `${baseUrl}/arrangementer/${course.type}/${year}/${slug}`,
        lastModified: course.updatedAt,
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      };
    });

    return [...staticPages, ...coursePages];
  } catch {
    return staticPages;
  }
}
