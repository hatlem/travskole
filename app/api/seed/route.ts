import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const { secret } = await request.json();

  if (secret !== (process.env.SEED_SECRET || 'travskole-seed-2026')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Check if already seeded
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      const counts = {
        users: userCount,
        courses: await prisma.course.count(),
        registrations: await prisma.registration.count(),
      };
      return NextResponse.json({ message: 'Already seeded', counts });
    }

    const passwordHash = await hashPassword('admin123');

    // Create admin user
    const adminUser = await prisma.user.create({
      data: { email: 'admin@bjerke.no', passwordHash, role: 'admin' },
    });

    // Create parent user with profile
    const parentUser = await prisma.user.create({
      data: {
        email: 'mor@eksempel.no',
        passwordHash,
        role: 'parent',
        parent: {
          create: {
            name: 'Kari Nordmann',
            phone: '+47 98765432',
            address: 'Eksempelveien 42, 0123 Oslo',
          },
        },
      },
      include: { parent: true },
    });

    // Create children
    const child1 = await prisma.child.create({
      data: {
        parentId: parentUser.parent!.id,
        name: 'Emma Nordmann',
        birthdate: new Date('2015-06-15'),
        allergies: 'Ingen kjente allergier',
      },
    });

    await prisma.child.create({
      data: {
        parentId: parentUser.parent!.id,
        name: 'Ole Nordmann',
        birthdate: new Date('2018-03-22'),
        allergies: 'Allergisk mot pollen',
      },
    });

    // Create courses
    const course1 = await prisma.course.create({
      data: {
        name: 'Begynnerkurs - Våren 2026',
        description: 'Perfekt for barn som aldri har prøvd travhest før! Vi lærer grunnleggende ridning, stell og sikkerhet.',
        type: 'kurs',
        startDate: new Date('2026-04-10'),
        endDate: new Date('2026-05-15'),
        ageMin: 6, ageMax: 12, price: 2500, maxParticipants: 12, status: 'open',
      },
    });

    await prisma.course.create({
      data: {
        name: 'Sommerleir 2026 - Uke 28',
        description: 'Hele uken på travskolen! Mye moro med hester, nye venner og aktiviteter. Inkluderer lunsj.',
        type: 'leir',
        startDate: new Date('2026-07-06'),
        endDate: new Date('2026-07-10'),
        ageMin: 7, ageMax: 14, price: 4800, maxParticipants: 16, status: 'open',
      },
    });

    await prisma.course.create({
      data: {
        name: 'Videregående - Høsten 2026',
        description: 'For deg som har prøvd travhest før og vil lære mer! Vi jobber med mer avanserte teknikker.',
        type: 'kurs',
        startDate: new Date('2026-09-05'),
        endDate: new Date('2026-10-10'),
        ageMin: 8, ageMax: 15, price: 3200, maxParticipants: 10, status: 'open',
      },
    });

    // Create sample registration
    await prisma.registration.create({
      data: {
        courseId: course1.id,
        childId: child1.id,
        parentId: parentUser.parent!.id,
        consentActivities: true,
        consentMedia: true,
        consentRisk: true,
        status: 'confirmed',
      },
    });

    const counts = {
      users: await prisma.user.count(),
      parents: await prisma.parent.count(),
      children: await prisma.child.count(),
      courses: await prisma.course.count(),
      registrations: await prisma.registration.count(),
    };

    return NextResponse.json({ message: 'Seeded successfully', counts });
  } catch (error) {
    console.error('Seed error:', error);
    return NextResponse.json({ error: 'Seed failed', details: String(error) }, { status: 500 });
  }
}
