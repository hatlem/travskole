/**
 * Idempotent seed av den delte «Kurs-livssyklus»-flyten (delprosjekt B, Model 1).
 * Lineær schedule→email-kjede i kronologisk ankerrekkefølge. Seedes som draft —
 * admin aktiverer når klar. No-op hvis flyten allerede finnes.
 */
import { prisma } from '@/lib/prisma';

const FLOW_NAME = 'Kurs-livssyklus';

// [anker, offsetDays, emne, kropp] i kronologisk rekkefølge.
const STEPS: { anchor: string; offsetDays: number; subject: string; bodyHtml: string }[] = [
  { anchor: 'course_start', offsetDays: -3, subject: 'Påminnelse: {{kurs_navn}} starter snart',
    bodyHtml: '<p>Hei {{forelder_navn}},</p><p>Vi minner om at {{kurs_navn}} starter {{kurs_startdato}}. Vi gleder oss til å se {{barnets_navn}}!</p>' },
  { anchor: 'course_start', offsetDays: 0, subject: 'Velkommen til {{kurs_navn}}',
    bodyHtml: '<p>Hei {{forelder_navn}},</p><p>I dag starter {{kurs_navn}}. Velkommen! Gi oss beskjed ved allergier: {{allergier}}.</p>' },
  { anchor: 'course_midway', offsetDays: 0, subject: 'Halvveis i {{kurs_navn}}',
    bodyHtml: '<p>Hei {{forelder_navn}},</p><p>{{barnets_navn}} er nå halvveis i {{kurs_navn}}. Håper det går bra!</p>' },
  { anchor: 'course_end', offsetDays: 1, subject: 'Takk for deltakelsen på {{kurs_navn}}',
    bodyHtml: '<p>Hei {{forelder_navn}},</p><p>Takk for at {{barnets_navn}} deltok på {{kurs_navn}}. Vi håper å se dere igjen!</p>' },
];

export async function seedCourseLifecycleFlow(): Promise<{ created: boolean; flowId: number }> {
  const existing = await prisma.flow.findFirst({ where: { name: FLOW_NAME, anchorMode: 'course' }, select: { id: true } });
  if (existing) return { created: false, flowId: existing.id };

  const sender = await prisma.senderIdentity.findFirst({ where: { active: true }, select: { id: true } });
  if (!sender) throw new Error('Kan ikke seede livssyklus-flyten: ingen aktiv avsender-identitet (SenderIdentity) funnet.');

  const flowId = await prisma.$transaction(async (tx) => {
    const flow = await tx.flow.create({
      data: { name: FLOW_NAME, description: 'Automatiske kurs-livssyklus-e-poster (delprosjekt B).', anchorMode: 'course', isMarketing: false, status: 'draft' },
    });
    await tx.flowTrigger.create({ data: { flowId: flow.id, eventType: 'registration.created', filter: '{}' } });

    // Bygg noder: start → (schedule,email)×4 → end. posY øker for lesbar layout.
    const startNode = await tx.flowNode.create({ data: { flowId: flow.id, type: 'start', config: '{}', posX: 0, posY: 0 } });
    const chain: number[] = [startNode.id];
    let y = 120;
    for (const step of STEPS) {
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
