import type { AttentionItem } from '@/lib/dashboard-attention';
import { getUtsendelser } from './config';
import { loadUtsendelseSummary } from './overview';

const count = (n: number) => n.toLocaleString('nb-NO');

const CACHE_MS = 60_000;
let cache: { at: number; items: AttentionItem[] } | null = null;

/** Utsendelser med noen som ikke har fått e-post ennå, til «Krever oppmerksomhet». Bufres ett minutt; feil skjuler bare kortet. */
export async function utsendelseAttentionItems(): Promise<AttentionItem[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.items;
  const items = await computeItems();
  cache = { at: Date.now(), items };
  return items;
}

async function computeItems(): Promise<AttentionItem[]> {
  try {
    const summaries = await Promise.all((await getUtsendelser()).map(loadUtsendelseSummary));
    return summaries
      .filter((s) => s.totals.remaining > 0 || s.status === 'pause')
      .map((s) => ({
        id: `utsendelse-${s.id}`,
        href: `/admin/utsendelser/${s.id}`,
        cta: 'Åpne',
        tone: 'normal' as const,
        title:
          s.status === 'pause'
            ? `${s.navn} står på pause`
            : s.totals.sent === 0
              ? `${s.navn} er klar til å sendes (${count(s.totals.remaining)} mottakere)`
              : `${s.navn}: ${count(s.totals.remaining)} har ikke fått e-post ennå`,
      }));
  } catch {
    return [];
  }
}
