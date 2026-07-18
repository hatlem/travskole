import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { getLLMProvider } from '@/lib/ai/provider';
import { validateAiRewrite } from '@/lib/ai/guardrails';
import { generateFlowPrompt, parseFlowOutline, buildGraphFromOutline } from '@/lib/ai/generate-flow';
import { validateFlow, type GraphEdge, type GraphNode } from '@/lib/flows/graph';
import { MERGE_TAGS } from '@/lib/email-templates';

const schema = z.object({
  goal: z.string().min(10, 'Beskriv målet (minst 10 tegn)').max(1000),
  emailCount: z.number().int().min(1).max(5),
  senderIdentityId: z.number().int().positive(),
});

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { goal, emailCount, senderIdentityId } = parsed.data;

  const identity = await prisma.senderIdentity.findUnique({ where: { id: senderIdentityId } });
  if (!identity?.active) return NextResponse.json({ error: 'Ugyldig avsenderidentitet' }, { status: 400 });

  const provider = getLLMProvider();
  if (!provider) return NextResponse.json({ error: 'KI er ikke konfigurert' }, { status: 503 });

  const raw = await provider.generateText(generateFlowPrompt(goal, emailCount), { maxTokens: 4000, temperature: 0.7 });
  if (!raw) return NextResponse.json({ error: 'KI-tjenesten svarte ikke — prøv igjen' }, { status: 502 });

  const outline = parseFlowOutline(raw);
  if (!outline) return NextResponse.json({ error: 'KI-svaret kunne ikke tolkes — prøv igjen' }, { status: 422 });

  // Guardrails per generert e-post: tom baseline ⇒ ingen lenker/priser/datoer
  // i det hele tatt; kjente merge-tagger er tillatt.
  const allowedTags = MERGE_TAGS.map((t) => t.tag);
  for (const node of outline.nodes) {
    if (node.type !== 'email') continue;
    const bodyVerdict = validateAiRewrite('', node.bodyHtml, { allowedNewTags: allowedTags });
    const subjectVerdict = validateAiRewrite('', node.subject, { allowedNewTags: allowedTags });
    if (!bodyVerdict.ok || !subjectVerdict.ok) {
      return NextResponse.json({ error: 'KI-forslaget ble avvist av sikkerhetskontrollen — prøv igjen' }, { status: 422 });
    }
  }

  const built = buildGraphFromOutline(outline, senderIdentityId);
  const graphNodes: GraphNode[] = built.nodes.map((n) => ({ id: n.tempId, type: n.type as GraphNode['type'], config: n.config }));
  const graphEdges: GraphEdge[] = built.edges.map((e, i) => ({ id: i + 1, fromNodeId: e.fromTempId, toNodeId: e.toTempId, branch: e.branch }));
  const errors = validateFlow(graphNodes, graphEdges);
  if (errors.length > 0) {
    return NextResponse.json({ error: 'KI-svaret ga en ugyldig flyt — prøv igjen' }, { status: 422 });
  }

  const flow = await prisma.$transaction(async (tx) => {
    const created = await tx.flow.create({
      data: { name: outline.name, description: `KI-generert fra mål: ${goal}`, status: 'draft', isMarketing: true },
    });
    const tempToReal = new Map<number, number>();
    for (const node of built.nodes) {
      const row = await tx.flowNode.create({
        data: { flowId: created.id, type: node.type, config: JSON.stringify(node.config), posX: node.posX, posY: node.posY },
      });
      tempToReal.set(node.tempId, row.id);
    }
    for (const edge of built.edges) {
      await tx.flowEdge.create({
        data: { flowId: created.id, fromNodeId: tempToReal.get(edge.fromTempId)!, toNodeId: tempToReal.get(edge.toTempId)!, branch: edge.branch },
      });
    }
    return created;
  });

  logActivity({ action: 'create', entity: 'flow', entityId: flow.id, details: JSON.stringify({ aiGenerated: true }), userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ flowId: flow.id }, { status: 201 });
}
