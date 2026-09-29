import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/settings-shared';
import { logActivity } from '@/lib/activity';
import {
  ensureSenderIdentitiesSeeded,
  getAllowedSenderDomains,
  validateSenderEmail,
} from '@/lib/crm/sender-identities';

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await ensureSenderIdentitiesSeeded();

  const [rows, allowedDomains] = await Promise.all([
    prisma.senderIdentity.findMany({
      orderBy: { id: 'asc' },
      include: { _count: { select: { messageSends: true } } },
    }),
    getAllowedSenderDomains(),
  ]);
  const users = await prisma.user.findMany({
    where: { email: { in: rows.map((r) => r.email), mode: 'insensitive' } },
    select: { email: true },
  });
  const userEmails = new Set(users.map((u) => u.email.toLowerCase()));

  const identities = rows.map(({ _count, ...identity }) => ({
    ...identity,
    sendCount: _count.messageSends,
    hasUserAccount: userEmails.has(identity.email.toLowerCase()),
  }));

  return NextResponse.json({
    identities,
    allowedDomains,
    canManage: isSuperAdmin(session.user.role),
  });
}

const createSchema = z.object({
  email: z.string().min(1, 'E-post er påkrevd').max(254),
  displayName: z.string().trim().min(1, 'Visningsnavn er påkrevd').max(200),
});

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSuperAdmin(session.user.role)) {
    return NextResponse.json({ error: 'Kun superadmin kan legge til avsendere' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const validation = validateSenderEmail(parsed.data.email, await getAllowedSenderDomains());
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const email = validation.email;
  const duplicateMessage = `${email} er allerede registrert som avsender`;

  // Eldre rader kan ha blandet store/små bokstaver; unique-indeksen er case-sensitiv.
  const existing = await prisma.senderIdentity.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ error: duplicateMessage }, { status: 409 });
  }

  try {
    const identity = await prisma.senderIdentity.create({
      data: { email, displayName: parsed.data.displayName, active: true },
    });
    logActivity({
      action: 'create',
      entity: 'sender_identity',
      entityId: identity.id,
      details: JSON.stringify({ email }),
      userEmail: session.user.email,
    }).catch(() => {});
    return NextResponse.json({ identity }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: duplicateMessage }, { status: 409 });
    }
    throw error;
  }
}

const patchSchema = z
  .object({
    id: z.number().int().positive(),
    displayName: z.string().trim().min(1, 'Visningsnavn kan ikke være tomt').max(200).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => v.displayName !== undefined || v.active !== undefined, {
    message: 'Ingen felter å oppdatere',
  });

export async function PATCH(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;

  try {
    const identity = await prisma.senderIdentity.update({
      where: { id: data.id },
      data: {
        ...(data.displayName !== undefined && { displayName: data.displayName }),
        ...(data.active !== undefined && { active: data.active }),
      },
    });

    logActivity({
      action: 'update',
      entity: 'sender_identity',
      entityId: identity.id,
      userEmail: session.user.email,
    }).catch(() => {});
    return NextResponse.json({ identity });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2025' || error.code === 'P2003')
    ) {
      return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
    }
    throw error;
  }
}
