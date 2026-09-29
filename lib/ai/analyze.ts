// Deterministisk engasjementsanalyse (ingen LLM): regelbaserte forslag som
// lagres som AiSuggestion-rader. Visning/handling kommer i delprosjekt 6.
export interface FlowEngagementInput {
  flowId: number;
  sends: { sentAt: Date; openedAt: Date | null }[];
  lastEmailHasFollowup: boolean;
}
export interface SuggestionCandidate {
  kind: 'followup' | 'send_timing';
  title: string;
  detail: Record<string, unknown>;
  dedupeKey: string;
}

function monthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

const OSLO_HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', hourCycle: 'h23' });

/** Klokketime (0–23) i Europe/Oslo — forslagene vises som «kl XX» for norske admins. */
export function osloHour(d: Date): number {
  return Number(OSLO_HOUR.format(d));
}

function modalHour(dates: Date[]): number | null {
  if (dates.length === 0) return null;
  const counts = new Map<number, number>();
  for (const d of dates) {
    const hour = osloHour(d);
    counts.set(hour, (counts.get(hour) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0];
}

export function analyzeFlowEngagement(input: FlowEngagementInput, now: Date): SuggestionCandidate[] {
  const out: SuggestionCandidate[] = [];
  const { flowId, sends, lastEmailHasFollowup } = input;
  const month = monthKey(now);

  const unopened = sends.filter((s) => s.openedAt === null).length;
  if (sends.length >= 5 && unopened / sends.length >= 0.5 && !lastEmailHasFollowup) {
    out.push({
      kind: 'followup',
      title: `${unopened} av ${sends.length} mottakere har ikke åpnet — vurder en påminnelse`,
      detail: { total: sends.length, unopened },
      dedupeKey: `followup:${flowId}:${month}`,
    });
  }

  const opened = sends.filter((s): s is { sentAt: Date; openedAt: Date } => s.openedAt !== null);
  if (opened.length >= 10) {
    const bestHour = modalHour(opened.map((s) => s.openedAt))!;
    const openShare = opened.filter((s) => osloHour(s.openedAt) === bestHour).length / opened.length;
    const sendHour = modalHour(sends.map((s) => s.sentAt));
    if (openShare >= 0.3 && sendHour !== null && bestHour !== sendHour) {
      out.push({
        kind: 'send_timing',
        title: `Flest åpninger skjer rundt kl ${String(bestHour).padStart(2, '0')} — vurder å sende nærmere dette tidspunktet`,
        detail: { bestHour, sendHour, openShare: Math.round(openShare * 100) / 100 },
        dedupeKey: `send_timing:${flowId}:${month}`,
      });
    }
  }

  return out;
}
