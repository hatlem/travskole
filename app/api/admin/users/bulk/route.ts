import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { validateAccountAction } from '@/lib/user-admin';
import { countActiveSuperadmins } from '@/lib/account-anonymize';
import logger from '@/lib/logger';

const bulkSchema = z.object({
  ids: z.array(z.number().int()).min(1, 'Velg minst én bruker').max(200),
  action: z.enum(['deactivate', 'reactivate']),
});

/**
 * Deaktiver eller reaktiver flere brukere i én operasjon.
 *
 * Hver bruker går gjennom de samme vaktene som enkeltendepunktet
 * (validateAccountAction): rollehierarki, ingen selv-deaktivering, og vern av
 * den siste superadminen. En bruker som ikke passerer hoppes over og
 * rapporteres tilbake — resten går gjennom, slik at én sperret rad ikke velter
 * hele jobben.
 *
 * Anonymisering er bevisst IKKE med: den er irreversibel og bør gjøres én av
 * gangen, med bekreftelsen som hører til.
 */
export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const actorRole = session.user.role;
  const actorId = Number(session.user.id);

  try {
    const parsed = bulkSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Ugyldige felter' },
        { status: 400 }
      );
    }
    const { ids, action } = parsed.data;

    const targets = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, email: true, role: true, deactivatedAt: true, anonymizedAt: true },
    });

    const activeSuperadmins = await countActiveSuperadmins();
    const skipped: { id: number; error: string }[] = [];
    const allowed: number[] = [];

    for (const target of targets) {
      if (target.anonymizedAt) {
        skipped.push({ id: target.id, error: 'Anonymiserte kontoer kan ikke endres' });
        continue;
      }

      const err = validateAccountAction(
        {
          actorRole,
          actorId,
          targetId: target.id,
          targetRole: target.role,
          targetIsLastActiveSuperadmin:
            target.role === 'superadmin' && activeSuperadmins <= 1,
        },
        action
      );
      if (err) {
        skipped.push({ id: target.id, error: err });
        continue;
      }

      allowed.push(target.id);
    }

    let updated = 0;
    if (allowed.length > 0) {
      const result = await prisma.user.updateMany({
        where: { id: { in: allowed } },
        data: { deactivatedAt: action === 'deactivate' ? new Date() : null },
      });
      updated = result.count;

      logActivity({
        action: 'status_change',
        entity: 'user',
        details: JSON.stringify({ bulk: action, ids: allowed }),
        userEmail: session.user.email,
      }).catch(() => {});
    }

    return NextResponse.json({ updated, skipped });
  } catch (error) {
    logger.error('[users:bulk] failed', { error });
    return NextResponse.json({ error: 'Kunne ikke oppdatere brukerne' }, { status: 500 });
  }
}
