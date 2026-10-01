import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { normalizeEmail, parseJsonArray } from '@/lib/crm/normalize';
import { parseSegmentRules, contactMatchesSegment, segmentsForContact } from '@/lib/crm/segments';
import { INVALID_ASSIGNEE_ERROR, isAssignableUser } from '@/lib/crm/assignees';
import { ownerFilterWhere, parseOwnerFilter } from '@/lib/crm/owner-filter';

const PAGE_SIZE = 50;

export async function GET(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const q = sp.get('q')?.trim() ?? '';
  const stage = sp.get('stage') ?? '';
  const tag = sp.get('tag')?.trim() ?? '';
  const segmentId = Number(sp.get('segmentId')) || null;
  const listId = Number(sp.get('listId')) || null;
  const ownerFilter = parseOwnerFilter(sp.get('owner'), Number(session.user.id) || null);
  const page = Math.max(1, Number(sp.get('page')) || 1);

  const where = {
    source: { not: 'system' },
    ...(q && {
      OR: [
        { name: { contains: q, mode: 'insensitive' as const } },
        { email: { contains: q.toLowerCase() } },
        { phone: { contains: q } },
      ],
    }),
    ...(stage && { stage }),
    ...(listId && { memberships: { some: { listId } } }),
    ...ownerFilterWhere(ownerFilter, 'ownerId'),
  };

  const all = await prisma.contact.findMany({
    where,
    orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
    include: {
      organization: { select: { id: true, name: true } },
      owner: { select: { id: true, email: true } },
      deals: { select: { eventType: true, eventDate: true, status: true } },
    },
  });

  // Tag- og segmentfiltrering skjer i minnet (tags er JSON-kolonne,
  // segmenter er regelbaserte). Datamengden her er små tusen kontakter.
  let filtered = all.map((c) => ({ ...c, tagList: parseJsonArray(c.tags) }));
  const availableTags = [...new Set(filtered.flatMap((c) => c.tagList))].sort((a, b) => a.localeCompare(b, 'nb'));
  if (tag) {
    filtered = filtered.filter((c) => c.tagList.includes(tag));
  }
  const toSegmentContact = (c: (typeof filtered)[number]) => ({
    stage: c.stage, source: c.source, email: c.email,
    organizationId: c.organizationId, lastActivityAt: c.lastActivityAt,
    tags: c.tagList, deals: c.deals,
  });
  const segments = await prisma.segment.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, rules: true },
  });
  if (segmentId) {
    const segment = segments.find((s) => s.id === segmentId);
    if (segment) {
      const rules = parseSegmentRules(segment.rules);
      filtered = filtered.filter((c) => contactMatchesSegment(toSegmentContact(c), rules));
    }
  }

  const total = filtered.length;
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Kontaktene (med deals) er allerede lastet for filtreringen, så segmenter
  // for de ≤50 radene på siden koster bare regelevaluering i minnet. Lister
  // hentes med én spørring for sidens kontakter.
  const memberships = pageItems.length
    ? await prisma.contactListMembership.findMany({
        where: { contactId: { in: pageItems.map((c) => c.id) } },
        orderBy: { list: { name: 'asc' } },
        select: { contactId: true, list: { select: { id: true, name: true } } },
      })
    : [];
  const listsByContact = new Map<number, { id: number; name: string }[]>();
  for (const m of memberships) {
    listsByContact.set(m.contactId, [...(listsByContact.get(m.contactId) ?? []), m.list]);
  }

  return NextResponse.json({
    contacts: pageItems.map((c) => ({
      id: c.id, name: c.name, email: c.email, phone: c.phone,
      stage: c.stage, source: c.source, tags: c.tagList,
      organization: c.organization, owner: c.owner,
      lastActivityAt: c.lastActivityAt, dealCount: c.deals.length,
      segments: segmentsForContact(toSegmentContact(c), segments).map((s) => ({ id: s.id, name: s.name })),
      lists: listsByContact.get(c.id) ?? [],
    })),
    total, page, pageSize: PAGE_SIZE, availableTags,
  });
}

const createSchema = z.object({
  name: z.string().min(1, 'Navn er påkrevd').max(200),
  email: z.string().email('Ugyldig e-postadresse').nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  organizationId: z.number().int().positive().nullable().optional(),
  stage: z.enum(['lead', 'active', 'customer', 'dormant', 'lost']).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  roleTitle: z.string().max(100).nullable().optional(),
  ownerId: z.number().int().positive().nullable().optional(),
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
  const email = normalizeEmail(data.email ?? null);

  if (!(await isAssignableUser(data.ownerId))) {
    return NextResponse.json({ error: INVALID_ASSIGNEE_ERROR }, { status: 400 });
  }

  if (email) {
    const existing = await prisma.contact.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: 'En kontakt med denne e-posten finnes allerede' }, { status: 409 });
    }
  }

  const contact = await prisma.contact.create({
    data: {
      name: data.name, email, phone: data.phone ?? null,
      organizationId: data.organizationId ?? null,
      stage: data.stage ?? 'lead',
      tags: JSON.stringify(data.tags ?? []),
      roleTitle: data.roleTitle ?? null,
      ownerId: data.ownerId ?? null,
      source: 'manual',
    },
  });

  logActivity({ action: 'create', entity: 'contact', entityId: contact.id, userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ contact }, { status: 201 });
}
