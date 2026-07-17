/**
 * Enrollment DB layer for the flow engine.
 *
 * `enrollFromEvent` is the fire-safe entrypoint called (best-effort) from the
 * event bus — it never throws, so a bug here can never break the request
 * that emitted the event. `enrollContact` and `enrollSegment` are used by the
 * admin API and are allowed to throw (the API layer decides how to surface
 * that to the caller).
 */

import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';
import { matchTriggers, type EventLike } from './match';
import { contactMatchesSegment, parseSegmentRules } from '@/lib/crm/segments';
import { parseJsonArray } from '@/lib/crm/normalize';

const SEGMENT_ENROLL_CAP = 500;

async function hasActiveEnrollment(flowId: number, contactId: number): Promise<boolean> {
  const existing = await prisma.flowEnrollment.findFirst({
    where: { flowId, contactId, status: 'active' },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Enrolls a single contact into a flow, unless an active enrollment for the
 * same (flowId, contactId) pair already exists. Returns whether a new
 * enrollment was created.
 */
export async function enrollContact(flowId: number, contactId: number): Promise<boolean> {
  if (await hasActiveEnrollment(flowId, contactId)) return false;
  await prisma.flowEnrollment.create({
    data: {
      flowId,
      contactId,
      currentNodeId: null,
      status: 'active',
      nextRunAt: new Date(),
    },
  });
  return true;
}

/**
 * Evaluates a segment's rules against all contacts and enrolls the matches
 * into the given flow (same active-enrollment guard as `enrollContact`).
 * Capped at 500 contacts per call. Returns the number of enrollments
 * actually created (already-enrolled matches don't count).
 */
export async function enrollSegment(flowId: number, segmentId: number): Promise<number> {
  const segment = await prisma.segment.findUnique({ where: { id: segmentId } });
  if (!segment) return 0;

  const rules = parseSegmentRules(segment.rules);
  const contacts = await prisma.contact.findMany({
    include: { deals: { select: { eventType: true, eventDate: true, status: true } } },
  });

  const matched = contacts
    .filter((contact) =>
      contactMatchesSegment(
        {
          stage: contact.stage,
          source: contact.source,
          email: contact.email,
          organizationId: contact.organizationId,
          lastActivityAt: contact.lastActivityAt,
          tags: parseJsonArray(contact.tags),
          deals: contact.deals,
        },
        rules,
      ),
    )
    .slice(0, SEGMENT_ENROLL_CAP);

  let created = 0;
  for (const contact of matched) {
    if (await enrollContact(flowId, contact.id)) created++;
  }
  return created;
}

/**
 * Fire-safe event hook: matches an incoming bus event against the triggers
 * of all active flows and enrolls the contact into each match. Never throws
 * — any failure is logged and swallowed so the bus can call this best-effort.
 */
export async function enrollFromEvent(input: {
  type: string;
  contactId: number | null;
  meta: Record<string, unknown>;
}): Promise<void> {
  try {
    if (!input.contactId) return;
    const contactId = input.contactId;

    const triggers = await prisma.flowTrigger.findMany({
      where: { flow: { status: 'active' } },
      select: { flowId: true, eventType: true, filter: true },
    });

    const event: EventLike = { type: input.type, meta: input.meta };
    const matchedFlowIds = matchTriggers(event, triggers);

    for (const flowId of matchedFlowIds) {
      await enrollContact(flowId, contactId);
    }
  } catch (error) {
    logger.error('enrollFromEvent feilet', error);
  }
}
