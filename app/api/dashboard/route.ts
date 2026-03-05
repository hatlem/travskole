import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession();

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: {
      parent: {
        include: {
          children: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
          },
          registrations: {
            include: {
              course: true,
              child: true,
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if (!user.parent) {
    return NextResponse.json({
      profile: null,
      children: [],
      registrations: [],
    });
  }

  const { parent } = user;

  return NextResponse.json({
    profile: {
      name: parent.name,
      email: user.email,
      phone: parent.phone,
      address: parent.address,
    },
    children: parent.children.map((c) => ({
      id: c.id,
      name: c.name,
      birthdate: c.birthdate?.toISOString() ?? null,
      allergies: c.allergies,
    })),
    registrations: parent.registrations.map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      courseName: r.course.name,
      courseType: r.course.type,
      courseStartDate: r.course.startDate.toISOString(),
      courseEndDate: r.course.endDate?.toISOString() ?? null,
      childName: r.child.name,
    })),
  });
}
