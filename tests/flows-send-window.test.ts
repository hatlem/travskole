import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SEND_WINDOW,
  DEFAULT_SEND_WINDOW_VALUE,
  WEEKDAYS,
  activatedFlowNote,
  allowedSendHours,
  describeDays,
  describeSendWindow,
  draftFromValue,
  draftToValue,
  enrollTimingNote,
  flowSendWindowInputSchema,
  flowSendWindowKey,
  formatSendTime,
  isParkedForSendWindow,
  isWaitingForSendWindow,
  isWithinWindow,
  nextWindowStart,
  overrideToInput,
  parseFlowSendWindowOverride,
  parseSendWindowValue,
  parseTime,
  resolveEffectiveSendWindow,
  resolveGlobalSendWindow,
  sendDeferral,
  sendJitterMs,
  serializeFlowSendWindowOverride,
  validateFlowSendWindowValue,
  validateSendWindowValue,
  windowFromDraft,
  type SendWindow,
} from '@/lib/flows/send-window';

const WEEKDAYS_ONLY: SendWindow = { ...DEFAULT_SEND_WINDOW, days: ['man', 'tir', 'ons', 'tor', 'fre'] };
const W = (over: Partial<SendWindow> = {}): SendWindow => ({ ...DEFAULT_SEND_WINDOW, ...over });

// Oktober før høstskiftet er sommertid (UTC+2); november er vintertid (UTC+1).
const iso = (s: string) => new Date(s);

describe('parseTime', () => {
  it('godtar TT:MM og T:MM', () => {
    expect(parseTime('08:00')).toEqual({ hour: 8, minute: 0 });
    expect(parseTime('8:05')).toEqual({ hour: 8, minute: 5 });
    expect(parseTime(' 23:59 ')).toEqual({ hour: 23, minute: 59 });
  });
  it('avviser ugyldige klokkeslett', () => {
    for (const bad of ['', '24:00', '12:60', '1200', 'kl 8', '12:5', '-1:00']) {
      expect(parseTime(bad)).toBeNull();
    }
  });
});

describe('validering', () => {
  it('standardverdien er gyldig og betyr 08–20 alle dager', () => {
    expect(DEFAULT_SEND_WINDOW_VALUE).toBe('08:00-20:00 man,tir,ons,tor,fre,lør,søn');
    expect(validateSendWindowValue(DEFAULT_SEND_WINDOW_VALUE)).toBeNull();
    expect(parseSendWindowValue(DEFAULT_SEND_WINDOW_VALUE)).toEqual(DEFAULT_SEND_WINDOW);
  });
  it('avviser slutt før/lik start (ingen vinduer over midnatt)', () => {
    expect(validateSendWindowValue('20:00-08:00 man')).toMatch(/etter starttid/);
    expect(validateSendWindowValue('10:00-10:00 man')).toMatch(/etter starttid/);
  });
  it('krever minst én time', () => {
    expect(validateSendWindowValue('10:00-10:59 man')).toMatch(/minst én time/);
    expect(validateSendWindowValue('10:00-11:00 man')).toBeNull();
  });
  it('krever minst én dag', () => {
    expect(validateSendWindowValue('08:00-20:00 ')).toBe('Velg minst én dag');
    expect(validateSendWindowValue('08:00-20:00')).toBe('Velg minst én dag');
  });
  it('krever gyldige klokkeslett', () => {
    expect(validateSendWindowValue('8-20 man')).toMatch(/TT:MM/);
    expect(validateSendWindowValue('')).toMatch(/TT:MM/);
    expect(validateSendWindowValue('-20:00 man')).toMatch(/TT:MM/);
  });
  it('ignorerer ukjente dager og sorterer/dedupliserer', () => {
    expect(draftFromValue('08:00-20:00 søn,man,xyz,man')).toEqual({ start: '08:00', end: '20:00', days: ['man', 'søn'] });
  });
  it('utkast → verdi → utkast er stabilt, også for ugyldige utkast', () => {
    const draft = { start: '21:00', end: '', days: [] };
    expect(draftFromValue(draftToValue(draft))).toEqual(draft);
    const full = { start: '07:30', end: '16:00', days: ['fre', 'man'] as const };
    expect(draftToValue({ ...full, days: [...full.days] })).toBe('07:30-16:00 man,fre');
  });
  it('windowFromDraft gir vindu eller norsk feilmelding', () => {
    expect(windowFromDraft({ start: '07:30', end: '16:00', days: ['man'] })).toEqual({
      ok: true,
      window: { startHour: 7, startMinute: 30, endHour: 16, endMinute: 0, days: ['man'] },
    });
    expect(windowFromDraft({ start: '07:30', end: '16:00', days: [] })).toEqual({ ok: false, error: 'Velg minst én dag' });
  });
});

describe('isWithinWindow', () => {
  it('start er inkludert, slutt er ekskludert (Oslo-tid)', () => {
    // Torsdag 1. okt 2026, sommertid (UTC+2)
    expect(isWithinWindow(iso('2026-10-01T05:59:59.999Z'), DEFAULT_SEND_WINDOW)).toBe(false); // 07:59:59
    expect(isWithinWindow(iso('2026-10-01T06:00:00Z'), DEFAULT_SEND_WINDOW)).toBe(true); // 08:00
    expect(isWithinWindow(iso('2026-10-01T17:59:59.999Z'), DEFAULT_SEND_WINDOW)).toBe(true); // 19:59:59
    expect(isWithinWindow(iso('2026-10-01T18:00:00Z'), DEFAULT_SEND_WINDOW)).toBe(false); // 20:00
  });
  it('bruker vintertid etter høstskiftet', () => {
    // Mandag 2. nov 2026, UTC+1: 08:00 Oslo = 07:00Z
    expect(isWithinWindow(iso('2026-11-02T06:59:00Z'), DEFAULT_SEND_WINDOW)).toBe(false);
    expect(isWithinWindow(iso('2026-11-02T07:00:00Z'), DEFAULT_SEND_WINDOW)).toBe(true);
  });
  it('respekterer ukedager i Oslo, ikke UTC', () => {
    // Lørdag 3. okt 00:30 Oslo = fredag 22:30Z
    const w = W({ startHour: 0, endHour: 2, days: ['lør'] });
    expect(isWithinWindow(iso('2026-10-02T22:30:00Z'), w)).toBe(true);
    expect(isWithinWindow(iso('2026-10-02T22:30:00Z'), W({ startHour: 0, endHour: 2, days: ['fre'] }))).toBe(false);
  });
  it('helg er stengt når bare hverdager er valgt', () => {
    expect(isWithinWindow(iso('2026-10-03T10:00:00Z'), WEEKDAYS_ONLY)).toBe(false); // lørdag 12:00
    expect(isWithinWindow(iso('2026-10-05T10:00:00Z'), WEEKDAYS_ONLY)).toBe(true); // mandag 12:00
  });
  it('minuttpresisjon på start og slutt', () => {
    const w = W({ startHour: 8, startMinute: 30, endHour: 16, endMinute: 15 });
    expect(isWithinWindow(iso('2026-10-01T06:29:00Z'), w)).toBe(false);
    expect(isWithinWindow(iso('2026-10-01T06:30:00Z'), w)).toBe(true);
    expect(isWithinWindow(iso('2026-10-01T14:14:59Z'), w)).toBe(true);
    expect(isWithinWindow(iso('2026-10-01T14:15:00Z'), w)).toBe(false);
  });
});

describe('nextWindowStart', () => {
  it('returnerer now når vinduet er åpent', () => {
    const now = iso('2026-10-01T10:00:00Z');
    expect(nextWindowStart(now, DEFAULT_SEND_WINDOW)).toBe(now);
  });
  it('før start samme dag → start i dag', () => {
    expect(nextWindowStart(iso('2026-10-01T03:00:00Z'), DEFAULT_SEND_WINDOW).toISOString()).toBe('2026-10-01T06:00:00.000Z');
  });
  it('nøyaktig ved slutt → start neste dag', () => {
    expect(nextWindowStart(iso('2026-10-01T18:00:00Z'), DEFAULT_SEND_WINDOW).toISOString()).toBe('2026-10-02T06:00:00.000Z');
  });
  it('sent på kvelden → neste morgen', () => {
    expect(nextWindowStart(iso('2026-10-01T21:45:00Z'), DEFAULT_SEND_WINDOW).toISOString()).toBe('2026-10-02T06:00:00.000Z');
  });
  it('fredag kveld med bare hverdager → mandag morgen', () => {
    // Fredag 2. okt 21:00 Oslo → mandag 5. okt 08:00 Oslo (06:00Z)
    expect(nextWindowStart(iso('2026-10-02T19:00:00Z'), WEEKDAYS_ONLY).toISOString()).toBe('2026-10-05T06:00:00.000Z');
  });
  it('bare én dag i uken → neste forekomst, opptil en uke frem', () => {
    // Torsdag 1. okt 21:00 Oslo, kun torsdager → torsdag 8. okt 08:00
    expect(nextWindowStart(iso('2026-10-01T19:00:00Z'), W({ days: ['tor'] })).toISOString()).toBe('2026-10-08T06:00:00.000Z');
  });
  it('vårskifte: natt til søndag 29. mars hopper fra CET til CEST', () => {
    // Lørdag 28. mars 23:00 CET (22:00Z) → søndag 29. mars 08:00 CEST (06:00Z)
    expect(nextWindowStart(iso('2026-03-28T22:00:00Z'), DEFAULT_SEND_WINDOW).toISOString()).toBe('2026-03-29T06:00:00.000Z');
  });
  it('vårskifte: vindu som starter i hullet (02:30) åpner 03:30 CEST', () => {
    const w = W({ startHour: 2, startMinute: 30, endHour: 6, endMinute: 0 });
    // Søndag 29. mars 01:00 CET (00:00Z) → 03:30 CEST = 01:30Z
    expect(nextWindowStart(iso('2026-03-29T00:00:00Z'), w).toISOString()).toBe('2026-03-29T01:30:00.000Z');
  });
  it('vårskifte: vindu helt inne i hullet hoppes over til neste dag', () => {
    const w = W({ startHour: 2, endHour: 3 });
    // Søndag 29. mars: 02:00–03:00 finnes ikke → mandag 30. mars 02:00 CEST = 00:00Z
    expect(nextWindowStart(iso('2026-03-28T23:30:00Z'), w).toISOString()).toBe('2026-03-30T00:00:00.000Z');
  });
  it('høstskifte: søndag 25. okt 08:00 er CET (07:00Z)', () => {
    // Lørdag 24. okt 21:00 CEST (19:00Z) → søndag 25. okt 08:00 CET = 07:00Z
    expect(nextWindowStart(iso('2026-10-24T19:00:00Z'), DEFAULT_SEND_WINDOW).toISOString()).toBe('2026-10-25T07:00:00.000Z');
  });
  it('høstskifte: dobbelt klokkeslett gir første forekomst', () => {
    const w = W({ startHour: 2, startMinute: 30, endHour: 5, endMinute: 0 });
    // Søndag 25. okt 01:00 CEST (24. okt 23:00Z) → første 02:30 (CEST) = 00:30Z
    expect(nextWindowStart(iso('2026-10-24T23:00:00Z'), w).toISOString()).toBe('2026-10-25T00:30:00.000Z');
  });
  it('resultatet er alltid innenfor vinduet og aldri før now', () => {
    const windows = [DEFAULT_SEND_WINDOW, WEEKDAYS_ONLY, W({ startHour: 9, startMinute: 15, endHour: 10, endMinute: 30, days: ['ons', 'søn'] })];
    const start = iso('2026-03-25T00:00:00Z').getTime();
    for (const w of windows) {
      for (let t = start; t < start + 40 * 86_400_000; t += 37 * 60_000) {
        const now = new Date(t);
        const next = nextWindowStart(now, w);
        expect(next.getTime()).toBeGreaterThanOrEqual(t);
        expect(isWithinWindow(next, w)).toBe(true);
        expect(next.getTime() - t).toBeLessThanOrEqual(8 * 86_400_000);
      }
    }
  });
  it('ugyldig vindu (ingen dager) gir now', () => {
    const now = iso('2026-10-01T22:00:00Z');
    expect(nextWindowStart(now, W({ days: [] }))).toBe(now);
  });
});

describe('sendJitterMs og sendDeferral', () => {
  it('jitter er deterministisk og 0–10 min', () => {
    const seen = new Set<number>();
    for (let id = 1; id <= 500; id++) {
      const j = sendJitterMs(id, DEFAULT_SEND_WINDOW);
      expect(j).toBe(sendJitterMs(id, DEFAULT_SEND_WINDOW));
      expect(j).toBeGreaterThanOrEqual(0);
      expect(j).toBeLessThan(10 * 60_000);
      seen.add(Math.floor(j / 60_000));
    }
    expect(seen.size).toBe(10); // sprer seg over alle minuttene
  });
  it('jitter er aldri mer enn halve vinduet', () => {
    const w = W({ startHour: 8, endHour: 9 });
    for (let id = 1; id <= 200; id++) expect(sendJitterMs(id, w)).toBeLessThan(30 * 60_000 + 1);
  });
  it('innenfor vinduet sendes det straks', () => {
    expect(sendDeferral(iso('2026-10-01T10:00:00Z'), DEFAULT_SEND_WINDOW, 1)).toBeNull();
  });
  it('når som helst (null) sendes det straks', () => {
    expect(sendDeferral(iso('2026-10-01T23:00:00Z'), null, 1)).toBeNull();
  });
  it('utenfor vinduet: neste åpning + egen jitter', () => {
    const at = sendDeferral(iso('2026-10-01T22:00:00Z'), DEFAULT_SEND_WINDOW, 42)!;
    expect(at.getTime()).toBe(iso('2026-10-02T06:00:00Z').getTime() + sendJitterMs(42, DEFAULT_SEND_WINDOW));
    expect(isWithinWindow(at, DEFAULT_SEND_WINDOW)).toBe(true);
  });
  it('vårskifte med kort vindu: faller tilbake til åpningen når jitter havner utenfor', () => {
    // Vindu 02:00–03:05: søndag 29. mars åpner det først 03:00 CEST og varer 5 min.
    const w = W({ startHour: 2, endHour: 3, endMinute: 5 });
    const seed = Array.from({ length: 500 }, (_, i) => i + 1).find((id) => sendJitterMs(id, w) > 5 * 60_000)!;
    expect(seed).toBeDefined();
    const at = sendDeferral(iso('2026-03-28T23:30:00Z'), w, seed)!;
    expect(at.toISOString()).toBe('2026-03-29T01:00:00.000Z');
    expect(isParkedForSendWindow(seed, at, w)).toBe(true);
  });
});

describe('isParkedForSendWindow', () => {
  it('kjenner igjen et parkeringstidspunkt', () => {
    const at = sendDeferral(iso('2026-10-01T22:00:00Z'), DEFAULT_SEND_WINDOW, 7)!;
    expect(isParkedForSendWindow(7, at, DEFAULT_SEND_WINDOW)).toBe(true);
  });
  it('vanlig ventetid (vent-node) gjenkjennes ikke', () => {
    expect(isParkedForSendWindow(7, iso('2026-10-02T09:13:27.512Z'), DEFAULT_SEND_WINDOW)).toBe(false);
  });
  it('uten vindu er ingenting parkert', () => {
    expect(isParkedForSendWindow(7, iso('2026-10-02T06:00:00Z'), null)).toBe(false);
  });
});

describe('isWaitingForSendWindow', () => {
  const NOW = iso('2026-10-01T22:00:00Z');
  const parkedAt = sendDeferral(NOW, DEFAULT_SEND_WINDOW, 3)!;
  const emailNodes = new Set([12]);
  const base = { id: 3, status: 'active', currentNodeId: 12, nextRunAt: parkedAt };

  it('aktivt enrollment parkert på e-post-noden venter på sendetid', () => {
    expect(isWaitingForSendWindow(base, emailNodes, DEFAULT_SEND_WINDOW, NOW)).toBe(true);
  });
  it('vent-node som sover frem til en e-post er ikke «venter på sendetid»', () => {
    const sleeping = { ...base, nextRunAt: new Date(NOW.getTime() + 3 * 86_400_000 + 1234) };
    expect(isWaitingForSendWindow(sleeping, emailNodes, DEFAULT_SEND_WINDOW, NOW)).toBe(false);
  });
  it('andre noder, avsluttede løp, forfalte tidspunkt og når som helst gir false', () => {
    expect(isWaitingForSendWindow({ ...base, currentNodeId: 13 }, emailNodes, DEFAULT_SEND_WINDOW, NOW)).toBe(false);
    expect(isWaitingForSendWindow({ ...base, currentNodeId: null }, emailNodes, DEFAULT_SEND_WINDOW, NOW)).toBe(false);
    expect(isWaitingForSendWindow({ ...base, status: 'completed' }, emailNodes, DEFAULT_SEND_WINDOW, NOW)).toBe(false);
    expect(isWaitingForSendWindow(base, emailNodes, DEFAULT_SEND_WINDOW, new Date(parkedAt.getTime() + 1))).toBe(false);
    expect(isWaitingForSendWindow(base, emailNodes, null, NOW)).toBe(false);
  });
});

describe('global innstilling og overstyring per flyt', () => {
  it('global: av gir null, ugyldig gir trygg standard', () => {
    expect(resolveGlobalSendWindow('false', DEFAULT_SEND_WINDOW_VALUE)).toBeNull();
    expect(resolveGlobalSendWindow('true', '07:00-21:00 man')).toEqual(W({ startHour: 7, endHour: 21, days: ['man'] }));
    expect(resolveGlobalSendWindow(undefined, undefined)).toEqual(DEFAULT_SEND_WINDOW);
    expect(resolveGlobalSendWindow('true', 'tull')).toEqual(DEFAULT_SEND_WINDOW);
  });
  it('lagret overstyring tolkes', () => {
    expect(parseFlowSendWindowOverride(null)).toEqual({ mode: 'default' });
    expect(parseFlowSendWindowOverride('anytime')).toEqual({ mode: 'anytime' });
    expect(parseFlowSendWindowOverride('09:00-15:00 lør,søn')).toEqual({
      mode: 'custom',
      window: W({ startHour: 9, endHour: 15, days: ['lør', 'søn'] }),
    });
    expect(parseFlowSendWindowOverride('15:00-09:00 lør')).toEqual({ mode: 'default' });
  });
  it('serialisering speiler tolkningen', () => {
    const custom = { mode: 'custom' as const, window: W({ startHour: 9, endHour: 15, days: ['lør' as const] }) };
    expect(serializeFlowSendWindowOverride({ mode: 'default' })).toBeNull();
    expect(serializeFlowSendWindowOverride({ mode: 'anytime' })).toBe('anytime');
    expect(parseFlowSendWindowOverride(serializeFlowSendWindowOverride(custom))).toEqual(custom);
  });
  it('effektivt vindu: standard → global, egne → egne, når som helst → null', () => {
    const custom = W({ startHour: 9, endHour: 15 });
    expect(resolveEffectiveSendWindow(DEFAULT_SEND_WINDOW, { mode: 'default' })).toBe(DEFAULT_SEND_WINDOW);
    expect(resolveEffectiveSendWindow(null, { mode: 'default' })).toBeNull();
    expect(resolveEffectiveSendWindow(DEFAULT_SEND_WINDOW, { mode: 'anytime' })).toBeNull();
    expect(resolveEffectiveSendWindow(null, { mode: 'custom', window: custom })).toBe(custom);
  });
  it('validering av lagret overstyring', () => {
    expect(validateFlowSendWindowValue('anytime')).toBeNull();
    expect(validateFlowSendWindowValue('08:00-20:00 man')).toBeNull();
    expect(validateFlowSendWindowValue('20:00-08:00 man')).toMatch(/etter starttid/);
  });
  it('nøkkel per flyt', () => {
    expect(flowSendWindowKey(12)).toBe('flow_send_window_12');
  });
});

describe('flowSendWindowInputSchema', () => {
  it('godtar de tre modusene', () => {
    expect(flowSendWindowInputSchema.parse({ mode: 'default' })).toEqual({ mode: 'default' });
    expect(flowSendWindowInputSchema.parse({ mode: 'anytime' })).toEqual({ mode: 'anytime' });
    expect(flowSendWindowInputSchema.parse({ mode: 'custom', start: '09:00', end: '15:00', days: ['søn', 'lør'] })).toEqual({
      mode: 'custom',
      window: W({ startHour: 9, endHour: 15, days: ['lør', 'søn'] }),
    });
  });
  it('gir norsk feilmelding for ugyldige egne tider', () => {
    const result = flowSendWindowInputSchema.safeParse({ mode: 'custom', start: '22:00', end: '06:00', days: ['man'] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/etter starttid/);
    expect(flowSendWindowInputSchema.safeParse({ mode: 'custom', start: '08:00', end: '20:00', days: [] }).error?.issues[0].message).toBe('Velg minst én dag');
  });
  it('avviser ukjente moduser og dager', () => {
    expect(flowSendWindowInputSchema.safeParse({ mode: 'night' }).success).toBe(false);
    expect(flowSendWindowInputSchema.safeParse({ mode: 'custom', start: '08:00', end: '20:00', days: ['monday'] }).success).toBe(false);
  });
  it('overrideToInput går tilbake til API-formatet', () => {
    const override = { mode: 'custom' as const, window: W({ startHour: 9, startMinute: 30, endHour: 15, days: ['man' as const] }) };
    expect(overrideToInput(override)).toEqual({ mode: 'custom', start: '09:30', end: '15:00', days: ['man'] });
    expect(flowSendWindowInputSchema.parse(overrideToInput(override))).toEqual(override);
  });
});

describe('visning', () => {
  it('beskriver vinduer kort', () => {
    expect(describeSendWindow(DEFAULT_SEND_WINDOW)).toBe('08–20 alle dager');
    expect(describeSendWindow(WEEKDAYS_ONLY)).toBe('08–20 hverdager');
    expect(describeSendWindow(W({ startHour: 8, startMinute: 30, endHour: 16, days: ['man', 'tir', 'ons', 'tor', 'fre', 'lør'] }))).toBe('08:30–16:00 man–lør');
    expect(describeSendWindow(null)).toBe('når som helst');
  });
  it('beskriver dager', () => {
    expect(describeDays([...WEEKDAYS])).toBe('alle dager');
    expect(describeDays(['lør', 'søn'])).toBe('lør, søn');
    expect(describeDays(['fre', 'man', 'ons'])).toBe('man, ons, fre');
    expect(describeDays(['tir', 'ons', 'tor'])).toBe('tir–tor');
  });
  it('formaterer sendetidspunkt i Oslo-tid', () => {
    const now = iso('2026-10-01T05:00:00Z');
    expect(formatSendTime(iso('2026-10-01T06:05:00Z'), now)).toBe('kl. 08:05');
    expect(formatSendTime(iso('2026-10-03T06:05:00Z'), now)).toBe('lør. kl. 08:05');
  });
  it('tillatte klokketimer for Innsikt', () => {
    expect(allowedSendHours(DEFAULT_SEND_WINDOW)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(allowedSendHours(W({ startHour: 8, startMinute: 30, endHour: 10, endMinute: 15 }))).toEqual([8, 9, 10]);
    expect(allowedSendHours(null)).toHaveLength(24);
  });
});

describe('tekster om når e-post sendes', () => {
  it('lover aldri sending «med en gang», men viser gjeldende sendetid', () => {
    const label = describeSendWindow(DEFAULT_SEND_WINDOW);
    expect(enrollTimingNote(label)).toBe(
      `De som legges til, begynner å få e-postene fra flyten innenfor flytens sendetider (nå: ${label}).`,
    );
    expect(activatedFlowNote('når som helst')).toContain('innenfor flytens sendetider (nå: når som helst)');
    for (const text of [enrollTimingNote(label), activatedFlowNote(label)]) expect(text).not.toMatch(/med en gang|går nå ut/);
  });
});
