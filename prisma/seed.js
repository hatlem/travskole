const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create admin user (upsert to be idempotent)
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@bjerke.no' },
    update: {},
    create: {
      email: 'admin@bjerke.no',
      passwordHash: '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5NU7BZ0xLz9km', // "admin123"
      role: 'admin',
    },
  });
  console.log('Admin user:', adminUser.email);

  // Create parent user
  const parentUser = await prisma.user.upsert({
    where: { email: 'mor@eksempel.no' },
    update: {},
    create: {
      email: 'mor@eksempel.no',
      passwordHash: '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5NU7BZ0xLz9km', // "admin123"
      role: 'parent',
    },
    include: { parent: true },
  });

  // Create parent profile if not exists
  let parent = parentUser.parent;
  if (!parent) {
    parent = await prisma.parent.create({
      data: {
        userId: parentUser.id,
        name: 'Kari Nordmann',
        phone: '+47 98765432',
        address: 'Eksempelveien 42, 0123 Oslo',
      },
    });
  }
  console.log('Parent user:', parentUser.email);

  // Create children (check if exist first)
  const existingChildren = await prisma.child.findMany({
    where: { parentId: parent.id },
  });

  let child1, child2;
  if (existingChildren.length === 0) {
    child1 = await prisma.child.create({
      data: {
        parentId: parent.id,
        name: 'Emma Nordmann',
        birthdate: new Date('2015-06-15'),
        allergies: 'Ingen kjente allergier',
      },
    });
    child2 = await prisma.child.create({
      data: {
        parentId: parent.id,
        name: 'Ole Nordmann',
        birthdate: new Date('2018-03-22'),
        allergies: 'Allergisk mot pollen',
      },
    });
    console.log('Children created:', child1.name, child2.name);
  } else {
    child1 = existingChildren[0];
    child2 = existingChildren[1];
    console.log('Children already exist');
  }

  // Create courses (upsert by name)
  const courses = [
    {
      name: 'Begynnerkurs - Våren 2026',
      description: 'Perfekt for barn som aldri har prøvd travhest før! Vi lærer grunnleggende ridning, stell og sikkerhet.',
      type: 'kurs',
      startDate: new Date('2026-04-10'),
      endDate: new Date('2026-05-15'),
      ageMin: 6,
      ageMax: 12,
      price: 2500,
      maxParticipants: 12,
      status: 'open',
    },
    {
      name: 'Sommerleir 2026 - Uke 28',
      description: 'Hele uken på travskolen! Mye moro med hester, nye venner og aktiviteter. Inkluderer lunsj.',
      type: 'leir',
      startDate: new Date('2026-07-06'),
      endDate: new Date('2026-07-10'),
      ageMin: 7,
      ageMax: 14,
      price: 4800,
      maxParticipants: 16,
      status: 'open',
    },
    {
      name: 'Videregående - Høsten 2026',
      description: 'For deg som har prøvd travhest før og vil lære mer! Vi jobber med mer avanserte teknikker.',
      type: 'kurs',
      startDate: new Date('2026-09-05'),
      endDate: new Date('2026-10-10'),
      ageMin: 8,
      ageMax: 15,
      price: 3200,
      maxParticipants: 10,
      status: 'open',
    },
  ];

  const createdCourses = [];
  for (const course of courses) {
    const existing = await prisma.course.findFirst({
      where: { name: course.name },
    });
    if (!existing) {
      const created = await prisma.course.create({ data: course });
      createdCourses.push(created);
      console.log('Course created:', created.name);
    } else {
      createdCourses.push(existing);
      console.log('Course exists:', existing.name);
    }
  }

  // Create sample registration if none exist
  const regCount = await prisma.registration.count();
  if (regCount === 0 && child1 && createdCourses[0]) {
    await prisma.registration.create({
      data: {
        courseId: createdCourses[0].id,
        childId: child1.id,
        parentId: parent.id,
        consentActivities: true,
        consentMedia: true,
        consentRisk: true,
        status: 'confirmed',
      },
    });
    console.log('Sample registration created');
  }

  console.log('Seed completed!');
  const counts = {
    users: await prisma.user.count(),
    parents: await prisma.parent.count(),
    children: await prisma.child.count(),
    courses: await prisma.course.count(),
    registrations: await prisma.registration.count(),
  };
  console.log('Counts:', JSON.stringify(counts));
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
