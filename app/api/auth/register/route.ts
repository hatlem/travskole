import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '@/lib/auth';

const prisma = new PrismaClient();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, phone, password, address } = body;

    // Validate required fields
    if (!name || !email || !phone || !password) {
      return NextResponse.json(
        { error: 'Alle påkrevde felt må fylles ut' },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'En bruker med denne e-posten finnes allerede' },
        { status: 400 }
      );
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user and parent in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create user
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          role: 'parent',
        },
      });

      // Create parent profile
      const parent = await tx.parent.create({
        data: {
          userId: user.id,
          name,
          phone,
          address: address || null,
        },
      });

      return { user, parent };
    });

    return NextResponse.json(
      {
        message: 'Bruker opprettet',
        userId: result.user.id,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: 'Noe gikk galt under registrering' },
      { status: 500 }
    );
  }
}
