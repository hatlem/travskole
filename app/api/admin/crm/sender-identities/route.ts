import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

// The 7 verified bjerke.no sending addresses. Seeded idempotently (createMany
// + skipDuplicates on the unique `email` column) on first GET, so this list
// is the single source of truth — adding an address here is enough, no
// separate migration/seed script needed.
const SEED_IDENTITIES = [
  { email: 'registrering@bjerke.no', displayName: 'Bjerke Registrering' },
  { email: 'hilde.apneseth@bjerke.no', displayName: 'Hilde Apneseth' },
  { email: 'andre.ringelien@bjerke.no', displayName: 'Andre Ringelien' },
  { email: 'hege.karin.arverud@bjerke.no', displayName: 'Hege Karin Arverud' },
  { email: 'stine.rasmussen@bjerke.no', displayName: 'Stine Rasmussen' },
  { email: 'bjerke@bjerke.no', displayName: 'Bjerke Travbane' },
  { email: 'arild.engebretsen@bjerke.no', displayName: 'Arild Engebretsen' },
] as const;

async function ensureSeeded(): Promise<void> {
  await prisma.senderIdentity.createMany({
    data: SEED_IDENTITIES.map((identity) => ({ ...identity, active: true })),
    skipDuplicates: true,
  });
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await ensureSeeded();

  const identities = await prisma.senderIdentity.findMany({ orderBy: { id: 'asc' } });
  return NextResponse.json({ identities });
}

const patchSchema = z
  .object({
    id: z.number().int().positive(),
    displayName: z.string().min(1).max(200).optional(),
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
