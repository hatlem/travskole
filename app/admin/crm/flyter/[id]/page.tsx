import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { parseNodeConfig, type FlowNodeType } from '@/lib/flows/graph';
import { ensureSenderIdentitiesSeeded } from '@/lib/crm/sender-identities';
import { FlowEditor } from './flow-editor';

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

  const [flow, senderIdentities, segments] = await Promise.all([
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
  ]);

  if (!flow) {
    notFound();
  }

  return (
    <FlowEditor
      flow={{
        id: flow.id,
        name: flow.name,
        description: flow.description,
        status: flow.status,
        isMarketing: flow.isMarketing,
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
    />
  );
}
