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
  // 'web' = nettleser-hendelser via /api/track; 'client' finnes i eldre rader.
  source: 'server' | 'web' | 'client' | 'webhook';
  contactId?: number | null;
  visitorId?: number | null;
  meta?: Record<string, unknown>;
  dedupeKey?: string;
  occurredAt?: Date;
  /** false = hendelsen er ikke kontaktens egen aktivitet (listeendring, import) og flytter ikke «Sist aktiv». */
  touchActivity?: boolean;
}

/** true kun når hendelsen faktisk ble lagret nå (ikke dedup-treff, avvist eller feilet). */
export async function emitEvent(input: EmitEventInput): Promise<boolean> {
  let inserted = false;
  try {
    if (!isEventType(input.type)) {
      logger.warn(`emitEvent: ukjent hendelsestype avvist: ${input.type}`);
      return false;
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
        return false; // dedup — hendelsen finnes allerede, idempotent no-op
      }
      throw error;
    }
    inserted = true;

    // Best-effort-bivirkninger etter innsettingen.
    const now = input.occurredAt ?? new Date();
    if (input.contactId) {
      if (input.touchActivity !== false) {
        await prisma.contact
          .update({ where: { id: input.contactId }, data: { lastActivityAt: now } })
          .catch(() => {});
      }

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
  return inserted;
}

export type BulkEventInput = Omit<EmitEventInput, 'contactId' | 'visitorId' | 'dedupeKey'> & {
  contactId: number;
  dedupeKey: string;
};

export const BULK_EVENT_CHUNK = 500;

/**
 * Mange kontakt-hendelser på én gang (listeendringer, import): innsetting,
 * tidslinje og flyt-innmelding i biter på BULK_EVENT_CHUNK, med flyt-utløserne
 * lastet én gang. Samme dedup-semantikk som emitEvent: en hendelse som finnes
 * fra før (dedupeKey) gir ingen bivirkninger. Kaster aldri; returnerer
 * hendelsene som faktisk ble lagret nå.
 */
export async function emitEvents(inputs: BulkEventInput[]): Promise<BulkEventInput[]> {
  const valid = inputs.filter((input) => {
    if (isEventType(input.type)) return true;
    logger.warn(`emitEvents: ukjent hendelsestype avvist: ${input.type}`);
    return false;
  });
  if (valid.length === 0) return [];

  const enroll = await import('@/lib/flows/enroll').catch(() => null);
  const triggers = enroll ? await enroll.loadActiveTriggers().catch(() => null) : null;
  const inserted: BulkEventInput[] = [];

  for (let start = 0; start < valid.length; start += BULK_EVENT_CHUNK) {
    const chunk = valid.slice(start, start + BULK_EVENT_CHUNK);
    try {
      const fresh = await insertChunk(chunk);
      if (fresh.length === 0) continue;
      inserted.push(...fresh);
      await bulkSideEffects(fresh);
      if (enroll && triggers) {
        await enroll
          .enrollFromEvents(fresh.map((e) => ({ type: e.type, contactId: e.contactId, meta: e.meta ?? {} })), triggers)
          .catch(() => {});
      }
    } catch (error) {
      logger.error('emitEvents feilet for en bit', error);
    }
  }
  return inserted;
}

async function insertChunk(chunk: BulkEventInput[]): Promise<BulkEventInput[]> {
  const now = new Date();
  const rows = await prisma.appEvent.createManyAndReturn({
    data: chunk.map((input) => ({
      type: input.type,
      source: input.source,
      contactId: input.contactId,
      meta: JSON.stringify(input.meta ?? {}),
      dedupeKey: input.dedupeKey,
      occurredAt: input.occurredAt ?? now,
    })),
    skipDuplicates: true,
    select: { dedupeKey: true, occurredAt: true },
  });
  const occurredAtByKey = new Map(rows.map((row) => [row.dedupeKey, row.occurredAt]));
  const seen = new Set<string>();
  return chunk.flatMap((input) => {
    const occurredAt = occurredAtByKey.get(input.dedupeKey);
    if (!occurredAt || seen.has(input.dedupeKey)) return [];
    seen.add(input.dedupeKey);
    return [{ ...input, occurredAt }];
  });
}

async function bulkSideEffects(events: BulkEventInput[]): Promise<void> {
  const touchedAt = new Map<number, Date>();
  for (const e of events) {
    if (e.touchActivity === false) continue;
    const at = e.occurredAt!;
    const current = touchedAt.get(e.contactId);
    if (!current || at > current) touchedAt.set(e.contactId, at);
  }
  const byTime = new Map<number, number[]>();
  for (const [contactId, at] of touchedAt) {
    const ids = byTime.get(at.getTime());
    if (ids) ids.push(contactId);
    else byTime.set(at.getTime(), [contactId]);
  }
  for (const [time, ids] of byTime) {
    await prisma.contact
      .updateMany({ where: { id: { in: ids } }, data: { lastActivityAt: new Date(time) } })
      .catch(() => {});
  }

  const timeline = events.flatMap((e) => {
    const title = timelineTitle(e.type as EventType, e.meta ?? {});
    return title
      ? [{ contactId: e.contactId, type: 'event', title, meta: JSON.stringify(e.meta ?? {}), occurredAt: e.occurredAt! }]
      : [];
  });
  if (timeline.length > 0) {
    await prisma.contactActivity.createMany({ data: timeline }).catch(() => {});
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
