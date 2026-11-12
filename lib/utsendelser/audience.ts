/**
 * Hvem som er i hver gruppe, og hvem som faktisk kan få e-post. Én felles regel for
 * oversikten og «Send», og kontaktene lastes én gang per kall (ikke én gang per gruppe).
 */
import { prisma } from '@/lib/prisma';
import { getSetting } from '@/lib/settings';
import { normalizeEmail } from '@/lib/crm/normalize';
import { isMarketingAllowed } from '@/lib/crm/marketing-consent';
import { contactMatchesSegment, parseSegmentRules } from '@/lib/crm/segments';
import type { Utsendelse } from './config';

export interface GroupAudience {
  /** null når segmentet er slettet. */
  ids: number[] | null;
  reachable: Set<number>;
}

const parseTags = (raw: string): string[] => {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
};

export async function loadAudience(utsendelse: Utsendelse, onlyGroupIds?: string[]): Promise<Map<string, GroupAudience>> {
  const groups = utsendelse.grupper.filter((g) => !onlyGroupIds || onlyGroupIds.includes(g.id));
  const [segments, flows, contacts, legit] = await Promise.all([
    prisma.segment.findMany({ where: { id: { in: [...new Set(groups.map((g) => g.segmentId))] } }, select: { id: true, rules: true } }),
    prisma.flow.findMany({ where: { id: { in: [...new Set(groups.map((g) => g.flowId))] } }, select: { id: true, isMarketing: true } }),
    prisma.contact.findMany({
      where: { source: { not: 'system' } },
      orderBy: { id: 'asc' },
      select: {
        id: true, email: true, stage: true, source: true, organizationId: true, lastActivityAt: true, tags: true,
        deals: { select: { eventType: true, eventDate: true, status: true } },
        consent: { select: { marketing: true, lawfulBasis: true, consentAt: true } },
      },
    }),
    getSetting('marketing_allow_legitimate_interest'),
  ]);

  const emails = contacts.map((c) => normalizeEmail(c.email)).filter((e): e is string => !!e);
  const suppressed = new Set(
    (await prisma.suppression.findMany({ where: { email: { in: emails } }, select: { email: true } })).map((s) => s.email),
  );
  const rulesBySegment = new Map(segments.map((s) => [s.id, parseSegmentRules(s.rules)]));
  const marketingByFlow = new Map(flows.map((f) => [f.id, f.isMarketing]));
  const segmentContacts = contacts.map((c) => ({ ...c, tagList: parseTags(c.tags) }));

  const result = new Map<string, GroupAudience>();
  for (const g of groups) {
    const rules = rulesBySegment.get(g.segmentId);
    if (!rules) {
      result.set(g.id, { ids: null, reachable: new Set() });
      continue;
    }
    const isMarketing = marketingByFlow.get(g.flowId) ?? true;
    const members = segmentContacts.filter((c) =>
      contactMatchesSegment(
        { stage: c.stage, source: c.source, email: c.email, organizationId: c.organizationId, lastActivityAt: c.lastActivityAt, tags: c.tagList, deals: c.deals },
        rules,
      ),
    );
    const reachable = new Set(
      members
        .filter((c) => {
          const email = normalizeEmail(c.email);
          if (!email || suppressed.has(email)) return false;
          if (!isMarketing) return true;
          return isMarketingAllowed({ consent: c.consent, organizationId: c.organizationId, allowLegitimateInterest: legit === 'true' });
        })
        .map((c) => c.id),
    );
    result.set(g.id, { ids: members.map((c) => c.id), reachable });
  }
  return result;
}
