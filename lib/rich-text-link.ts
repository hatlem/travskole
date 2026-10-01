/** Lenker i rik tekst (e-postmaler o.l.): http(s), mailto, tel, interne stier, ankre og flettefelt. Ren modul. */

export type LinkInput = { ok: true; href: string } | { ok: false; error: string };

const INTERNAL_PATH_RE = /^\/(?!\/)\S*$/;
const ANCHOR_RE = /^#\S+$/;
const MERGE_TAG_RE = /^\{\{[a-z_]+\}\}$/;
// Flettefelt som fylles med en e-postadresse må bli mailto:, ellers blir lenken død.
const EMAIL_MERGE_TAGS = new Set(['{{kontakt_epost}}']);

/**
 * Tolker det admin skrev inn. «bjerke.no/kurs» får https:// foran; e-postadresser
 * blir mailto:. «/vilkar», «#svar» og «{{flettefelt}}» beholdes som de er.
 * Andre protokoller (javascript: o.l.) avvises.
 */
export function parseLinkInput(raw: string): LinkInput {
  const value = raw.trim();
  if (!value) return { ok: false, error: 'Skriv inn en nettadresse.' };
  if (INTERNAL_PATH_RE.test(value) || ANCHOR_RE.test(value)) return { ok: true, href: value };
  if (MERGE_TAG_RE.test(value)) return { ok: true, href: EMAIL_MERGE_TAGS.has(value) ? `mailto:${value}` : value };
  if (/^(mailto|tel):/i.test(value)) return { ok: true, href: value };
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(value)) return { ok: true, href: `mailto:${value}` };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, error: 'Bare vanlige nettadresser (https://), e-post og telefon kan brukes.' };
    }
    if (!url.hostname.includes('.')) return { ok: false, error: 'Sjekk nettadressen, f.eks. https://bjerke.no.' };
    return { ok: true, href: url.toString() };
  } catch {
    return { ok: false, error: 'Sjekk nettadressen, f.eks. https://bjerke.no.' };
  }
}
