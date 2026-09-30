import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';
import logger from '@/lib/logger';
import { emailFromResetIdentifier, hashToken } from '@/lib/auth-tokens';

export async function POST(request: Request) {
  try {
    // E-posten leses fra tokenet; et ev. `email` i body (eldre lenker) ignoreres.
    const { token, password } = await request.json();

    if (!token || !password) {
      return NextResponse.json(
        { error: 'Alle felt er påkrevd' },
        { status: 400 }
      );
    }

    if (typeof password !== 'string' || password.length < 8) {
      return NextResponse.json(
        { error: 'Passordet må være minst 8 tegn' },
        { status: 400 }
      );
    }

    // Tokens lagres som sha256-hash (se forgot-password)
    const tokenHash = hashToken(String(token));
    const verificationToken = await prisma.verificationToken.findUnique({ where: { token: tokenHash } });
    const normalizedEmail = verificationToken ? emailFromResetIdentifier(verificationToken.identifier) : null;

    if (!verificationToken || !normalizedEmail) {
      return NextResponse.json(
        { error: 'Ugyldig eller utløpt lenke. Be om en ny tilbakestillingslenke.' },
        { status: 400 }
      );
    }

    // Check if token has expired
    if (verificationToken.expires < new Date()) {
      // Clean up expired token
      await prisma.verificationToken.delete({
        where: {
          identifier_token: {
            identifier: normalizedEmail,
            token: tokenHash,
          },
        },
      });

      return NextResponse.json(
        { error: 'Lenken har utløpt. Be om en ny tilbakestillingslenke.' },
        { status: 400 }
      );
    }

    // Find the user
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'Bruker ikke funnet' },
        { status: 400 }
      );
    }

    // Hash the new password and update user
    const passwordHash = await hashPassword(password);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    // Delete the used token. Tokens lagres som sha256-hash, så slett på tokenHash
    // (ikke rå token). deleteMany unngår P2025 dersom raden allerede er borte.
    await prisma.verificationToken.deleteMany({
      where: {
        identifier: normalizedEmail,
        token: tokenHash,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('[reset-password] Error', { error });
    return NextResponse.json(
      { error: 'Noe gikk galt. Vennligst prøv igjen.' },
      { status: 500 }
    );
  }
}
