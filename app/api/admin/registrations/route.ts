import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import logger from '@/lib/logger';

interface ChildInput {
  firstName: string;
  lastName?: string;
  birthdate?: string;
  allergies?: string;
}

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();

    // Support both old format (single child) and new format (children array)
    const children: ChildInput[] = body.children ?? [{
      firstName: body.childFirstName,
      lastName: body.childLastName,
      birthdate: body.childBirthdate,
      allergies: body.childAllergies,
    }];

    const { courseId, parentFirstName, parentLastName, parentEmail, parentPhone } = body;

    if (!courseId || !parentFirstName || !parentEmail) {
      return NextResponse.json({ error: 'Kurs, fornavn og e-post er påkrevd' }, { status: 400 });
    }

    if (children.length === 0 || !children[0].firstName) {
      return NextResponse.json({ error: 'Minst ett barn med fornavn er påkrevd' }, { status: 400 });
    }

    const course = await prisma.course.findUnique({ where: { id: Number(courseId) } });
    if (!course) {
      return NextResponse.json({ error: 'Kurset finnes ikke' }, { status: 404 });
    }

    const parentName = [parentFirstName, parentLastName].filter(Boolean).join(' ');

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
        data: { userId: user.id, name: parentName, phone: parentPhone || '' },
      });
    }

    // Create registrations for each child
    const registrations = [];
    for (const childInput of children) {
      if (!childInput.firstName) continue;

      const childName = [childInput.firstName, childInput.lastName].filter(Boolean).join(' ');

      const child = await prisma.child.create({
        data: {
          parentId: parent.id,
          name: childName,
          birthdate: childInput.birthdate ? new Date(childInput.birthdate) : null,
          allergies: childInput.allergies || null,
        },
      });

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
      logActivity({ action: 'create', entity: 'registration', entityId: registration.id, details: JSON.stringify({ course: registration.course.name, child: registration.child?.name ?? registration.parent.name }), userEmail: session.user.email }).catch(() => {});
      registrations.push(registration);
    }

    // Return single or multiple
    if (registrations.length === 1) {
      return NextResponse.json({ registration: registrations[0] }, { status: 201 });
    }
    return NextResponse.json({ registrations }, { status: 201 });
  } catch (error) {
    logger.error('Error creating registration', { error });
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

    const baseWhere = {
      parent: { deletedAt: null },
      OR: [
        { childId: null },
        { child: { deletedAt: null } },
      ],
    };
    const where = courseId
      ? { ...baseWhere, courseId: Number(courseId) }
      : baseWhere;

    const registrations = await prisma.registration.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        course: { select: { id: true, name: true } },
        // birthdate/allergies er med fordi admin kan rette dem inline (PATCH
        // /api/admin/registrations/[id]).
        child: { select: { id: true, name: true, birthdate: true, allergies: true } },
        parent: {
          select: {
            id: true,
            name: true,
            phone: true,
            address: true,
            user: { select: { email: true } },
          },
        },
      },
    });

    return NextResponse.json({ registrations });
  } catch (error) {
    logger.error('Error fetching registrations', { error });
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 });
  }
}
