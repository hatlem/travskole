/**
 * Sendetider for flyt-e-post: rene, klientsikre hjelpere (ingen I/O).
 * Klokkeslett og ukedager tolkes alltid i Europe/Oslo, så sommertid håndteres
 * av Intl. Et tidsrom kan ikke gå over midnatt (start må være før slutt).
 */
import { z } from 'zod';

const OSLO_TZ = 'Europe/Oslo';
const MINUTE_MS = 60_000;
const MAX_JITTER_MS = 10 * MINUTE_MS;
export const MIN_WINDOW_MINUTES = 60;

export const WEEKDAYS = ['man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  man: 'Mandag',
  tir: 'Tirsdag',
  ons: 'Onsdag',
  tor: 'Torsdag',
  fre: 'Fredag',
  lør: 'Lørdag',
  søn: 'Søndag',
};

export interface SendWindow {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  days: Weekday[];
}

/** Det et skjema redigerer: klokkeslett som «TT:MM» og valgte dager. */
export interface SendWindowDraft {
  start: string;
  end: string;
  days: Weekday[];
}

export const DEFAULT_SEND_WINDOW: SendWindow = {
  startHour: 8,
  startMinute: 0,
  endHour: 20,
  endMinute: 0,
  days: [...WEEKDAYS],
};

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function parseTime(value: string): { hour: number; minute: number } | null {
  const match = TIME_RE.exec(value.trim());
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function formatTime(hour: number, minute: number): string {
  return `${pad(hour)}:${pad(minute)}`;
}

function isWeekday(value: string): value is Weekday {
  return (WEEKDAYS as readonly string[]).includes(value);
}

/** Ukedagene i fast rekkefølge (man→søn), uten duplikater. */
export function sortDays(days: readonly Weekday[]): Weekday[] {
  return WEEKDAYS.filter((day) => days.includes(day));
}

const startOf = (w: SendWindow) => w.startHour * 60 + w.startMinute;
const endOf = (w: SendWindow) => w.endHour * 60 + w.endMinute;

export function windowMinutes(w: SendWindow): number {
  return endOf(w) - startOf(w);
}

// --- Utkast ⇄ lagret verdi («08:00-20:00 man,tir,...») ---------------------

export function draftFromWindow(w: SendWindow): SendWindowDraft {
  return {
    start: formatTime(w.startHour, w.startMinute),
    end: formatTime(w.endHour, w.endMinute),
    days: sortDays(w.days),
  };
}

/** Tolerant tolkning — ugyldige deler blir tomme, så skjemaet kan vise feilen. */
export function draftFromValue(value: string | undefined): SendWindowDraft {
  const [range = '', dayList = ''] = (value ?? '').trim().split(/\s+/, 2);
  const [start = '', end = ''] = range.split('-', 2);
  const days = dayList.split(',').map((d) => d.trim().toLowerCase()).filter(isWeekday);
  return { start: start.trim(), end: end.trim(), days: sortDays(days) };
}

export function draftToValue(draft: SendWindowDraft): string {
  return `${draft.start}-${draft.end} ${sortDays(draft.days).join(',')}`.trim();
}

export type DraftResult = { ok: true; window: SendWindow } | { ok: false; error: string };

export function windowFromDraft(draft: SendWindowDraft): DraftResult {
  const start = parseTime(draft.start);
  const end = parseTime(draft.end);
  if (!start || !end) return { ok: false, error: 'Oppgi klokkeslett som TT:MM, f.eks. 08:00' };
  const window: SendWindow = {
    startHour: start.hour,
    startMinute: start.minute,
    endHour: end.hour,
    endMinute: end.minute,
    days: sortDays(draft.days),
  };
  const error = validateSendWindow(window);
  return error ? { ok: false, error } : { ok: true, window };
}

export function validateSendWindow(w: SendWindow): string | null {
  const minutes = windowMinutes(w);
  if (minutes <= 0) return 'Sluttid må være etter starttid (tidsrommet kan ikke gå over midnatt)';
  if (minutes < MIN_WINDOW_MINUTES) return 'Tidsrommet må være minst én time';
  if (w.days.length === 0) return 'Velg minst én dag';
  return null;
}

/** Feilmelding for en lagret verdi, eller null når den er gyldig. */
export function validateSendWindowValue(value: string): string | null {
  const result = windowFromDraft(draftFromValue(value));
  return result.ok ? null : result.error;
}

export function parseSendWindowValue(value: string | undefined): SendWindow | null {
  const result = windowFromDraft(draftFromValue(value));
  return result.ok ? result.window : null;
}

export function formatSendWindowValue(w: SendWindow): string {
  return draftToValue(draftFromWindow(w));
}

export const DEFAULT_SEND_WINDOW_VALUE = formatSendWindowValue(DEFAULT_SEND_WINDOW);

// --- Tidssone ---------------------------------------------------------------

const OSLO_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: OSLO_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

interface OsloParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function osloParts(d: Date): OsloParts {
  const parts: Record<string, number> = {};
  for (const part of OSLO_PARTS.formatToParts(d)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** Ukedag for en kalenderdato (uavhengig av tidssone). */
function weekdayOf(year: number, month: number, day: number): Weekday {
  const sundayFirst = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return WEEKDAYS[(sundayFirst + 6) % 7];
}

function osloOffsetMs(at: number): number {
  const p = osloParts(new Date(at));
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - Math.floor(at / 1000) * 1000;
}

const SIX_HOURS_MS = 6 * 60 * MINUTE_MS;

/**
 * UTC-instant for en Oslo-veggklokketid. Et klokkeslett som ikke finnes
 * (vårens hopp 02:00→03:00) flyttes en time frem; et dobbelt klokkeslett
 * (høstens 02:00–03:00) gir den første forekomsten.
 */
function osloWallToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const candidates = [naive - osloOffsetMs(naive - SIX_HOURS_MS), naive - osloOffsetMs(naive + SIX_HOURS_MS)];
  const exact = candidates.filter((c) => {
    const p = osloParts(new Date(c));
    return p.day === day && p.hour === hour && p.minute === minute;
  });
  return new Date(exact.length > 0 ? Math.min(...exact) : candidates[0]);
}

export function isWithinWindow(now: Date, w: SendWindow): boolean {
  const p = osloParts(now);
  if (!w.days.includes(weekdayOf(p.year, p.month, p.day))) return false;
  const minuteOfDay = p.hour * 60 + p.minute;
  return minuteOfDay >= startOf(w) && minuteOfDay < endOf(w);
}

/**
 * Første tidspunkt ≥ `now` da vinduet er åpent. Er vinduet åpent nå, er svaret
 * `now`. Et ugyldig vindu (ingen dager) gir `now`, så ingenting blir stående.
 */
export function nextWindowStart(now: Date, w: SendWindow): Date {
  if (isWithinWindow(now, w)) return now;
  const today = osloParts(now);
  for (let offset = 0; offset <= 8; offset++) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const [year, month, day] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
    if (!w.days.includes(weekdayOf(year, month, day))) continue;
    const start = osloWallToUtc(year, month, day, w.startHour, w.startMinute);
    if (start.getTime() > now.getTime() && isWithinWindow(start, w)) return start;
  }
  return now;
}

/** Deterministisk spredning (0–10 min, maks halve vinduet) per enrollment. */
export function sendJitterMs(seed: number, w: SendWindow): number {
  const cap = Math.min(MAX_JITTER_MS, Math.floor((windowMinutes(w) * MINUTE_MS) / 2));
  if (cap <= 0) return 0;
  let h = seed | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) % cap;
}

/**
 * Når en e-post må vente: tidspunktet den skal sendes, ellers null (send nå).
 * `window` null betyr «når som helst».
 */
export function sendDeferral(now: Date, w: SendWindow | null, seed: number): Date | null {
  if (!w || isWithinWindow(now, w)) return null;
  const start = nextWindowStart(now, w);
  if (start.getTime() === now.getTime()) return null;
  const jittered = new Date(start.getTime() + sendJitterMs(seed, w));
  return isWithinWindow(jittered, w) ? jittered : start;
}

/**
 * Om et enrollments `nextRunAt` er nøyaktig tidspunktet `sendDeferral` ville
 * parkert det til (vindusåpning + egen spredning). Brukes kun til visning.
 */
export function isParkedForSendWindow(seed: number, nextRunAt: Date, w: SendWindow | null): boolean {
  if (!w) return false;
  const opensAt = (t: number) => isWithinWindow(new Date(t), w) && !isWithinWindow(new Date(t - 1), w);
  const t = nextRunAt.getTime();
  return opensAt(t - sendJitterMs(seed, w)) || opensAt(t);
}

export interface EnrollmentWaitState {
  id: number;
  status: string;
  currentNodeId: number | null;
  nextRunAt: Date;
}

/** Aktivt enrollment som står parkert på en e-post-node og venter på at sendetiden åpner. */
export function isWaitingForSendWindow(
  enrollment: EnrollmentWaitState,
  emailNodeIds: ReadonlySet<number>,
  w: SendWindow | null,
  now: Date,
): boolean {
  return (
    enrollment.status === 'active' &&
    enrollment.currentNodeId !== null &&
    emailNodeIds.has(enrollment.currentNodeId) &&
    enrollment.nextRunAt.getTime() > now.getTime() &&
    isParkedForSendWindow(enrollment.id, enrollment.nextRunAt, w)
  );
}

// --- Global innstilling og overstyring per flyt ------------------------------

/** Den globale standarden: null = av (send når som helst). Ugyldig verdi ⇒ 08–20 alle dager. */
export function resolveGlobalSendWindow(enabled: string | undefined, value: string | undefined): SendWindow | null {
  if (enabled === 'false') return null;
  return parseSendWindowValue(value) ?? DEFAULT_SEND_WINDOW;
}

export type FlowSendWindowOverride =
  | { mode: 'default' }
  | { mode: 'anytime' }
  | { mode: 'custom'; window: SendWindow };

export const FLOW_SEND_WINDOW_PREFIX = 'flow_send_window_';
export const SEND_WINDOW_ANYTIME = 'anytime';

export function flowSendWindowKey(flowId: number): string {
  return `${FLOW_SEND_WINDOW_PREFIX}${flowId}`;
}

/** Ugyldig/manglende lagret verdi ⇒ flyten bruker standarden. */
export function parseFlowSendWindowOverride(raw: string | null | undefined): FlowSendWindowOverride {
  if (!raw) return { mode: 'default' };
  if (raw.trim() === SEND_WINDOW_ANYTIME) return { mode: 'anytime' };
  const window = parseSendWindowValue(raw);
  return window ? { mode: 'custom', window } : { mode: 'default' };
}

/** null ⇒ ingen rad (standard). */
export function serializeFlowSendWindowOverride(override: FlowSendWindowOverride): string | null {
  switch (override.mode) {
    case 'anytime':
      return SEND_WINDOW_ANYTIME;
    case 'custom':
      return formatSendWindowValue(override.window);
    default:
      return null;
  }
}

export function validateFlowSendWindowValue(value: string): string | null {
  return value.trim() === SEND_WINDOW_ANYTIME ? null : validateSendWindowValue(value);
}

export function resolveEffectiveSendWindow(
  global: SendWindow | null,
  override: FlowSendWindowOverride,
): SendWindow | null {
  switch (override.mode) {
    case 'anytime':
      return null;
    case 'custom':
      return override.window;
    default:
      return global;
  }
}

/** API-format for overstyringen (PATCH /api/admin/crm/flows/[id]). */
export const flowSendWindowInputSchema = z
  .discriminatedUnion('mode', [
    z.object({ mode: z.literal('default') }),
    z.object({ mode: z.literal('anytime') }),
    z.object({
      mode: z.literal('custom'),
      start: z.string().max(5),
      end: z.string().max(5),
      days: z.array(z.enum(WEEKDAYS)).max(7),
    }),
  ])
  .transform((input, ctx): FlowSendWindowOverride => {
    if (input.mode !== 'custom') return input;
    const result = windowFromDraft(input);
    if (!result.ok) {
      ctx.addIssue({ code: 'custom', message: result.error });
      return z.NEVER;
    }
    return { mode: 'custom', window: result.window };
  });
export type FlowSendWindowInput = z.input<typeof flowSendWindowInputSchema>;

export function overrideToInput(override: FlowSendWindowOverride): FlowSendWindowInput {
  return override.mode === 'custom' ? { mode: 'custom', ...draftFromWindow(override.window) } : override;
}

// --- Visning ------------------------------------------------------------------

function describeHours(w: SendWindow): string {
  if (w.startMinute === 0 && w.endMinute === 0) return `${pad(w.startHour)}–${pad(w.endHour)}`;
  return `${formatTime(w.startHour, w.startMinute)}–${formatTime(w.endHour, w.endMinute)}`;
}

export function describeDays(days: readonly Weekday[]): string {
  const sorted = sortDays(days);
  if (sorted.length === 7) return 'alle dager';
  if (sorted.length === 0) return 'ingen dager';
  const indexes = sorted.map((day) => WEEKDAYS.indexOf(day));
  const contiguous = indexes.every((idx, i) => i === 0 || idx === indexes[i - 1] + 1);
  if (contiguous && sorted.length === 5 && sorted[0] === 'man') return 'hverdager';
  if (contiguous && sorted.length >= 3) return `${sorted[0]}–${sorted[sorted.length - 1]}`;
  return sorted.join(', ');
}

/** Kort beskrivelse, f.eks. «08–20 alle dager», «08:30–16:00 hverdager» eller «når som helst». */
export function describeSendWindow(w: SendWindow | null): string {
  return w ? `${describeHours(w)} ${describeDays(w.days)}` : 'når som helst';
}

const OSLO_CLOCK = new Intl.DateTimeFormat('nb-NO', {
  timeZone: OSLO_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const OSLO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: OSLO_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** «kl. 08:05», eller «lør. kl. 08:05» når det ikke er i dag (Oslo). */
export function formatSendTime(at: Date, now: Date): string {
  const clock = `kl. ${OSLO_CLOCK.format(at)}`;
  if (OSLO_DAY.format(at) === OSLO_DAY.format(now)) return clock;
  const p = osloParts(at);
  return `${weekdayOf(p.year, p.month, p.day)}. ${clock}`;
}

/** Klokketimer (0–23) der en sending havner innenfor vinduet på minst én av dagene. */
export function allowedSendHours(w: SendWindow | null): number[] {
  const hours = Array.from({ length: 24 }, (_, h) => h);
  if (!w) return hours;
  return hours.filter((h) => h * 60 + 60 > startOf(w) && h * 60 < endOf(w));
}
