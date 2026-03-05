import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { generateSlug } from '@/lib/slug';

async function requireAdmin() {
  const session = await getServerSession();
  if (!session || session.user.role !== 'admin') {
    return null;
  }
  return session;
}

export async function POST() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const coursesWithoutSlug = await prisma.course.findMany({
      where: { slug: null },
      select: { id: true, name: true, type: true },
    });

    if (coursesWithoutSlug.length === 0) {
      return NextResponse.json({ updated: 0, courses: [] });
    }

    const updatedCourses: { id: number; name: string; slug: string }[] = [];

    for (const course of coursesWithoutSlug) {
      let baseSlug = generateSlug(course.name);
      let slug = baseSlug;
      let suffix = 1;

      // Check for duplicates within the same type (@@unique([type, slug]))
      while (true) {
        const existing = await prisma.course.findUnique({
          where: { type_slug: { type: course.type, slug } },
        });
        if (!existing) break;
        suffix++;
        slug = `${baseSlug}-${suffix}`;
      }

      await prisma.course.update({
        where: { id: course.id },
        data: { slug },
      });

      updatedCourses.push({ id: course.id, name: course.name, slug });
    }

    return NextResponse.json({
      updated: updatedCourses.length,
      courses: updatedCourses,
    });
  } catch (error) {
    console.error('Error fixing slugs:', error);
    return NextResponse.json({ error: 'Kunne ikke oppdatere slugs' }, { status: 500 });
  }
}
