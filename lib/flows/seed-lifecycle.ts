/**
 * Idempotent seed av den delte «Kurs-livssyklus»-flyten (delprosjekt B, Model 1).
 * Lineær schedule→email-kjede i kronologisk ankerrekkefølge. Seedes som draft —
 * admin aktiverer når klar. No-op hvis flyten allerede finnes.
 */
import { prisma } from '@/lib/prisma';
import { LIFECYCLE_STEPS } from './templates/lifecycle-steps';

export const LIFECYCLE_FLOW_NAME = 'Kurs-livssyklus';

export async function seedCourseLifecycleFlow(): Promise<{ created: boolean; flowId: number }> {
  const existing = await prisma.flow.findFirst({ where: { name: LIFECYCLE_FLOW_NAME, anchorMode: 'course' }, select: { id: true } });
  if (existing) return { created: false, flowId: existing.id };

  const sender = await prisma.senderIdentity.findFirst({ where: { active: true }, select: { id: true } });
  if (!sender) throw new Error('Kan ikke seede livssyklus-flyten: ingen aktiv avsender-identitet (SenderIdentity) funnet.');

  const flowId = await prisma.$transaction(async (tx) => {
    const flow = await tx.flow.create({
      data: { name: LIFECYCLE_FLOW_NAME, description: 'Automatiske kurs-livssyklus-e-poster (delprosjekt B).', anchorMode: 'course', isMarketing: false, status: 'draft' },
    });
    await tx.flowTrigger.create({ data: { flowId: flow.id, eventType: 'registration.created', filter: '{}' } });

    // Bygg noder: start → (schedule,email)×4 → end. posY øker for lesbar layout.
    const startNode = await tx.flowNode.create({ data: { flowId: flow.id, type: 'start', config: '{}', posX: 0, posY: 0 } });
    const chain: number[] = [startNode.id];
    let y = 120;
    for (const step of LIFECYCLE_STEPS) {
      const sched = await tx.flowNode.create({ data: { flowId: flow.id, type: 'schedule', config: JSON.stringify({ anchor: step.anchor, offsetDays: step.offsetDays }), posX: 0, posY: y } });
      y += 120;
      const email = await tx.flowNode.create({ data: { flowId: flow.id, type: 'email', config: JSON.stringify({ subject: step.subject, bodyHtml: step.bodyHtml, senderIdentityId: sender.id }), posX: 0, posY: y } });
      y += 120;
      chain.push(sched.id, email.id);
    }
    const endNode = await tx.flowNode.create({ data: { flowId: flow.id, type: 'end', config: '{}', posX: 0, posY: y } });
    chain.push(endNode.id);

    await tx.flowEdge.createMany({
      data: chain.slice(0, -1).map((fromNodeId, i) => ({ flowId: flow.id, fromNodeId, toNodeId: chain[i + 1], branch: null })),
    });

    return flow.id;
  });

  return { created: true, flowId };
}
