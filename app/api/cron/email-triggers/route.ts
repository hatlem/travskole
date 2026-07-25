import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/prisma';
import { getSetting } from '@/lib/settings';
import { shouldAnonymizeChild } from '@/lib/retention';
import logger from '@/lib/logger';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization') ?? '';
  const cronSecret = process.env.CRON_SECRET;

  // SECURITY: fail closed + constant-time comparison
  const expected = cronSecret ? `Bearer ${cronSecret}` : null;
  const authorized =
    expected !== null &&
    authHeader.length === expected.length &&
    timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected));
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    let errors = 0;

    // ── GDPR retention pass (AV som standard) ─────────────────────────────
    // `data_retention_days = 0` → ingen automatisk sletting. Dette er bevisst:
    // familier skal kunne logge inn år etter år og gjenbruke informasjonen sin
    // (gjengangere). Persondata beholdes så lenge kundeforholdet er aktivt;
    // sletting skjer KUN på forespørsel (deletedAt) — den flyten er upåvirket.
    // Settes til et positivt antall dager BARE hvis dere senere ønsker en
    // tidsbasert anonymisering av barns data (navn/fødselsdato/allergier).
    let anonymized = 0;
    const retentionDays =
      parseInt((await getSetting('data_retention_days')) || '0', 10) || 0;

    if (retentionDays > 0) {
      const retentionCandidates = await prisma.child.findMany({
        where: { deletedAt: null },
        include: {
          registrations: {
            include: { course: { select: { startDate: true, endDate: true } } },
          },
        },
      });

      const retentionNow = new Date();
      for (const child of retentionCandidates) {
        if (!shouldAnonymizeChild(child, retentionNow, retentionDays)) {
          continue;
        }
        try {
          // OVERSKRIVER EKTE DATA — kjøres kun når admin har satt retentionDays > 0.
          await prisma.child.update({
            where: { id: child.id },
            data: {
              name: '[slettet]',
              birthdate: null,
              allergies: null,
              deletedAt: new Date(),
            },
          });
          anonymized++;
        } catch (error) {
          logger.error(`Retention anonymize error for child ${child.id}`, { error });
          errors++;
        }
      }
    }

    // ── GDPR anonymous visitor purge ────────────────────────────────────
    // Delete anonymous visitors (no contactId) and their events after 180 days,
    // plus fully orphaned anonymous events. Stitched history (contactId set on events)
    // is never purged. Stale visitor rows with stitched events will be deleted
    // (events survive with visitorId set NULL by FK constraint).
    const ANON_RETENTION_DAYS = 180;
    const cutoff = new Date(Date.now() - ANON_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    try {
      const staleVisitors = await prisma.visitor.findMany({
        where: { contactId: null, lastSeenAt: { lt: cutoff } },
        select: { id: true },
      });
      if (staleVisitors.length > 0) {
        const ids = staleVisitors.map((v) => v.id);
        const deletedEvents = await prisma.appEvent.deleteMany({
          where: { visitorId: { in: ids }, contactId: null },
        });
        const deletedVisitors = await prisma.visitor.deleteMany({ where: { id: { in: ids } } });
        logger.info(
          `Retensjon: slettet ${deletedVisitors.count} anonyme besøkende og ${deletedEvents.count} hendelser`
        );
      }
      // Fully orphaned anonymous events (neither contactId nor visitorId)
      await prisma.appEvent.deleteMany({
        where: { contactId: null, visitorId: null, occurredAt: { lt: cutoff } },
      });
    } catch (error) {
      logger.error('Retensjons-purge feilet', { error });
    }

    return NextResponse.json(
      { anonymized },
      { status: errors > 0 ? 500 : 200 },
    );
  } catch (error) {
    logger.error('Cron GDPR-pass feilet', { error });
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 });
  }
}
