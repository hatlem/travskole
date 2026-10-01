import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { exitActiveEnrollments } from '@/lib/flows/exit';
import { parseNodeConfig, validateFlow, type GraphEdge, type GraphNode } from '@/lib/flows/graph';
import { ANCHOR_MODES, canDeleteStatus, isFlowEditable, isTemplateStatus } from '@/lib/flows/status';
import {
  flowSendWindowInputSchema, overrideToInput, resolveEffectiveSendWindow, sameSendWindow,
} from '@/lib/flows/send-window';
import {
  deleteFlowSendWindowOverride, getFlowSendWindowState, saveFlowSendWindowOverride,
} from '@/lib/flows/send-window-store';
import { wakeSendWindowParked } from '@/lib/flows/runner';
import logger from '@/lib/logger';

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

  const flow = await prisma.flow.findUnique({
    where: { id: flowId },
    include: {
      nodes: { orderBy: { id: 'asc' } },
      edges: { orderBy: { id: 'asc' } },
      triggers: { orderBy: { id: 'asc' } },
    },
  });
  if (!flow) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }

  return NextResponse.json({ flow });
}

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  isMarketing: z.boolean().optional(),
  anchorMode: z.enum(ANCHOR_MODES).optional(),
  status: z.enum(['draft', 'active', 'paused', 'archived']).optional(),
  // Sendetider endrer ikke grafen, så de kan endres også mens flyten kjører.
  sendWindow: flowSendWindowInputSchema.optional(),
});

/**
 * Status-overgangsmatrise for PATCH.
 *
 * - draft -> active er KUN lov via /activate-endepunktet (det er der
 *   validate-gaten kjører) — PATCH avviser dette forsøket eksplisitt.
 * - active <-> paused er fri toveis.
 * - alt -> archived er alltid lov (arkivering er en "myk slett").
 * - archived er terminal: ingen vei ut igjen via PATCH.
 * - alle andre kombinasjoner (f.eks. draft -> paused, paused -> draft) er
 *   udefinerte og avvises.
 */
function isValidStatusTransition(from: string, to: string): boolean {
  if (from === to) return true;
  if (from === 'archived') return false;
  if (to === 'archived') return true;
  if (from === 'active' && to === 'paused') return true;
  if (from === 'paused' && to === 'active') return true;
  return false;
}

export async function PATCH(
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

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;
  const changesSettings = data.isMarketing !== undefined || data.anchorMode !== undefined;

  const existing =
    data.status !== undefined || changesSettings
      ? await prisma.flow.findUnique({ where: { id: flowId }, select: { status: true, anchorMode: true } })
      : null;
  if ((data.status !== undefined || changesSettings) && !existing) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }

  if (existing && changesSettings) {
    // Samme lås som grafen: innstillinger endres bare når flyten ikke kjører.
    if (!isFlowEditable(existing.status)) {
      return NextResponse.json(
        { error: 'Sett flyten på pause for å endre innstillingene.' },
        { status: 409 },
      );
    }
    // En flyts enrollments er enten kontakt- eller kurs-forankret, aldri blandet (se lib/flows/enroll.ts).
    if (data.anchorMode !== undefined && data.anchorMode !== existing.anchorMode) {
      const activeCount = await prisma.flowEnrollment.count({ where: { flowId, status: 'active' } });
      if (activeCount > 0) {
        return NextResponse.json(
          { error: 'Kan ikke bytte forankring mens flyten har aktive påmeldinger.' },
          { status: 409 },
        );
      }
    }
  }

  if (existing && data.status !== undefined) {
    if (isTemplateStatus(existing.status)) {
      return NextResponse.json(
        { error: 'En mal kan ikke aktiveres eller endre status — lag en ny flyt fra malen.' },
        { status: 409 },
      );
    }
    if (existing.status === 'draft' && data.status === 'active') {
      return NextResponse.json(
        { error: 'Kan ikke aktivere via PATCH — bruk aktiveringsendepunktet.' },
        { status: 409 },
      );
    }
    if (!isValidStatusTransition(existing.status, data.status)) {
      return NextResponse.json({ error: 'Ugyldig statusovergang.' }, { status: 409 });
    }

    // Gjenopptak krever grønn validering — grafen kan ha blitt endret under pause.
    if (existing.status === 'paused' && data.status === 'active') {
      const flow = await prisma.flow.findUnique({
        where: { id: flowId },
        include: { nodes: true, edges: true },
      });
      if (!flow) {
        return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
      }

      const graphNodes: GraphNode[] = flow.nodes.map((node) => ({
        id: node.id,
        type: node.type as GraphNode['type'],
        config: parseNodeConfig(node.config),
      }));
      const graphEdges: GraphEdge[] = flow.edges.map((edge) => ({
        id: edge.id,
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        branch: edge.branch,
      }));

      const errors = validateFlow(graphNodes, graphEdges);
      if (errors.length > 0) {
        return NextResponse.json({ errors }, { status: 400 });
      }
    }
  }

  try {
    const flow = await prisma.flow.update({
      where: { id: flowId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.isMarketing !== undefined && { isMarketing: data.isMarketing }),
        ...(data.anchorMode !== undefined && { anchorMode: data.anchorMode }),
        ...(data.status !== undefined && { status: data.status }),
      },
    });
    let wokenEnrollments = 0;
    if (data.sendWindow !== undefined) {
      const previous = await getFlowSendWindowState(flowId).catch(() => null);
      await saveFlowSendWindowOverride(flowId, data.sendWindow);
      // Løp parkert til forrige sendetid vurderes på nytt — ellers venter de på det gamle vinduet.
      if (previous && !sameSendWindow(previous.effective, resolveEffectiveSendWindow(previous.global, data.sendWindow))) {
        wokenEnrollments = await wakeSendWindowParked(flowId, previous.effective).catch((error) => {
          logger.error('Kunne ikke vekke parkerte løp etter ny sendetid', {
            flowId, error: error instanceof Error ? error.message : String(error),
          });
          return 0;
        });
      }
    }

    // Arkivert er terminal — ingen kontakter skal bli stående «aktive» i en død flyt.
    const exitedEnrollments =
      data.status === 'archived' && existing?.status !== 'archived'
        ? await exitActiveEnrollments({ flowId })
        : 0;

    logActivity({
      action: 'update',
      entity: 'flow',
      entityId: flow.id,
      details:
        exitedEnrollments > 0 || data.sendWindow !== undefined
          ? JSON.stringify({
              ...(exitedEnrollments > 0 && { status: 'archived', exitedEnrollments }),
              ...(data.sendWindow !== undefined && { sendWindow: data.sendWindow.mode, wokenEnrollments }),
            })
          : undefined,
      userEmail: session.user.email,
    }).catch(() => {});
    return NextResponse.json({
      flow,
      exitedEnrollments,
      ...(data.sendWindow !== undefined && { sendWindow: overrideToInput(data.sendWindow), wokenEnrollments }),
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2025' || error.code === 'P2003')
    ) {
      return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return NextResponse.json({ error: 'Duplikat: raden finnes allerede' }, { status: 409 });
    }
    throw error;
  }
}

export async function DELETE(
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

  const existing = await prisma.flow.findUnique({ where: { id: flowId }, select: { status: true } });
  if (!existing) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }
  if (!canDeleteStatus(existing.status)) {
    return NextResponse.json(
      { error: 'Kan bare slette maler og flyter med status kladd eller arkivert.' },
      { status: 409 },
    );
  }

  try {
    await prisma.flow.delete({ where: { id: flowId } });
    // En foreldreløs sendetid-rad er ufarlig (id-er gjenbrukes ikke) — slettingen skal ikke feile på den.
    await deleteFlowSendWindowOverride(flowId).catch(() => {});
    logActivity({
      action: 'delete',
      entity: 'flow',
      entityId: flowId,
      userEmail: session.user.email,
    }).catch(() => {});
    return NextResponse.json({ ok: true });
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
