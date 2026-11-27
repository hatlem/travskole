/** Standardsvar: rene hjelpere uten databasetilgang (brukes også i nettleseren). */

export const MAX_STANDARD_REPLIES = 8;
export const MAX_STANDARD_TEXT = 2_000;

export const DEFAULT_STANDARD_REPLIES = [
  'Hei {fornavn}!\n\nOK, takk for hyggelig tilbakemelding 😊',
  'Hei {fornavn}!\n\nTakk for svar. Vi tar kontakt igjen før neste års julebord.',
  'Hei {fornavn}!\n\nTakk for beskjed. Ta gjerne kontakt hvis dere har spørsmål.',
];

/** Lagret verdi (JSON-liste) til en ren liste. Ugyldig eller tom gir standardlista. */
export function parseStandardReplies(raw: string | null | undefined): string[] {
  if (!raw) return [...DEFAULT_STANDARD_REPLIES];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_STANDARD_REPLIES];
    return cleanStandardReplies(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return [...DEFAULT_STANDARD_REPLIES];
  }
}

/** Trimmer, fjerner tomme og like, og kutter til maks antall. */
export function cleanStandardReplies(texts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of texts) {
    const t = text.trim().slice(0, MAX_STANDARD_TEXT);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length === MAX_STANDARD_REPLIES) break;
  }
  return out;
}

/** Kort tekst til knappen: første linje som ikke bare er en hilsen. */
export function standardReplyLabel(text: string, max = 48): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const line = lines.find((l) => !/^(hei|hallo|god (morgen|dag|ettermiddag))\b[^.?]{0,25}[!,.]?$/i.test(l)) ?? lines[0] ?? '';
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}
