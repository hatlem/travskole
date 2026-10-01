/** E-posttekst i flyter: sanitering ved lagring, kompatibilitet med tekstredigereren og forhåndsvisning. */
import DOMPurify from 'isomorphic-dompurify';
import { PREVIEW_MERGE_DATA, mergeTagsForAnchor, replaceMergeTags, type MergeTagData } from '@/lib/email-templates';

// Bredere enn sanitizeLegalHtml: eldre kursmaler kan ha tabeller, bilder og inline-stil.
const EMAIL_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'p', 'br', 'hr', 'ul', 'ol', 'li',
  'strong', 'b', 'em', 'i', 'u', 's', 'a', 'blockquote', 'code', 'pre',
  'span', 'div', 'center', 'font', 'img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
];
// Layout-attributtene e-postklienter fortsatt forstår (tabelloppsett, farger, størrelser).
const EMAIL_LAYOUT_ATTRS = [
  'target', 'rel', 'alt', 'title', 'width', 'height', 'align', 'valign', 'colspan', 'rowspan',
  'bgcolor', 'border', 'cellpadding', 'cellspacing', 'color', 'style',
];
const EMAIL_ATTRS = ['href', 'src', ...EMAIL_LAYOUT_ATTRS];
// {{flettefelt}} som hele lenken; verdien kontrolleres på nytt etter utfylling (renderFlowEmailBody).
const EMAIL_URI_RE = /^(?:(?:https?|mailto|tel):|\/(?!\/)|#|\{\{[a-z_]+\}\}$)/i;
// Inline-stil beholdes, men ikke CSS-escapes, gamle skript-hull eller url() til annet enn https.
const UNSAFE_STYLE_RE = /\\|expression\s*\(|javascript:|vbscript:|data:|-moz-binding|behaviou?r\s*:|@import|url\s*\(\s*(?!['"]?\s*https:\/\/)/i;

function dropUnsafeStyle(_node: Element, data: { attrName: string; attrValue: string; keepAttr: boolean }): void {
  if (data.attrName === 'style' && UNSAFE_STYLE_RE.test(data.attrValue)) data.keepAttr = false;
}

/**
 * Egen URI-regex gjør at DOMPurify også regex-sjekker attributter som ikke er URI-er,
 * så layout-attributtene må merkes URI-trygge eksplisitt — ellers forsvinner width/colspan/target ved lagring.
 */
export function sanitizeFlowEmailHtml(html: string): string {
  DOMPurify.addHook('uponSanitizeAttribute', dropUnsafeStyle);
  try {
    return DOMPurify.sanitize(html ?? '', {
      ALLOWED_TAGS: EMAIL_TAGS,
      ALLOWED_ATTR: EMAIL_ATTRS,
      ADD_URI_SAFE_ATTR: EMAIL_LAYOUT_ATTRS,
      ALLOWED_URI_REGEXP: EMAIL_URI_RE,
    });
  } finally {
    DOMPurify.removeHook('uponSanitizeAttribute', dropUnsafeStyle);
  }
}

/**
 * Saniterer bodyHtml i e-postnoder; andre noder og felt røres ikke. Uendret tekst
 * (lik `storedBodyHtml`) lagres som den er, så en lagring aldri endrer en mal ingen har rørt.
 */
export function sanitizeEmailNodeConfig(
  type: string,
  config: Record<string, unknown>,
  storedBodyHtml?: string,
): Record<string, unknown> {
  if (type !== 'email' || typeof config.bodyHtml !== 'string') return config;
  if (storedBodyHtml !== undefined && config.bodyHtml === storedBodyHtml) return config;
  return { ...config, bodyHtml: sanitizeFlowEmailHtml(config.bodyHtml) };
}

// Det Tiptap/StarterKit kan vise uten å miste noe.
const EDITOR_TAGS = new Set([
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'a', 'blockquote', 'code', 'pre',
]);
const EDITOR_LINK_ATTRS = new Set(['href', 'target', 'rel']);
const TAG_RE = /<\s*\/?\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
const ATTR_NAME_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?/g;

/** true når tekstredigereren kan åpne HTML-en uten å fjerne formatering (tabeller, farger, bilder …). */
export function isRichTextCompatible(html: string): boolean {
  if (/<!--|<style|<script/i.test(html)) return false;
  for (const match of html.matchAll(TAG_RE)) {
    const tag = match[1].toLowerCase();
    if (!EDITOR_TAGS.has(tag)) return false;
    const attrs = match[2].replace(/\/\s*$/, '').trim();
    if (!attrs) continue;
    for (const attr of attrs.matchAll(ATTR_NAME_RE)) {
      if (tag !== 'a' || !EDITOR_LINK_ATTRS.has(attr[1].toLowerCase())) return false;
    }
  }
  return true;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Ren tekst (uten tagger) blir avsnitt, så linjeskift ikke forsvinner i redigereren. */
export function toEditorHtml(body: string): string {
  if (/<[a-zA-Z][^>]*>/.test(body)) return body;
  return body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** Tiptap lagrer et tomt dokument som «<p></p>» — det er ingen tekst. */
export function isEmptyEmailBody(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() === '';
}

export interface MergeTagChip {
  tag: string;
  label: string;
}

const MERGE_TAG_LABELS: Record<string, string> = {
  '{{forelder_navn}}': 'Navn',
  '{{barnets_navn}}': 'Barnets navn',
  '{{kurs_navn}}': 'Kursnavn',
  '{{kurs_startdato}}': 'Kursstart',
  '{{kurs_sluttdato}}': 'Kursslutt',
  '{{allergier}}': 'Allergier',
  '{{kontakt_epost}}': 'Bjerkes e-post',
};

/** Flettefeltene som faktisk fylles ut i flytens forankring (kursfelt bare i kursflyter). */
export function mergeTagChips(anchorMode: string): MergeTagChip[] {
  return mergeTagsForAnchor(anchorMode).map((t) => ({ tag: t.tag, label: MERGE_TAG_LABELS[t.tag] ?? t.tag }));
}

/** Setter inn tekst ved markøren i et vanlig tekstfelt; returnerer ny verdi og ny markørposisjon. */
export function insertAtCursor(
  value: string,
  insert: string,
  selectionStart: number | null,
  selectionEnd: number | null,
): { value: string; cursor: number } {
  const start = selectionStart ?? value.length;
  const end = selectionEnd ?? start;
  return { value: value.slice(0, start) + insert + value.slice(end), cursor: start + insert.length };
}

/**
 * E-postteksten slik mottakeren får den: ren tekst blir avsnitt (som i redigereren),
 * flettefelt fylles inn, og resultatet saneres — så forhåndsvisning, test og utsending er like.
 */
export function renderFlowEmailBody(bodyHtml: string, data: MergeTagData): string {
  return sanitizeFlowEmailHtml(replaceMergeTags(toEditorHtml(bodyHtml), data));
}

/** Emne og tekst med eksempeldata, sanitert for visning i adminpanelet. */
export function renderFlowEmailPreview(subject: string, bodyHtml: string): { subject: string; html: string } {
  return {
    subject: replaceMergeTags(subject, PREVIEW_MERGE_DATA),
    html: renderFlowEmailBody(bodyHtml, PREVIEW_MERGE_DATA),
  };
}
