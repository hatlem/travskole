import { Course } from '@/components/CourseCard';
import CourseFilter from '@/components/CourseFilter';
import { prisma } from '@/lib/prisma';

async function getAllCourses(): Promise<Course[]> {
  try {
    const dbCourses = await prisma.course.findMany({
      orderBy: { startDate: 'asc' },
    });

    return dbCourses.map((c) => ({
      id: String(c.id),
      name: c.name,
      description: c.description ?? '',
      type: c.type as 'kurs' | 'leir',
      start_date: c.startDate.toISOString().split('T')[0],
      end_date: c.endDate ? c.endDate.toISOString().split('T')[0] : undefined,
      age_min: c.ageMin ?? undefined,
      age_max: c.ageMax ?? undefined,
      price: c.price ?? 0,
      max_participants: c.maxParticipants ?? 0,
      status: c.status as 'open' | 'full' | 'closed',
    }));
  } catch {
    return [];
  }
}

export default async function CoursesPage() {
  const courses = await getAllCourses();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-[#003B7A] text-white py-16">
        <div className="max-w-7xl mx-auto px-6">
          <h1 className="text-4xl md:text-5xl font-bold mb-3">Kurs og leirer</h1>
          <p className="text-lg text-white/80">
            Utforsk vårt utvalg av kurs og leirer for alle aldre og nivåer
          </p>
        </div>
      </div>

      <CourseFilter courses={courses} />
    </div>
  );
}
