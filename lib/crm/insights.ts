// Ren tall-transformasjon for innsiktssiden (delprosjekt 6): rater,
// ISO-ukebøtting (mandag UTC) og månedsbøtting. Ingen IO, ingen Date.now()
// — `now` injiseres, så alt er deterministisk testbart.

export function computeRates(
  sent: number,
  opened: number,
  clicked: number,
): { openRate: number; clickRate: number } {
  const pct = (part: number) => (sent > 0 ? Math.round((part / sent) * 1000) / 10 : 0);
  return { openRate: pct(opened), clickRate: pct(clicked) };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** 'YYYY-MM-DD' for mandagen (UTC) i datoens ISO-uke. */
export function isoWeekStart(d: Date): string {
  const utcMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dayOfWeek = new Date(utcMidnight).getUTCDay(); // 0=søn..6=lør
  const daysSinceMonday = (dayOfWeek + 6) % 7; // man=0 ... søn=6
  return new Date(utcMidnight - daysSinceMonday * DAY_MS).toISOString().slice(0, 10);
}

/** De siste `weeks` ukestartene (eldste først), inkl. inneværende uke. */
export function weekStarts(weeks: number, now: Date): string[] {
  const currentStartMs = Date.parse(isoWeekStart(now));
  const out: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    out.push(new Date(currentStartMs - i * WEEK_MS).toISOString().slice(0, 10));
  }
  return out;
}

export function bucketCountsByWeek(
  dates: Date[],
  weeks: number,
  now: Date,
): { weekStart: string; count: number }[] {
  const starts = weekStarts(weeks, now);
  const counts = new Map<string, number>(starts.map((s) => [s, 0]));
  for (const d of dates) {
    const key = isoWeekStart(d);
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return starts.map((weekStart) => ({ weekStart, count: counts.get(weekStart) ?? 0 }));
}

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** De siste `months` månedsnøklene (eldste først), inkl. inneværende. */
export function monthKeys(months: number, now: Date): string[] {
  const out: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(monthKey(d));
  }
  return out;
}

export function bucketSumByMonth(
  rows: { at: Date; value: number }[],
  months: number,
  now: Date,
): { month: string; sum: number; count: number }[] {
  const keys = monthKeys(months, now);
  const acc = new Map<string, { sum: number; count: number }>(keys.map((k) => [k, { sum: 0, count: 0 }]));
  for (const row of rows) {
    const key = monthKey(row.at);
    const bucket = acc.get(key);
    if (bucket) {
      bucket.sum += row.value;
      bucket.count += 1;
    }
  }
  return keys.map((month) => ({ month, ...(acc.get(month) as { sum: number; count: number }) }));
}

/** Tekst i stedet for «vunnet per måned»-grafen når den ville vært tom; null = vis grafen. */
export function wonChartMessage(months: { value: number; count: number }[], totalWon: number): string | null {
  const count = months.reduce((sum, m) => sum + m.count, 0);
  if (count === 0) {
    return totalWon > 0
      ? `Ingen vunne avtaler de siste 6 månedene (${totalWon} vunnet tidligere).`
      : 'Ingen vunne avtaler ennå. Når du flytter en avtale til «Vunnet» på salgstavlen, dukker den opp her.';
  }
  if (months.every((m) => m.value === 0)) {
    return `${count === 1 ? '1 vunnet avtale' : `${count} vunne avtaler`} de siste 6 månedene, men uten beløp. Fyll inn «Verdi» på avtalene for å se grafen.`;
  }
  return null;
}

export interface FlowSendRow {
  enrollmentId: number | null;
  status: string;
  openedAt: Date | null;
  firstClickedAt: Date | null;
  repliedAt: Date | null;
  bouncedAt: Date | null;
}

export interface FlowSendAgg {
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
}

export interface FlowSendTotals extends FlowSendAgg {
  /** Ikke sendt fordi personen ikke har sagt ja til markedsføring. */
  skippedNoConsent: number;
  /** Ikke sendt fordi personen har meldt seg av eller står på sperrelisten. */
  skippedSuppressed: number;
  /** Sendt fra e-postflyter som er slettet siden (vises som egen rad). */
  deletedFlows: FlowSendAgg;
}

const emptyAgg = (): FlowSendAgg => ({ sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 });

function addSend(agg: FlowSendAgg, send: FlowSendRow): void {
  agg.sent++;
  if (send.openedAt) agg.opened++;
  if (send.firstClickedAt) agg.clicked++;
  if (send.repliedAt) agg.replied++;
  if (send.bouncedAt) agg.bounced++;
}

/**
 * Teller e-poster fra e-postflyter. «Sendt» = alle rader med status 'sent' som
 * hører til et løp i en flyt. Test-e-poster (status 'test', uten løp) og
 * kurs-e-poster (logges ikke her) telles aldri med.
 */
export function aggregateFlowSends(
  sends: FlowSendRow[],
  flowIdByEnrollment: ReadonlyMap<number, number>,
): { perFlow: Map<number, FlowSendAgg>; totals: FlowSendTotals } {
  const perFlow = new Map<number, FlowSendAgg>();
  const totals: FlowSendTotals = { ...emptyAgg(), skippedNoConsent: 0, skippedSuppressed: 0, deletedFlows: emptyAgg() };
  for (const send of sends) {
    if (send.enrollmentId === null) continue;
    if (send.status === 'skipped_no_consent') { totals.skippedNoConsent++; continue; }
    if (send.status === 'skipped_suppressed') { totals.skippedSuppressed++; continue; }
    if (send.status !== 'sent') continue;
    addSend(totals, send);
    const flowId = flowIdByEnrollment.get(send.enrollmentId);
    if (flowId === undefined) {
      addSend(totals.deletedFlows, send);
      continue;
    }
    const agg = perFlow.get(flowId) ?? emptyAgg();
    addSend(agg, send);
    perFlow.set(flowId, agg);
  }
  return { perFlow, totals };
}

const MONTHS_LONG = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];
const MONTHS_SHORT = ['jan.', 'feb.', 'mars', 'apr.', 'mai', 'juni', 'juli', 'aug.', 'sep.', 'okt.', 'nov.', 'des.'];

/** '2026-07-13' → '13.07' (aksetekst). */
export function dayMonthShort(isoDate: string): string {
  const [, m, d] = isoDate.split('-');
  return d && m ? `${d}.${m}` : isoDate;
}

/** '2026-07-13' → '13. juli' (verktøytips). */
export function dayMonthLong(isoDate: string): string {
  const [, m, d] = isoDate.split('-').map(Number);
  return m && d ? `${d}. ${MONTHS_LONG[m - 1]}` : isoDate;
}

/** '2026-07' → 'juli 2026'; kort: 'juli 26' / 'aug. 26'. */
export function monthLabel(key: string, short = false): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return short ? `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}` : `${MONTHS_LONG[m - 1]} ${y}`;
}
