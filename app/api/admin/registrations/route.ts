import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

async function requireAdmin() {
  const session = await getServerSession();
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'superadmin')) {
    return null;
  }
  return session;
}

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { courseId, childFirstName, childLastName, childBirthdate, childAllergies, parentFirstName, parentLastName, parentEmail, parentPhone } = body;

    if (!courseId || !childFirstName || !childLastName || !parentFirstName || !parentLastName || !parentEmail || !parentPhone) {
      return NextResponse.json({ error: 'Manglende påkrevde felter' }, { status: 400 });
    }

    const course = await prisma.course.findUnique({ where: { id: Number(courseId) } });
    if (!course) {
      return NextResponse.json({ error: 'Kurset finnes ikke' }, { status: 404 });
    }

    const parentName = `${parentFirstName} ${parentLastName}`;
    const childName = `${childFirstName} ${childLastName}`;

    // Find or create user + parent
    let user = await prisma.user.findUnique({ where: { email: parentEmail } });
    if (!user) {
      user = await prisma.user.create({
        data: { email: parentEmail, role: 'parent' },
      });
    }

    let parent = await prisma.parent.findUnique({ where: { userId: user.id } });
    if (!parent) {
      parent = await prisma.parent.create({
        data: { userId: user.id, name: parentName, phone: parentPhone },
      });
    }

    // Create child
    const child = await prisma.child.create({
      data: {
        parentId: parent.id,
        name: childName,
        birthdate: childBirthdate ? new Date(childBirthdate) : null,
        allergies: childAllergies || null,
      },
    });

    // Create registration as confirmed (admin-created)
    const registration = await prisma.registration.create({
      data: {
        courseId: course.id,
        childId: child.id,
        parentId: parent.id,
        consentActivities: true,
        consentMedia: false,
        consentRisk: true,
        status: 'confirmed',
      },
      include: {
        course: { select: { id: true, name: true } },
        child: { select: { id: true, name: true } },
        parent: {
          select: {
            id: true,
            name: true,
            phone: true,
            user: { select: { email: true } },
          },
        },
      },
    });

    return NextResponse.json({ registration }, { status: 201 });
  } catch (error) {
    console.error('Error creating registration:', error);
    return NextResponse.json({ error: 'Kunne ikke opprette påmelding' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get('courseId');

    const where = courseId ? { courseId: Number(courseId) } : {};

    const registrations = await prisma.registration.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        course: { select: { id: true, name: true } },
        child: { select: { id: true, name: true } },
        parent: {
          select: {
            id: true,
            name: true,
            phone: true,
            user: { select: { email: true } },
          },
        },
      },
    });

    return NextResponse.json({ registrations });
  } catch (error) {
    console.error('Error fetching registrations:', error);
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 });
  }
}
