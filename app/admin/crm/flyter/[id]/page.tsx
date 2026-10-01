import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { parseNodeConfig, type FlowNodeType } from '@/lib/flows/graph';
import { ensureSenderIdentitiesSeeded } from '@/lib/crm/sender-identities';
import { FlowEditor } from './flow-editor';
import { BreadcrumbLabel } from '@/components/admin/BreadcrumbLabel';

/** Tolerant JSON parse for trigger filters: garbage/non-object JSON becomes {}. */
function parseFilter(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export default async function FlyterEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const flowId = Number(id);
  if (!Number.isInteger(flowId)) {
    notFound();
  }

  await ensureSenderIdentitiesSeeded();

  const [flow, senderIdentities, segments, lists, courses, adminUsers, activeEnrollments] = await Promise.all([
    prisma.flow.findUnique({
      where: { id: flowId },
      include: {
        nodes: { orderBy: { id: 'asc' } },
        edges: { orderBy: { id: 'asc' } },
        triggers: { orderBy: { id: 'asc' } },
      },
    }),
    prisma.senderIdentity.findMany({ where: { active: true }, orderBy: { id: 'asc' } }),
    prisma.segment.findMany({ orderBy: { name: 'asc' } }),
    prisma.contactList.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.course.findMany({
      orderBy: [{ startDate: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      select: { id: true, name: true, slug: true, startDate: true },
    }),
    prisma.user.findMany({
      where: { role: { in: ['admin', 'superadmin'] }, deactivatedAt: null, anonymizedAt: null },
      orderBy: { email: 'asc' },
      select: { id: true, email: true },
    }),
    prisma.flowEnrollment.count({ where: { flowId, status: 'active' } }),
  ]);

  if (!flow) {
    notFound();
  }

  return (
    <>
      <BreadcrumbLabel label={flow.name} />
      <FlowEditor
        flow={{
          id: flow.id,
          name: flow.name,
          description: flow.description,
          status: flow.status,
          isMarketing: flow.isMarketing,
          anchorMode: flow.anchorMode,
        }}
        initialNodes={flow.nodes.map((node) => ({
          id: node.id,
          type: node.type as FlowNodeType,
          config: parseNodeConfig(node.config),
          posX: node.posX,
          posY: node.posY,
        }))}
        initialEdges={flow.edges.map((edge) => ({
          id: edge.id,
          fromNodeId: edge.fromNodeId,
          toNodeId: edge.toNodeId,
          branch: edge.branch,
        }))}
        initialTriggers={flow.triggers.map((trigger) => ({
          id: trigger.id,
          eventType: trigger.eventType,
          filter: parseFilter(trigger.filter),
        }))}
        senderIdentities={senderIdentities.map((identity) => ({
          id: identity.id,
          email: identity.email,
          displayName: identity.displayName,
        }))}
        segments={segments.map((segment) => ({ id: segment.id, name: segment.name }))}
        lists={lists}
        courses={courses.map((course) => ({
          id: course.id,
          name: course.name,
          slug: course.slug,
          startDate: course.startDate ? course.startDate.toISOString() : null,
        }))}
        adminUsers={adminUsers}
        initialActiveEnrollments={activeEnrollments}
      />
    </>
  );
}
