// Sikkerhetsvakter for all KI-generert tekst: KI omskriver KUN språk — den
// får aldri introdusere lenker, priser eller datoer som ikke fantes i
// originalen, og merge-tagger må overleve uendret. Avvisning ⇒ kalleren
// faller tilbake til originalteksten (send-stier) eller viser norsk feil
// (editor). Ren funksjon, TDD'et i tests/ai-guardrails.test.ts.

const URL_RE = /https?:\/\/[^\s"'<>)]+/gi;
const PRICE_RE = /(?:kr\s*\d[\d\s.,]*|\d[\d\s.,]*\s*kr|NOK\s*\d[\d\s.,]*)/gi;
const DATE_RE = /(?:\d{1,2}\.\s?(?:januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember)|\b(?:mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)\b|\d{1,2}\.\d{1,2}\.\d{2,4}|\d{4}-\d{2}-\d{2})/gi;
const TAG_RE = /\{\{[a-z_]+\}\}/gi;

function matches(re: RegExp, text: string): string[] {
  return Array.from(text.matchAll(new RegExp(re.source, re.flags))).map((m) =>
    m[0].trim().replace(/[.,;:!?)\]]+$/, '').trim().toLowerCase(),
  );
}

export function extractMergeTags(text: string): string[] {
  return Array.from(new Set(matches(TAG_RE, text)));
}

export interface ValidateOpts {
  allowedNewTags?: string[];
  /** Krever at all lenke/pris/dato-innhold i originalen overlever i omskrivingen
   *  (i tillegg til at ingen nytt introduseres). Slås på for
   *  per-mottaker-personalisering (lib/flows/send.ts), der en fjernet CTA-lenke
   *  eller pris ville sendt en ødelagt markedsførings-e-post. Ikke satt for
   *  editor-assist (admin.no gjennomgår selv før publisering). */
  requireContentPreserved?: boolean;
}

export function validateAiRewrite(
  original: string,
  rewritten: string,
  opts: ValidateOpts = {},
): { ok: true } | { ok: false; reason: string } {
  if (rewritten.trim() === '') return { ok: false, reason: 'tomt svar' };
  if (original.trim() !== '' && rewritten.length > 3 * original.length) {
    return { ok: false, reason: 'uforholdsmessig langt svar' };
  }

  const origUrls = new Set(matches(URL_RE, original));
  const rewrittenUrls = new Set(matches(URL_RE, rewritten));
  for (const url of rewrittenUrls) {
    if (!origUrls.has(url)) return { ok: false, reason: 'ny lenke' };
  }

  const origPrices = new Set(matches(PRICE_RE, original));
  const rewrittenPrices = new Set(matches(PRICE_RE, rewritten));
  for (const price of rewrittenPrices) {
    if (!origPrices.has(price)) return { ok: false, reason: 'ny pris' };
  }

  const origDates = new Set(matches(DATE_RE, original));
  const rewrittenDates = new Set(matches(DATE_RE, rewritten));
  for (const date of rewrittenDates) {
    if (!origDates.has(date)) return { ok: false, reason: 'ny dato' };
  }

  if (opts.requireContentPreserved) {
    for (const url of origUrls) {
      if (!rewrittenUrls.has(url)) return { ok: false, reason: 'lenke fjernet' };
    }
    for (const price of origPrices) {
      if (!rewrittenPrices.has(price)) return { ok: false, reason: 'pris fjernet' };
    }
    for (const date of origDates) {
      if (!rewrittenDates.has(date)) return { ok: false, reason: 'dato fjernet' };
    }
  }

  const origTags = new Set(extractMergeTags(original));
  const newTags = extractMergeTags(rewritten);
  for (const tag of origTags) {
    if (!newTags.includes(tag)) return { ok: false, reason: 'merge-tag fjernet' };
  }
  const allowed = new Set([...origTags, ...(opts.allowedNewTags ?? []).map((t) => t.toLowerCase())]);
  for (const tag of newTags) {
    if (!allowed.has(tag)) return { ok: false, reason: 'ukjent merge-tag' };
  }

  return { ok: true };
}
