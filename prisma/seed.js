const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Create admin user
  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@bjerke.no',
      passwordHash: '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5NU7BZ0xLz9km', // "admin123" hashed
      role: 'admin',
    },
  });
  console.log('✅ Admin user created:', adminUser.email);

  // Create a parent user
  const parentUser = await prisma.user.create({
    data: {
      email: 'mor@eksempel.no',
      passwordHash: '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5NU7BZ0xLz9km', // "admin123" hashed
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
  console.log('✅ Parent user created:', parentUser.email);

  // Create children for parent
  const child1 = await prisma.child.create({
    data: {
      parentId: parentUser.parent.id,
      name: 'Emma Nordmann',
      birthdate: new Date('2015-06-15'),
      allergies: 'Ingen kjente allergier',
    },
  });

  const child2 = await prisma.child.create({
    data: {
      parentId: parentUser.parent.id,
      name: 'Ole Nordmann',
      birthdate: new Date('2018-03-22'),
      allergies: 'Allergisk mot pollen',
    },
  });
  console.log('✅ Children created:', child1.name, child2.name);

  // Create courses
  const course1 = await prisma.course.create({
    data: {
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
  });

  const course2 = await prisma.course.create({
    data: {
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
  });

  const course3 = await prisma.course.create({
    data: {
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
  });
  console.log('✅ Courses created:', course1.name, course2.name, course3.name);

  // Create a sample registration
  const registration1 = await prisma.registration.create({
    data: {
      courseId: course1.id,
      childId: child1.id,
      parentId: parentUser.parent.id,
      consentActivities: true,
      consentMedia: true,
      consentRisk: true,
      status: 'confirmed',
    },
  });
  console.log('✅ Sample registration created for:', child1.name, 'in', course1.name);

  console.log('\n✅ Database seed completed successfully!');
  console.log('\n📊 Summary:');
  console.log(`   • Users: ${await prisma.user.count()}`);
  console.log(`   • Parents: ${await prisma.parent.count()}`);
  console.log(`   • Children: ${await prisma.child.count()}`);
  console.log(`   • Courses: ${await prisma.course.count()}`);
  console.log(`   • Registrations: ${await prisma.registration.count()}`);
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
