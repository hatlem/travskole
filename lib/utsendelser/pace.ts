/** Fart på utsendelsen: valgene og tekstene som vises. Trygg å bruke i nettleseren. */
export const PACE_OPTIONS = [50, 100, 200, 400] as const;

/** «ca. 4,5 timer» for resten av mottakerne, eller null når det ikke er noe å vise. */
export function paceDuration(remaining: number, perHour: number): string | null {
  if (remaining <= 0 || perHour <= 0) return null;
  const hours = remaining / perHour;
  if (hours < 1) {
    const minutes = Math.max(5, Math.ceil((hours * 60) / 5) * 5);
    return `ca. ${minutes} minutter`;
  }
  const rounded = Math.round(hours * 2) / 2;
  return `ca. ${rounded.toLocaleString('nb-NO')} ${rounded === 1 ? 'time' : 'timer'}`;
}

/** « De går ut litt av litt …» til en bekreftelse, eller tom streng når alt går i én bolk. */
export function paceSentence(count: number, perHour: number): string {
  const duration = paceDuration(count, perHour);
  if (!duration || count <= Math.ceil(perHour / 12)) return '';
  return ` De går ut litt av litt, ca. ${perHour} i timen, så alle har fått den om ${duration}.`;
}

/** «15:40» i norsk tid. */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' });
}
