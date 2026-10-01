/**
 * Lagring av sendetider i Setting-tabellen: global standard
 * (send_window_enabled/send_window) og overstyring per flyt
 * (flow_send_window_<flowId>; ingen rad = bruk standard).
 */
import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';
import {
  FLOW_SEND_WINDOW_PREFIX,
  flowSendWindowKey,
  parseFlowSendWindowOverride,
  resolveEffectiveSendWindow,
  resolveGlobalSendWindow,
  serializeFlowSendWindowOverride,
  type FlowSendWindowOverride,
  type SendWindow,
} from './send-window';

const GLOBAL_KEYS = ['send_window_enabled', 'send_window'];

export interface SendWindowConfig {
  global: SendWindow | null;
  overrides: Map<number, FlowSendWindowOverride>;
}

export function effectiveWindowFor(config: SendWindowConfig, flowId: number): SendWindow | null {
  return resolveEffectiveSendWindow(config.global, config.overrides.get(flowId) ?? { mode: 'default' });
}

/** Manglende rader gir samme standard som SETTING_DEFAULTS (på, 08–20 alle dager). */
function globalFrom(values: Map<string, string>): SendWindow | null {
  return resolveGlobalSendWindow(values.get('send_window_enabled'), values.get('send_window'));
}

/**
 * Alle sendetider i én spørring (én gang per runner-batch). Feiler lesingen,
 * brukes standardvinduet — da venter heller en e-post enn at noen får den om natten.
 */
export async function loadSendWindowConfig(): Promise<SendWindowConfig> {
  try {
    const rows = await prisma.setting.findMany({
      where: { OR: [{ key: { in: GLOBAL_KEYS } }, { key: { startsWith: FLOW_SEND_WINDOW_PREFIX } }] },
      select: { key: true, value: true },
    });
    const values = new Map(rows.map((row) => [row.key, row.value]));
    const overrides = new Map<number, FlowSendWindowOverride>();
    for (const [key, value] of values) {
      if (!key.startsWith(FLOW_SEND_WINDOW_PREFIX)) continue;
      const flowId = Number(key.slice(FLOW_SEND_WINDOW_PREFIX.length));
      if (Number.isInteger(flowId)) overrides.set(flowId, parseFlowSendWindowOverride(value));
    }
    return { global: globalFrom(values), overrides };
  } catch (error) {
    logger.warn('Kunne ikke lese sendetider — bruker standardvinduet', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { global: globalFrom(new Map()), overrides: new Map() };
  }
}

export interface FlowSendWindowState {
  global: SendWindow | null;
  override: FlowSendWindowOverride;
  effective: SendWindow | null;
}

export async function getFlowSendWindowState(flowId: number): Promise<FlowSendWindowState> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: [...GLOBAL_KEYS, flowSendWindowKey(flowId)] } },
    select: { key: true, value: true },
  });
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const global = globalFrom(values);
  const override = parseFlowSendWindowOverride(values.get(flowSendWindowKey(flowId)));
  return { global, override, effective: resolveEffectiveSendWindow(global, override) };
}

export async function saveFlowSendWindowOverride(flowId: number, override: FlowSendWindowOverride): Promise<void> {
  const key = flowSendWindowKey(flowId);
  const value = serializeFlowSendWindowOverride(override);
  if (value === null) {
    await prisma.setting.deleteMany({ where: { key } });
    return;
  }
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export async function deleteFlowSendWindowOverride(flowId: number): Promise<void> {
  await prisma.setting.deleteMany({ where: { key: flowSendWindowKey(flowId) } });
}
