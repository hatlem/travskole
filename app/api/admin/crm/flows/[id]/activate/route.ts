import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { AWAITING_ACTIVATION_RUN_AT } from '@/lib/flows/awaiting-activation';
import { logActivity } from '@/lib/activity';
import { isTemplateStatus } from '@/lib/flows/status';
import { parseNodeConfig, validateFlow, type GraphEdge, type GraphNode } from '@/lib/flows/graph';

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

  const flow = await prisma.flow.findUnique({
    where: { id: flowId },
    include: { nodes: true, edges: true },
  });
  if (!flow) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }
  // draft -> active is only legal through this endpoint (see PATCH's status
  // transition matrix); everything else (already active/paused/archived)
  // must go through PATCH or is simply not a valid activation target.
  if (isTemplateStatus(flow.status)) {
    return NextResponse.json(
      { error: 'En mal kan ikke aktiveres — lag en ny flyt fra malen.' },
      { status: 409 },
    );
  }
  if (flow.status !== 'draft') {
    return NextResponse.json(
      { error: 'Bare flyter med status kladd kan aktiveres her.' },
      { status: 409 },
    );
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

  // Deliberately no trigger requirement here: a flow with zero FlowTrigger
  // rows is still legal — it can only be entered via manual enrollment, and
  // that is a valid use case (e.g. an ad-hoc nurture sequence a CRM user
  // enrolls contacts into by hand rather than one driven by an event).
  const updated = await prisma.flow.update({
    where: { id: flowId },
    data: { status: 'active' },
  });
  // Personer lagt til mens flyten var et utkast, starter nå.
  const started = await prisma.flowEnrollment.updateMany({
    where: { flowId, status: 'active', currentNodeId: null, nextRunAt: { gte: AWAITING_ACTIVATION_RUN_AT } },
    data: { nextRunAt: new Date() },
  });

  logActivity({
    action: 'activate',
    entity: 'flow',
    entityId: flowId,
    userEmail: session.user.email,
    ...(started.count > 0 && { details: JSON.stringify({ startedEnrollments: started.count }) }),
  }).catch(() => {});
  return NextResponse.json({ flow: updated, startedEnrollments: started.count });
}
