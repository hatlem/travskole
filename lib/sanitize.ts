import DOMPurify from 'isomorphic-dompurify';

// Hvitliste som dekker det Tiptap-editoren produserer for juridiske sider.
// Kjøres både ved lagring (server-API) og ved rendering (defense-in-depth),
// siden admin-rollen nå kan redigere innholdet.
const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'p', 'br', 'hr',
  'ul', 'ol', 'li',
  'strong', 'b', 'em', 'i', 'u', 's',
  'a', 'blockquote', 'code', 'pre',
];

const ALLOWED_ATTR = ['href', 'target', 'rel'];

/**
 * Saniterer admin-redigert HTML for juridiske sider. Fjerner script, style,
 * event-handlere og uautoriserte tagger/attributter, og tvinger trygge
 * rel/target på eksterne lenker.
 */
export function sanitizeLegalHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty ?? '', {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Tillat kun http(s), mailto og interne relative lenker
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|\/(?!\/)|#)/i,
    ADD_ATTR: ['target'],
  });
}
