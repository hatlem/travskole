import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { parseJsonArray } from '@/lib/crm/normalize';

const PAGE_SIZE = 25;

export async function GET(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const q = sp.get('q')?.trim() ?? '';
  const stage = sp.get('stage') ?? '';
  const page = Math.max(1, Number(sp.get('page')) || 1);

  const where = {
    ...(q && {
      OR: [
        { name: { contains: q, mode: 'insensitive' as const } },
        { domain: { contains: q.toLowerCase() } },
        { orgNumber: { contains: q } },
      ],
    }),
    ...(stage && { stage }),
  };

  const [organizations, total] = await Promise.all([
    prisma.organization.findMany({
      where,
      orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
      include: { _count: { select: { contacts: true, deals: true } } },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.organization.count({ where }),
  ]);

  return NextResponse.json({
    organizations: organizations.map((o) => ({
      id: o.id,
      name: o.name,
      domain: o.domain,
      orgNumber: o.orgNumber,
      phone: o.phone,
      stage: o.stage,
      tags: parseJsonArray(o.tags),
      contactCount: o._count.contacts,
      dealCount: o._count.deals,
      lastActivityAt: o.lastActivityAt,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
  });
}

const createSchema = z.object({
  name: z.string().min(1, 'Navn er påkrevd').max(200),
  domain: z.string().max(200).nullable().optional(),
  orgNumber: z.string().max(20).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  stage: z.enum(['lead', 'active', 'customer', 'dormant', 'lost']).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

export async function POST(request: NextRequest) {
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

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;
  const domain = data.domain?.trim().toLowerCase() || null;

  if (domain) {
    const existing = await prisma.organization.findFirst({ where: { domain } });
    if (existing) {
      return NextResponse.json({ error: 'En bedrift med dette domenet finnes allerede' }, { status: 409 });
    }
  }

  try {
    const organization = await prisma.organization.create({
      data: {
        name: data.name,
        domain,
        orgNumber: data.orgNumber ?? null,
        phone: data.phone ?? null,
        address: data.address ?? null,
        stage: data.stage ?? 'lead',
        tags: JSON.stringify(data.tags ?? []),
      },
    });

    logActivity({
      action: 'create',
      entity: 'organization',
      entityId: organization.id,
      userEmail: session.user.email,
    }).catch(() => {});
    return NextResponse.json({ organization }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return NextResponse.json({ error: 'En bedrift med dette domenet finnes allerede' }, { status: 409 });
    }
    throw error;
  }
}
