const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testDatabase() {
  console.log('🧪 Testing database connection...\n');

  try {
    // Test 1: Fetch all users
    const users = await prisma.user.findMany({
      include: { parent: true },
    });
    console.log('✅ Users found:', users.length);
    users.forEach(user => {
      console.log(`   • ${user.email} (${user.role})`);
    });

    // Test 2: Fetch all courses
    console.log('\n✅ Courses found:', await prisma.course.count());
    const courses = await prisma.course.findMany({
      select: { name: true, type: true, status: true },
    });
    courses.forEach(course => {
      console.log(`   • ${course.name} (${course.type}, ${course.status})`);
    });

    // Test 3: Fetch registrations with relations
    const registrations = await prisma.registration.findMany({
      include: {
        course: { select: { name: true } },
        child: { select: { name: true } },
        parent: { select: { name: true } },
      },
    });
    console.log('\n✅ Registrations found:', registrations.length);
    registrations.forEach(reg => {
      console.log(`   • ${reg.child.name} → ${reg.course.name} (${reg.status})`);
    });

    // Test 4: Complex query - children with their parent info
    const children = await prisma.child.findMany({
      include: {
        parent: {
          select: { name: true, phone: true },
        },
        registrations: {
          include: {
            course: { select: { name: true } },
          },
        },
      },
    });
    console.log('\n✅ Children found:', children.length);
    children.forEach(child => {
      console.log(`   • ${child.name} (parent: ${child.parent.name})`);
      if (child.registrations.length > 0) {
        console.log(`     Registered for: ${child.registrations.map(r => r.course.name).join(', ')}`);
      }
    });

    console.log('\n✅ All database tests passed!');
    console.log('\n🎯 Database schema is working correctly with all relations.');
    
  } catch (error) {
    console.error('❌ Database test failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

testDatabase();
