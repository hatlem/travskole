import {
  DEFAULT_APPLY_OPTIONS, type ApplyOptions, type ImportPlan, type RowDecision, type RowDecisionAction,
} from '@/lib/crm/import/types';

export type ListChoice = { kind: 'none' } | { kind: 'existing'; id: number } | { kind: 'new'; name: string };

export interface ImportSettings extends ApplyOptions {
  list: ListChoice;
}

export const DEFAULT_SETTINGS: ImportSettings = { ...DEFAULT_APPLY_OPTIONS, list: { kind: 'none' } };

export interface ContactListOption {
  id: number;
  name: string;
  memberCount: number;
}

/** Body til /api/admin/crm/import (uten tekst/kolonner). */
export function settingsPayload(settings: ImportSettings) {
  const { list, policy, tags, ownerId, stage, confirmConsent } = settings;
  return {
    policy, tags, ownerId, stage, confirmConsent,
    list: list.kind === 'none' ? null : list.kind === 'new' ? { kind: 'new', name: list.name.trim() } : list,
  };
}

/** Valgene i forhåndsvisningen; en sammenslåing sender med kontakten admin så. */
export function toDecisionList(plan: ImportPlan, decisions: Record<number, RowDecisionAction>): RowDecision[] {
  return plan.rows.flatMap((r) => {
    const action = decisions[r.row];
    if (!action) return [];
    return [{ row: r.row, action, ...(action === 'merge' && r.match && { contactId: r.match.contactId }) }];
  });
}
