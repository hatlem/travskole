import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import logger from '@/lib/logger';

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
          where: { deletedAt: null },
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
              where: { deletedAt: null },
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
    logger.error('Error fetching users', { error });
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 });
  }
}
