/** Ren logikk for listen over e-postflyter: gruppering, datoer og tekster i bekreftelser. */

import { isTemplateStatus } from '@/lib/flows/status';

export interface FlowListItem {
  status: string;
  name: string;
  activeEnrollments: number;
}

export interface FlowGroups<T extends FlowListItem> {
  /** Utkast, aktive og pausede flyter — det man jobber med. */
  current: T[];
  archived: T[];
  templates: T[];
}

export function groupFlows<T extends FlowListItem>(flows: readonly T[]): FlowGroups<T> {
  const groups: FlowGroups<T> = { current: [], archived: [], templates: [] };
  for (const flow of flows) {
    if (isTemplateStatus(flow.status)) groups.templates.push(flow);
    else if (flow.status === 'archived') groups.archived.push(flow);
    else groups.current.push(flow);
  }
  return groups;
}

const MONTHS = [
  'januar', 'februar', 'mars', 'april', 'mai', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'desember',
];

/** «13. juli» i år, ellers «13. juli 2025». Ugyldig dato gir tom streng. */
export function formatNorwegianDate(value: string | Date, now: Date = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const base = `${date.getDate()}. ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? base : `${base} ${date.getFullYear()}`;
}

function peopleUnderway(n: number): string {
  return n === 1 ? '1 person er underveis' : `${n} personer er underveis`;
}

/** Teksten i «Slette …?»-dialogen. Nevner folk underveis, så sletting av en pauset flyt ikke overrasker. */
export function deleteFlowMessage(flow: FlowListItem): string {
  const base = `«${flow.name}» slettes for godt, med alle stegene og startreglene.`;
  const underway =
    !isTemplateStatus(flow.status) && flow.activeEnrollments > 0
      ? ` ${peopleUnderway(flow.activeEnrollments)} og får ikke resten av e-postene.`
      : '';
  return `${base}${underway} Dette kan ikke angres.`;
}
