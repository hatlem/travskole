import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

async function requireAdmin() {
  const session = await getServerSession();
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'superadmin')) {
    return null;
  }
  return session;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        parent: {
          select: {
            id: true,
            name: true,
            phone: true,
            address: true,
            _count: {
              select: {
                children: true,
                registrations: true,
              },
            },
            children: {
              select: {
                id: true,
                name: true,
                birthdate: true,
                allergies: true,
              },
            },
            registrations: {
              select: {
                id: true,
                status: true,
                createdAt: true,
                course: { select: { id: true, name: true } },
                child: { select: { name: true } },
              },
              orderBy: { createdAt: 'desc' },
              take: 10,
            },
          },
        },
      },
    });

    return NextResponse.json({ users });
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 });
  }
}
