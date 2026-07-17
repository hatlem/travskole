// Hendelsesbussens motor. Samme garanti som CRM-broen: en feil her får
// ALDRI knekke et offentlig flyt — alt fanges og logges.

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';
import { isEventType, timelineTitle, type EventType } from '@/lib/events/taxonomy';
import { planStitch } from '@/lib/events/stitch';
import { VISITOR_COOKIE } from '@/lib/events/constants';

export { VISITOR_COOKIE };

export interface EmitEventInput {
  type: string;
  source: 'server' | 'client' | 'webhook';
  contactId?: number | null;
  visitorId?: number | null;
  meta?: Record<string, unknown>;
  dedupeKey?: string;
  occurredAt?: Date;
}

export async function emitEvent(input: EmitEventInput): Promise<void> {
  try {
    if (!isEventType(input.type)) {
      logger.warn(`emitEvent: ukjent hendelsestype avvist: ${input.type}`);
      return;
    }

    try {
      await prisma.appEvent.create({
        data: {
          type: input.type,
          source: input.source,
          contactId: input.contactId ?? null,
          visitorId: input.visitorId ?? null,
          meta: JSON.stringify(input.meta ?? {}),
          dedupeKey: input.dedupeKey ?? null,
          occurredAt: input.occurredAt ?? new Date(),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return; // dedup — hendelsen finnes allerede, idempotent no-op
      }
      throw error;
    }

    // Best-effort-bivirkninger etter innsettingen.
    const now = input.occurredAt ?? new Date();
    if (input.contactId) {
      await prisma.contact
        .update({ where: { id: input.contactId }, data: { lastActivityAt: now } })
        .catch(() => {});

      const title = timelineTitle(input.type as EventType, input.meta ?? {});
      if (title) {
        await prisma.contactActivity
          .create({
            data: {
              contactId: input.contactId,
              type: 'event',
              title,
              meta: JSON.stringify(input.meta ?? {}),
              occurredAt: now,
            },
          })
          .catch(() => {});
      }
    }
    if (input.visitorId) {
      await prisma.visitor
        .update({ where: { id: input.visitorId }, data: { lastSeenAt: now } })
        .catch(() => {});
    }

    // Best-effort flow-enrollment hook. Dynamic import avoids a static
    // bus → flows → bus cycle; `.catch(() => {})` on top of enrollFromEvent's
    // own internal try/catch means a bug here can never break event emission.
    if (input.contactId) {
      const contactId = input.contactId;
      await import('@/lib/flows/enroll')
        .then(({ enrollFromEvent }) =>
          enrollFromEvent({ type: input.type, contactId, meta: input.meta ?? {} }),
        )
        .catch(() => {});
    }
  } catch (error) {
    logger.error('emitEvent feilet', error);
  }
}

/**
 * Kobler en anonym Visitor (via bjerke_vid publicId) til en Contact og
 * re-attribuerer besøkendes anonyme hendelser til kontakten.
 * Første identifisering vinner; fire-safe.
 */
export async function stitchVisitorToContact(
  publicId: string | null | undefined,
  contactId: number
): Promise<void> {
  try {
    if (!publicId) return;
    const visitor = await prisma.visitor.findUnique({
      where: { publicId },
      select: { id: true, contactId: true },
    });
    const plan = planStitch(visitor, contactId);
    if (!plan.link) return;

    await prisma.visitor.update({
      where: { id: plan.visitorId },
      data: { contactId: plan.contactId },
    });
    await prisma.appEvent.updateMany({
      where: { visitorId: plan.visitorId, contactId: null },
      data: { contactId: plan.contactId },
    });
  } catch (error) {
    logger.error('stitchVisitorToContact feilet', error);
  }
}
