/** Én lagreknapp i flyteditoren: hva er endret, og hva sendes til API-et. */
import {
  DEFAULT_SEND_WINDOW,
  draftFromWindow,
  overrideToInput,
  windowFromDraft,
  type FlowSendWindowInput,
  type FlowSendWindowOverride,
  type SendWindow,
  type SendWindowDraft,
} from '@/lib/flows/send-window';

export interface FlowSettingsDraft {
  name: string;
  description: string;
  isMarketing: boolean;
  anchorMode: 'contact' | 'course';
}

export interface SavedFlowSettings {
  name: string;
  description: string | null;
  isMarketing: boolean;
  anchorMode: string;
}

export function settingsDraftFrom(flow: SavedFlowSettings): FlowSettingsDraft {
  return {
    name: flow.name,
    description: flow.description ?? '',
    isMarketing: flow.isMarketing,
    anchorMode: flow.anchorMode === 'course' ? 'course' : 'contact',
  };
}

export function isSettingsDirty(saved: SavedFlowSettings, draft: FlowSettingsDraft): boolean {
  const base = settingsDraftFrom(saved);
  return (
    draft.name !== base.name ||
    draft.description !== base.description ||
    draft.isMarketing !== base.isMarketing ||
    draft.anchorMode !== base.anchorMode
  );
}

/**
 * Utkastet etter en lagring: felt som ikke er rørt siden lagringen startet (like
 * `sent`), tar serverens verdi; felt brukeren har skrevet i mens, beholdes.
 */
export function settingsDraftAfterSave(
  current: FlowSettingsDraft,
  sent: FlowSettingsDraft,
  saved: SavedFlowSettings,
): FlowSettingsDraft {
  const fromServer = settingsDraftFrom(saved);
  return {
    name: current.name === sent.name ? fromServer.name : current.name,
    description: current.description === sent.description ? fromServer.description : current.description,
    isMarketing: current.isMarketing === sent.isMarketing ? fromServer.isMarketing : current.isMarketing,
    anchorMode: current.anchorMode === sent.anchorMode ? fromServer.anchorMode : current.anchorMode,
  };
}

export type SettingsPatch = Partial<{
  name: string;
  description: string | null;
  isMarketing: boolean;
  anchorMode: 'contact' | 'course';
}>;

/**
 * Bare endrede felt sendes — isMarketing/anchorMode er låst mens flyten kjører, og et
 * navnebytte skal ikke treffe den låsen.
 */
export function settingsPatch(
  saved: SavedFlowSettings,
  draft: FlowSettingsDraft,
): { ok: true; patch: SettingsPatch } | { ok: false; error: string } {
  const base = settingsDraftFrom(saved);
  const patch: SettingsPatch = {};
  const name = draft.name.trim();
  if (draft.name !== base.name) {
    if (!name) return { ok: false, error: 'Flyten må ha et navn.' };
    if (name !== base.name) patch.name = name;
  }
  if (draft.description !== base.description) {
    const description = draft.description.trim();
    if (description !== base.description) patch.description = description || null;
  }
  if (draft.isMarketing !== base.isMarketing) patch.isMarketing = draft.isMarketing;
  if (draft.anchorMode !== base.anchorMode) patch.anchorMode = draft.anchorMode;
  return { ok: true, patch };
}

export type SendWindowMode = FlowSendWindowOverride['mode'];

export interface SendWindowState {
  mode: SendWindowMode;
  draft: SendWindowDraft;
}

export function sendWindowStateFrom(global: SendWindow | null, override: FlowSendWindowOverride): SendWindowState {
  return {
    mode: override.mode,
    draft: draftFromWindow(override.mode === 'custom' ? override.window : global ?? DEFAULT_SEND_WINDOW),
  };
}

function sameDraft(a: SendWindowDraft, b: SendWindowDraft): boolean {
  return a.start === b.start && a.end === b.end && a.days.join() === b.days.join();
}

export function isSendWindowDirty(saved: FlowSendWindowOverride, state: SendWindowState): boolean {
  if (state.mode !== saved.mode) return true;
  return saved.mode === 'custom' && !sameDraft(state.draft, draftFromWindow(saved.window));
}

/** Overstyringen som skal lagres, eller feilen som hindrer lagring. */
export function sendWindowOverrideFrom(
  state: SendWindowState,
): { ok: true; override: FlowSendWindowOverride; input: FlowSendWindowInput } | { ok: false; error: string } {
  if (state.mode !== 'custom') {
    const override: FlowSendWindowOverride = { mode: state.mode };
    return { ok: true, override, input: overrideToInput(override) };
  }
  const result = windowFromDraft(state.draft);
  if (!result.ok) return { ok: false, error: `Sendetider: ${result.error}` };
  const override: FlowSendWindowOverride = { mode: 'custom', window: result.window };
  return { ok: true, override, input: overrideToInput(override) };
}

export interface FlowSavePlan {
  /** Body til PATCH /flows/:id (innstillinger og/eller sendetider), null hvis ingenting. */
  patch: (SettingsPatch & { sendWindow?: FlowSendWindowInput }) | null;
  sendWindowOverride: FlowSendWindowOverride | null;
  saveGraph: boolean;
  errors: string[];
}

/** Samler alt som er endret til (høyst) én PATCH og én lagring av tegningen. */
export function planFlowSave(input: {
  editable: boolean;
  graphDirty: boolean;
  savedSettings: SavedFlowSettings;
  settings: FlowSettingsDraft;
  savedSendWindow: FlowSendWindowOverride;
  sendWindow: SendWindowState;
}): FlowSavePlan {
  const errors: string[] = [];
  let patch: FlowSavePlan['patch'] = null;
  let sendWindowOverride: FlowSendWindowOverride | null = null;

  if (input.editable && isSettingsDirty(input.savedSettings, input.settings)) {
    const result = settingsPatch(input.savedSettings, input.settings);
    if (!result.ok) errors.push(result.error);
    else if (Object.keys(result.patch).length > 0) patch = { ...result.patch };
  }

  // Sendetider kan endres også mens flyten kjører.
  if (isSendWindowDirty(input.savedSendWindow, input.sendWindow)) {
    const result = sendWindowOverrideFrom(input.sendWindow);
    if (!result.ok) errors.push(result.error);
    else {
      sendWindowOverride = result.override;
      patch = { ...(patch ?? {}), sendWindow: result.input };
    }
  }

  return { patch, sendWindowOverride, saveGraph: input.editable && input.graphDirty, errors };
}
