// Sikkerhetsvakter for all KI-generert tekst: KI omskriver språk — den får
// aldri introdusere lenker, og priser/datoer/tall kun hvis de står i
// originalen eller i det oppgitte faktagrunnlaget (mottakerens historikk).
// Merge-tagger må overleve uendret. Avvisning ⇒ kalleren faller tilbake til
// originalteksten (send-stier) eller viser norsk feil (editor). Ren funksjon,
// TDD'et i tests/ai-guardrails.test.ts.

const URL_RE = /https?:\/\/[^\s"'<>)]+/gi;
const AMOUNT = String.raw`\d{1,3}(?:[   .]\d{3})+(?:,(?:\d{1,2}|-))?|\d+(?:,(?:\d{1,2}|-))?`;
const PRICE_RE = new RegExp(String.raw`(?:kr\.?|nok)\s*(?:${AMOUNT})|(?:${AMOUNT})\s*(?:kroner|kr|nok)\b`, 'gi');
const DATE_RE = /(?:\d{1,2}\.\s?(?:januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember)|\b(?:mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)\b|\d{1,2}\.\d{1,2}\.\d{2,4}|\d{4}-\d{2}-\d{2})/gi;
const TAG_RE = /\{\{[a-z_]+\}\}/gi;
const THOUSANDS_RE = /(?<!\d)\d{1,3}(?:[   .]\d{3})+(?!\d)/g;

function matches(re: RegExp, text: string): string[] {
  return Array.from(text.matchAll(new RegExp(re.source, re.flags))).map((m) =>
    m[0].trim().replace(/[.,;:!?)\]]+$/, '').trim().toLowerCase(),
  );
}

/** «kr 1 500,-», «1.500 kroner» og «NOK 1500» → «1500». */
function canonicalPrice(raw: string): string {
  return raw
    .replace(/kroner|kr\.?|nok/gi, '')
    .replace(/[\s  ]/g, '')
    .replace(/,-$/, '')
    .replace(/,0{1,2}$/, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '');
}

const canonicalDate = (raw: string): string => raw.replace(/\s+/g, '');

/** Synlig tekst: uten tagger, lenker og merge-tagger, med vanlige entiteter dekodet. */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(URL_RE, ' ')
    .replace(TAG_RE, ' ');
}

/** Alle tall i synlig tekst, med tusenskille slått sammen og ledende nuller fjernet. */
function numbersIn(text: string): Set<string> {
  const joined = visibleText(text).replace(THOUSANDS_RE, (m) => m.replace(/\D/g, ''));
  return new Set(Array.from(joined.matchAll(/\d+/g)).map((m) => m[0].replace(/^0+(?=\d)/, '')));
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
  /** Faktagrunnlaget modellen fikk (mottakerhistorikk). Når satt, godtas nye
   *  priser/datoer/tall som står i grunnlaget, og ALLE tall i den synlige
   *  teksten må finnes i originalen eller grunnlaget («nytt tall» ellers). */
  factSource?: string;
}

export type RewriteVerdict = { ok: true } | { ok: false; reason: string };

export function validateAiRewrite(
  original: string,
  rewritten: string,
  opts: ValidateOpts = {},
): RewriteVerdict {
  if (rewritten.trim() === '') return { ok: false, reason: 'tomt svar' };
  if (original.trim() !== '' && rewritten.length > 3 * original.length) {
    return { ok: false, reason: 'uforholdsmessig langt svar' };
  }
  const facts = opts.factSource ?? '';

  const origUrls = new Set(matches(URL_RE, original));
  const rewrittenUrls = new Set(matches(URL_RE, rewritten));
  for (const url of rewrittenUrls) {
    if (!origUrls.has(url)) return { ok: false, reason: 'ny lenke' };
  }

  const origPrices = new Set(matches(PRICE_RE, original).map(canonicalPrice));
  const allowedPrices = new Set([...origPrices, ...matches(PRICE_RE, facts).map(canonicalPrice)]);
  const rewrittenPrices = new Set(matches(PRICE_RE, rewritten).map(canonicalPrice));
  for (const price of rewrittenPrices) {
    if (!allowedPrices.has(price)) return { ok: false, reason: 'ny pris' };
  }

  const origDates = new Set(matches(DATE_RE, original).map(canonicalDate));
  const allowedDates = new Set([...origDates, ...matches(DATE_RE, facts).map(canonicalDate)]);
  const rewrittenDates = new Set(matches(DATE_RE, rewritten).map(canonicalDate));
  for (const date of rewrittenDates) {
    if (!allowedDates.has(date)) return { ok: false, reason: 'ny dato' };
  }

  if (opts.factSource !== undefined) {
    const allowedNumbers = new Set([...numbersIn(original), ...numbersIn(facts)]);
    for (const n of numbersIn(rewritten)) {
      if (!allowedNumbers.has(n)) return { ok: false, reason: 'nytt tall' };
    }
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
