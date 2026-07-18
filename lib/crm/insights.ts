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
