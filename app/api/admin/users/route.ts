import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import DOMPurify from 'isomorphic-dompurify';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { assignableRoles } from '@/lib/user-admin';
import { issueMagicLink } from '@/lib/magic-link';
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
        deactivatedAt: true,
        anonymizedAt: true,
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

const createSchema = z.object({
  email: z.string().email('Ugyldig e-postadresse'),
  role: z.enum(['parent', 'admin', 'superadmin']).optional(),
  name: z.string().min(2, 'Navnet må være minst 2 tegn').max(100).optional(),
  phone: z.string().min(8, 'Ugyldig telefonnummer').max(20).optional(),
  address: z.string().max(200).optional(),
  sendMagicLink: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Ugyldige felter' },
        { status: 400 }
      );
    }
    const body = parsed.data;
    const role = body.role ?? 'parent';

    if (!assignableRoles(session.user.role).includes(role)) {
      return NextResponse.json(
        { error: 'Du kan ikke opprette en bruker med denne rollen' },
        { status: 403 }
      );
    }

    const email = body.email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      return NextResponse.json(
        { error: 'En bruker med denne e-posten finnes allerede' },
        { status: 400 }
      );
    }

    const name = body.name ? DOMPurify.sanitize(body.name) : null;
    const address = body.address ? DOMPurify.sanitize(body.address) : null;

    const user = await prisma.user.create({
      data: {
        email,
        role,
        // Opprett Parent-profil når vi har profilinfo (navn/telefon/adresse).
        ...(name || body.phone || address
          ? { parent: { create: { name: name ?? '', phone: body.phone ?? '', address } } }
          : {}),
      },
      select: { id: true, email: true, role: true, deactivatedAt: true, anonymizedAt: true },
    });

    // Valgfri magic link så brukeren kan logge inn uten passord (samme mekanisme
    // som /api/auth/magic-link).
    if (body.sendMagicLink) {
      try {
        await issueMagicLink(email);
      } catch (mailError) {
        logger.error('[users:create] magic link send failed', { mailError });
        // Ikke feil hele opprettelsen om e-posten feiler.
      }
    }

    logActivity({
      action: 'create',
      entity: 'user',
      entityId: user.id,
      details: JSON.stringify({ role, sentMagicLink: !!body.sendMagicLink }),
      userEmail: session.user.email,
    }).catch(() => {});

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    logger.error('Error creating user', { error });
    return NextResponse.json({ error: 'Kunne ikke opprette bruker' }, { status: 500 });
  }
}
