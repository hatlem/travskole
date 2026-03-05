import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendPasswordResetEmail } from '@/lib/mail';
import crypto from 'crypto';

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'E-post er påkrevd' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Always return success to avoid leaking user existence
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (user) {
      // Clean up expired tokens for this user
      await prisma.verificationToken.deleteMany({
        where: {
          identifier: normalizedEmail,
          expires: { lt: new Date() },
        },
      });

      const token = crypto.randomUUID();

      await prisma.verificationToken.create({
        data: {
          identifier: normalizedEmail,
          token,
          expires: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        },
      });

      await sendPasswordResetEmail(normalizedEmail, token);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[forgot-password] Error:', error);
    return NextResponse.json(
      { error: 'Noe gikk galt. Vennligst prøv igjen.' },
      { status: 500 }
    );
  }
}
