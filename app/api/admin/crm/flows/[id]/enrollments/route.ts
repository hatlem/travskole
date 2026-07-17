import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { enrollContact, enrollSegment } from '@/lib/flows/enroll';

const PAGE_SIZE = 50;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const flowId = Number(id);
  if (!Number.isInteger(flowId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  const flow = await prisma.flow.findUnique({ where: { id: flowId }, select: { id: true } });
  if (!flow) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }

  const page = Math.max(1, Number(request.nextUrl.searchParams.get('page')) || 1);

  const [enrollments, total] = await Promise.all([
    prisma.flowEnrollment.findMany({
      where: { flowId },
      include: { contact: { select: { id: true, name: true } } },
      orderBy: [{ enteredAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.flowEnrollment.count({ where: { flowId } }),
  ]);

  return NextResponse.json({ enrollments, total, page, pageSize: PAGE_SIZE });
}

// Exactly one of contactId / segmentId — never both, never neither.
const enrollSchema = z
  .object({
    contactId: z.number().int().positive().optional(),
    segmentId: z.number().int().positive().optional(),
  })
  .refine((v) => (v.contactId !== undefined) !== (v.segmentId !== undefined), {
    message: 'Oppgi enten contactId eller segmentId, ikke begge eller ingen',
  });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const flowId = Number(id);
  if (!Number.isInteger(flowId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }

  const parsed = enrollSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;

  const flow = await prisma.flow.findUnique({ where: { id: flowId }, select: { id: true } });
  if (!flow) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }

  if (data.contactId !== undefined) {
    const contact = await prisma.contact.findUnique({
      where: { id: data.contactId },
      select: { id: true },
    });
    if (!contact) {
      return NextResponse.json({ error: 'Fant ingen kontakt med denne iden' }, { status: 404 });
    }

    // enrollContact returns whether a NEW enrollment was created — an
    // already-active enrollment for this (flow, contact) pair is a no-op,
    // and we surface that honestly as `enrolled: 0` rather than claiming
    // success either way.
    const created = await enrollContact(flowId, data.contactId);

    logActivity({
      action: 'enroll',
      entity: 'flow',
      entityId: flowId,
      userEmail: session.user.email,
    }).catch(() => {});
    return NextResponse.json({ enrolled: created ? 1 : 0 });
  }

  const segmentId = data.segmentId as number;
  const segment = await prisma.segment.findUnique({ where: { id: segmentId }, select: { id: true } });
  if (!segment) {
    return NextResponse.json({ error: 'Fant ingen segment med denne iden' }, { status: 404 });
  }

  const enrolled = await enrollSegment(flowId, segmentId);

  logActivity({
    action: 'enroll_segment',
    entity: 'flow',
    entityId: flowId,
    userEmail: session.user.email,
  }).catch(() => {});
  return NextResponse.json({ enrolled });
}
