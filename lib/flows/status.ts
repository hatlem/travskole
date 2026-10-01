/**
 * Flyt-statuser og hvilke operasjoner hver status tillater. Ren modul — brukes
 * både av API-rutene og admin-UI-et så reglene holdes like.
 *
 * `template` er en mal: kan redigeres, omdøpes, kopieres og slettes, men
 * aldri aktiveres eller meldes inn i. Runner/cron/hendelser ser kun på `active`.
 */

export const FLOW_STATUSES = ['draft', 'active', 'paused', 'archived', 'template'] as const;
export type FlowStatus = (typeof FLOW_STATUSES)[number];

export const FLOW_STATUS_LABELS: Record<string, string> = {
  draft: 'Utkast',
  active: 'Aktiv',
  paused: 'Pauset',
  archived: 'Arkivert',
  template: 'Mal',
};

export const flowStatusLabel = (status: string): string => FLOW_STATUS_LABELS[status] ?? status;

export const ANCHOR_MODES = ['contact', 'course'] as const;
export type AnchorMode = (typeof ANCHOR_MODES)[number];

export const isTemplateStatus = (status: string): boolean => status === 'template';

/** Graf, navn og innstillinger kan redigeres (samme regel som grafens lås). */
export const isFlowEditable = (status: string): boolean =>
  status === 'draft' || status === 'paused' || status === 'template';

/**
 * Manuell innmelding: aktive og pausede flyter, og utkast — der venter løpene
 * på aktivering og ingen e-post sendes før flyten er aktivert.
 */
export const canEnrollIntoStatus = (status: string): boolean =>
  status === 'active' || status === 'paused' || status === 'draft';

/** Aktive flyter må settes på pause først, så sletting aldri skjer midt i en utsending. */
export const canDeleteStatus = (status: string): boolean =>
  status === 'draft' || status === 'paused' || status === 'archived' || status === 'template';
