import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { cloneFlow, FLOW_NAME_MAX } from '@/lib/flows/clone';

// target 'template' = «Lagre som mal», target 'draft' = «Ny flyt fra mal» / dupliser.
const cloneSchema = z.object({
  target: z.enum(['template', 'draft']),
  name: z.string().trim().max(FLOW_NAME_MAX).optional(),
});

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

  const parsed = cloneSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { target, name } = parsed.data;

  const copy = await cloneFlow(prisma, flowId, { status: target, name });
  if (!copy) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }

  logActivity({
    action: target === 'template' ? 'save_as_template' : 'create_from_flow',
    entity: 'flow',
    entityId: copy.id,
    details: JSON.stringify({ sourceFlowId: flowId }),
    userEmail: session.user.email,
  }).catch(() => {});
  return NextResponse.json({ flow: copy }, { status: 201 });
}
