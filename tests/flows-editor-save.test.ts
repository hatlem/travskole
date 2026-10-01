import { describe, expect, it } from 'vitest';
import {
  isSendWindowDirty,
  isSettingsDirty,
  planFlowSave,
  sendWindowStateFrom,
  settingsDraftAfterSave,
  settingsDraftFrom,
  settingsPatch,
} from '@/lib/flows/editor-save';
import { DEFAULT_SEND_WINDOW, type FlowSendWindowOverride } from '@/lib/flows/send-window';

const saved = { name: 'Velkommen', description: null, isMarketing: true, anchorMode: 'contact' };
const defaultOverride: FlowSendWindowOverride = { mode: 'default' };
const sw = (override: FlowSendWindowOverride = defaultOverride) => sendWindowStateFrom(DEFAULT_SEND_WINDOW, override);

describe('settingsPatch', () => {
  it('sender bare navnet ved navnebytte (treffer ikke låsen på aktive flyter)', () => {
    const draft = { ...settingsDraftFrom(saved), name: '  Velkommen ny  ' };
    expect(settingsPatch(saved, draft)).toEqual({ ok: true, patch: { name: 'Velkommen ny' } });
  });

  it('krever navn', () => {
    expect(settingsPatch(saved, { ...settingsDraftFrom(saved), name: '  ' })).toEqual({
      ok: false,
      error: 'Flyten må ha et navn.',
    });
  });

  it('tom beskrivelse blir null, endret type sendes', () => {
    const withDesc = { ...saved, description: 'Gammel' };
    const draft = { ...settingsDraftFrom(withDesc), description: ' ', isMarketing: false };
    expect(settingsPatch(withDesc, draft)).toEqual({ ok: true, patch: { description: null, isMarketing: false } });
  });
});

describe('dirty-sjekker', () => {
  it('er rene rett etter lasting', () => {
    expect(isSettingsDirty(saved, settingsDraftFrom(saved))).toBe(false);
    const custom: FlowSendWindowOverride = { mode: 'custom', window: { ...DEFAULT_SEND_WINDOW, startHour: 9 } };
    expect(isSendWindowDirty(custom, sw(custom))).toBe(false);
  });

  it('merker endrede sendetider', () => {
    expect(isSendWindowDirty(defaultOverride, { ...sw(), mode: 'anytime' })).toBe(true);
    const custom: FlowSendWindowOverride = { mode: 'custom', window: DEFAULT_SEND_WINDOW };
    const state = sw(custom);
    expect(isSendWindowDirty(custom, { ...state, draft: { ...state.draft, start: '09:00' } })).toBe(true);
  });
});

describe('planFlowSave', () => {
  const base = {
    editable: true,
    graphDirty: false,
    savedSettings: saved,
    settings: settingsDraftFrom(saved),
    savedSendWindow: defaultOverride,
    sendWindow: sw(),
  };

  it('samler navnebytte og sendetider i én PATCH og lagrer tegningen', () => {
    const plan = planFlowSave({
      ...base,
      graphDirty: true,
      settings: { ...base.settings, name: 'Nytt navn' },
      sendWindow: { ...base.sendWindow, mode: 'anytime' },
    });
    expect(plan).toEqual({
      patch: { name: 'Nytt navn', sendWindow: { mode: 'anytime' } },
      sendWindowOverride: { mode: 'anytime' },
      saveGraph: true,
      errors: [],
    });
  });

  it('lagrer bare sendetider når flyten kjører', () => {
    const plan = planFlowSave({
      ...base,
      editable: false,
      graphDirty: true,
      settings: { ...base.settings, name: 'Ignoreres' },
      sendWindow: { ...base.sendWindow, mode: 'anytime' },
    });
    expect(plan.patch).toEqual({ sendWindow: { mode: 'anytime' } });
    expect(plan.saveGraph).toBe(false);
  });

  it('stopper på ugyldige egne tider', () => {
    const plan = planFlowSave({
      ...base,
      sendWindow: { mode: 'custom', draft: { start: '', end: '20:00', days: ['man'] } },
    });
    expect(plan.errors[0]).toMatch(/^Sendetider:/);
    expect(plan.patch).toBeNull();
  });

  it('ingenting å gjøre når alt er lagret', () => {
    expect(planFlowSave(base)).toEqual({ patch: null, sendWindowOverride: null, saveGraph: false, errors: [] });
  });
});

describe('settingsDraftAfterSave', () => {
  const sent = { name: 'Velkomst ', description: '', isMarketing: true, anchorMode: 'contact' as const };
  const saved = { name: 'Velkomst', description: null, isMarketing: true, anchorMode: 'contact' };

  it('takes the server values for fields untouched during the save', () => {
    expect(settingsDraftAfterSave(sent, sent, saved)).toEqual({ name: 'Velkomst', description: '', isMarketing: true, anchorMode: 'contact' });
  });

  it('keeps what the user typed while the save was in flight (regression: overwritten)', () => {
    const current = { ...sent, name: 'Velkomst 2', isMarketing: false };
    expect(settingsDraftAfterSave(current, sent, saved)).toEqual({
      name: 'Velkomst 2', description: '', isMarketing: false, anchorMode: 'contact',
    });
  });
});
