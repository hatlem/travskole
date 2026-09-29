// Historikkimport: kjører CRM-broen over historiske bookinger og påmeldinger.
// Delt av admin-ruten (/api/admin/crm/backfill) og scripts/backfill-crm.ts.
// Idempotent — broen er nøklet på Deal.bookingRequestId/registrationId.
// Kjører sekvensielt med tidsbudsjett og markør, så admin-UI-et kan kalle
// igjen til alt er ferdig uten å treffe App Service-timeouten (~230 s).

import { prisma } from '@/lib/prisma';
import { syncBookingToCrm, syncRegistrationToCrm } from '@/lib/crm/bridge';

export type BackfillPhase = 'bookings' | 'registrations';
/** 'missing': kun rader uten deal. 'all': re-sync alt (scriptets oppførsel). */
export type BackfillMode = 'missing' | 'all';

export interface BackfillCursor {
  phase: BackfillPhase;
  afterId: number;
}

export interface BackfillProcessed {
  bookings: number;
  registrations: number;
  failed: number;
}

export interface BatchRunnerDeps {
  fetchIds(phase: BackfillPhase, afterId: number, take: number): Promise<number[]>;
  syncOne(phase: BackfillPhase, id: number): Promise<boolean>;
  now(): number;
}

export interface BatchRunnerOptions {
  cursor?: BackfillCursor | null;
  batchSize: number;
  /** Tidspunkt (ms) der kjøringen stopper og returnerer en markør. */
  deadline: number;
}

export interface BatchRunnerResult {
  done: boolean;
  cursor: BackfillCursor | null;
  processed: BackfillProcessed;
}

export const START_CURSOR: BackfillCursor = { phase: 'bookings', afterId: 0 };

/**
 * Går gjennom bookinger og så påmeldinger i ID-rekkefølge. Minst én rad
 * behandles per kall (garanterer fremdrift), deretter stoppes det ved
 * `deadline`. Markøren flyttes forbi rader som feiler, så en rad som alltid
 * feiler ikke gir evig løkke — den telles i `failed`.
 */
export async function runBackfillBatches(
  deps: BatchRunnerDeps,
  { cursor, batchSize, deadline }: BatchRunnerOptions,
): Promise<BatchRunnerResult> {
  let current: BackfillCursor = cursor ?? START_CURSOR;
  const processed: BackfillProcessed = { bookings: 0, registrations: 0, failed: 0 };
  let handled = 0;

  for (;;) {
    const ids = await deps.fetchIds(current.phase, current.afterId, batchSize);
    if (ids.length === 0) {
      if (current.phase === 'bookings') {
        current = { phase: 'registrations', afterId: 0 };
        continue;
      }
      return { done: true, cursor: null, processed };
    }

    for (const id of ids) {
      if (handled > 0 && deps.now() >= deadline) {
        return { done: false, cursor: current, processed };
      }
      const ok = await deps.syncOne(current.phase, id);
      processed[current.phase] += 1;
      if (!ok) processed.failed += 1;
      current = { phase: current.phase, afterId: id };
      handled += 1;
    }
  }
}

async function fetchIds(mode: BackfillMode, phase: BackfillPhase, afterId: number, take: number): Promise<number[]> {
  if (mode === 'all') {
    const rows = phase === 'bookings'
      ? await prisma.bookingRequest.findMany({ where: { id: { gt: afterId } }, select: { id: true }, orderBy: { id: 'asc' }, take })
      : await prisma.registration.findMany({ where: { id: { gt: afterId } }, select: { id: true }, orderBy: { id: 'asc' }, take });
    return rows.map((r) => r.id);
  }
  // Bookinger uten kurs hoppes over av broen — tas ikke med her heller.
  const rows = phase === 'bookings'
    ? await prisma.$queryRaw<{ id: number }[]>`
        SELECT b.id FROM booking_requests b
        WHERE b.id > ${afterId} AND b.course_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.booking_request_id = b.id)
        ORDER BY b.id LIMIT ${take}`
    : await prisma.$queryRaw<{ id: number }[]>`
        SELECT r.id FROM registrations r
        WHERE r.id > ${afterId}
          AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.registration_id = r.id)
        ORDER BY r.id LIMIT ${take}`;
  return rows.map((r) => Number(r.id));
}

/** Antall bookinger/påmeldinger som ennå ikke har en deal i CRM. */
export async function countMissingCrmDeals(): Promise<{ bookings: number; registrations: number }> {
  const [bookings, registrations] = await Promise.all([
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM booking_requests b
      WHERE b.course_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.booking_request_id = b.id)`,
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM registrations r
      WHERE NOT EXISTS (SELECT 1 FROM deals d WHERE d.registration_id = r.id)`,
  ]);
  return { bookings: Number(bookings[0]?.count ?? 0), registrations: Number(registrations[0]?.count ?? 0) };
}

export interface BackfillOptions {
  mode: BackfillMode;
  cursor?: BackfillCursor | null;
  batchSize?: number;
  /** Tidsbudsjett i ms. Utelatt = kjør til ferdig. */
  timeBudgetMs?: number;
}

export interface BackfillResult extends BatchRunnerResult {
  totals: { contacts: number; organizations: number; deals: number };
}

export async function backfillCrm({ mode, cursor, batchSize = 50, timeBudgetMs }: BackfillOptions): Promise<BackfillResult> {
  const result = await runBackfillBatches(
    {
      fetchIds: (phase, afterId, take) => fetchIds(mode, phase, afterId, take),
      // Historikkimporten skal ikke gjenåpne deals som er flyttet til vunnet/tapt.
      syncOne: (phase, id) => phase === 'bookings'
        ? syncBookingToCrm(id, { allowReopen: false })
        : syncRegistrationToCrm(id, { allowReopen: false }),
      now: () => Date.now(),
    },
    {
      cursor,
      batchSize,
      deadline: timeBudgetMs === undefined ? Number.POSITIVE_INFINITY : Date.now() + timeBudgetMs,
    },
  );
  const [contacts, organizations, deals] = await Promise.all([
    prisma.contact.count(), prisma.organization.count(), prisma.deal.count(),
  ]);
  return { ...result, totals: { contacts, organizations, deals } };
}
