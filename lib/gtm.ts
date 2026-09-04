/**
 * Push av GTM-hendelser til dataLayer.
 *
 * Lå tidligere inline fire steder, hver gang med samme cast og
 * `w.dataLayer = w.dataLayer || []`. Den tilordningen skriver til en variabel
 * utenfor komponenten, noe React-reglene med rette reagerer på i en
 * komponentkropp — her er den samlet i én modulfunksjon i stedet.
 *
 * Trygg å kalle på serveren (no-op) og når GTM ikke er lastet: dataLayer er
 * bare en array GTM plukker opp når containeren kommer.
 */
export function pushDataLayerEvent(event: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;

  const w = window as unknown as { dataLayer?: Record<string, unknown>[] };
  w.dataLayer = w.dataLayer ?? [];
  w.dataLayer.push(event);
}
