import type { AttentionItem } from '@/lib/dashboard-attention';
import { getUtsendelser } from './config';
import { loadUtsendelseSummary } from './overview';

const count = (n: number) => n.toLocaleString('nb-NO');

/** Utsendelser med noen som ikke har fått e-post ennå, til «Krever oppmerksomhet». Feil skjuler bare kortet. */
export async function utsendelseAttentionItems(): Promise<AttentionItem[]> {
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
