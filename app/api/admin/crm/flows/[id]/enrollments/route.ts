import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { enrollContacts, enrollList, enrollSegment, type EnrollOptions, type EnrollSummary } from '@/lib/flows/enroll';
import { AWAITING_ACTIVATION_RUN_AT, isAwaitingActivation } from '@/lib/flows/awaiting-activation';
import { settleParkedEnrollments } from '@/lib/flows/activation';
import { marketingReach } from '@/lib/flows/enroll-reach';
import { canEnrollIntoStatus, isTemplateStatus } from '@/lib/flows/status';
import { isWaitingForSendWindow } from '@/lib/flows/send-window';
import { getFlowSendWindowState } from '@/lib/flows/send-window-store';

const PAGE_SIZE = 50;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Du må være logget inn som administrator.' }, { status: 401 });
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

  const [enrollments, total, active, emailNodes, sendWindow] = await Promise.all([
    prisma.flowEnrollment.findMany({
      where: { flowId },
      include: { contact: { select: { id: true, name: true } } },
      orderBy: [{ enteredAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.flowEnrollment.count({ where: { flowId } }),
    prisma.flowEnrollment.count({ where: { flowId, status: 'active' } }),
    prisma.flowNode.findMany({ where: { flowId, type: 'email' }, select: { id: true } }),
    getFlowSendWindowState(flowId),
  ]);

  const emailNodeIds = new Set(emailNodes.map((node) => node.id));
  const now = new Date();
  return NextResponse.json({
    enrollments: enrollments.map((enrollment) => ({
      ...enrollment,
      awaitingActivation: isAwaitingActivation(enrollment),
      waitingForSendWindow: isWaitingForSendWindow(enrollment, emailNodeIds, sendWindow.effective, now),
    })),
    total,
    active,
    page,
    pageSize: PAGE_SIZE,
  });
}

const MAX_CONTACT_IDS = 500;

// Nøyaktig én av contactId / contactIds / segmentId / listId.
const enrollSchema = z
  .object({
    contactId: z.number().int().positive().optional(),
    contactIds: z
      .array(z.number().int().positive())
      .min(1, 'Velg minst én kontakt')
      .max(MAX_CONTACT_IDS, `Maks ${MAX_CONTACT_IDS} kontakter per innmelding`)
      .optional(),
    segmentId: z.number().int().positive().optional(),
    listId: z.number().int().positive().optional(),
  })
  .refine(
    (v) => [v.contactId, v.contactIds, v.segmentId, v.listId].filter((x) => x !== undefined).length === 1,
    { message: 'Oppgi nøyaktig én av contactId, contactIds, segmentId eller listId' },
  );

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Du må være logget inn som administrator.' }, { status: 401 });
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

  const flow = await prisma.flow.findUnique({
    where: { id: flowId },
    select: { id: true, status: true, anchorMode: true, isMarketing: true },
  });
  if (!flow) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }
  if (isTemplateStatus(flow.status)) {
    return NextResponse.json({ error: 'Kan ikke melde inn i en mal.' }, { status: 409 });
  }
  // Kurs-forankrede løp må starte fra en påmelding — uten kursanker avslutter
  // første «Planlegg»-node løpet stille.
  if (flow.anchorMode === 'course') {
    return NextResponse.json(
      { error: 'Kurs-forankrede flyter startes av påmeldinger og kan ikke fylles manuelt.' },
      { status: 409 },
    );
  }
  if (!canEnrollIntoStatus(flow.status)) {
    return NextResponse.json(
      { error: 'Flyten må være et utkast, aktiv eller pauset for å legge til personer.' },
      { status: 409 },
    );
  }

  // I et utkast venter løpene på aktivering — ingen e-post før flyten aktiveres.
  const awaitingActivation = flow.status === 'draft';
  const enrolledIds: number[] = [];
  const options: EnrollOptions = {
    collect: enrolledIds,
    ...(awaitingActivation && { startAt: AWAITING_ACTIVATION_RUN_AT }),
  };

  let summary: EnrollSummary;
  if (data.segmentId !== undefined) {
    const segment = await prisma.segment.findUnique({ where: { id: data.segmentId }, select: { id: true } });
    if (!segment) {
      return NextResponse.json({ error: 'Fant ingen segment med denne iden' }, { status: 404 });
    }
    summary = await enrollSegment(flowId, data.segmentId, options);
  } else if (data.listId !== undefined) {
    const listSummary = await enrollList(flowId, data.listId, options);
    if (!listSummary) {
      return NextResponse.json({ error: 'Fant ingen liste med denne iden' }, { status: 404 });
    }
    summary = listSummary;
  } else {
    const ids = data.contactIds ?? [data.contactId as number];
    summary = await enrollContacts(flowId, ids, options);
    if (data.contactId !== undefined && summary.skippedMissing > 0) {
      return NextResponse.json({ error: 'Fant ingen kontakt med denne iden' }, { status: 404 });
    }
  }

  // Flyten kan ha blitt aktivert eller arkivert mens personene ble lagt til.
  const parked = awaitingActivation ? await settleParkedEnrollments(flowId) : null;
  if (parked?.kind === 'exited' || parked?.kind === 'gone') {
    return NextResponse.json(
      { error: 'Flyten ble arkivert eller slettet mens personene ble lagt til — ingen ble meldt inn.' },
      { status: 409 },
    );
  }
  const stillWaiting = parked?.kind === 'waiting';

  logActivity({
    action: data.segmentId !== undefined ? 'enroll_segment' : data.listId !== undefined ? 'enroll_list' : 'enroll',
    entity: 'flow',
    entityId: flowId,
    userEmail: session.user.email,
    details: JSON.stringify(summary),
  }).catch(() => {});
  // Markedsføring går bare til de med samtykke — si det med en gang, ikke først når e-postene uteblir.
  const reach = flow.isMarketing === true ? await marketingReach(enrolledIds) : undefined;
  return NextResponse.json({
    ...summary,
    ...(stillWaiting && { awaitingActivation: true }),
    ...(reach && { reach }),
  });
}
