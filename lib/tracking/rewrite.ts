/**
 * Pure regex-based HTML transforms for email click/open tracking.
 *
 * No DOM parsing library, no IO — this runs on already-templated, trusted,
 * server-generated flow-email HTML (not arbitrary untrusted input), so a
 * careful regex is an acceptable and idiomatic choice here, matching the
 * pure-function/no-external-dep convention of lib/flows/graph.ts and
 * lib/payments/mapping.ts.
 *
 * Consumed by the Task 8 send-layer as:
 *   const { html: rewritten, links } = rewriteHtmlForTracking(bodyHtml, baseUrl, token);
 *   const finalHtml = injectPixel(rewritten, baseUrl, token);
 * `links` is then persisted as MessageLink rows (idx = array index).
 */

/** Matches an href attribute value in either double- or single-quote form. */
const HREF_PATTERN = /href\s*=\s*(["'])([^"']*)\1/gi;

/**
 * Rewrites every qualifying `href="http(s)://…"` (or single-quoted
 * equivalent) to `{baseUrl}/api/t/c/{token}/{idx}`, where idx is the
 * 0-based position of that URL in the returned `links` array (document
 * order). Output hrefs are always normalized to double-quote form,
 * regardless of the input quote style — this is intentional, not an
 * accidental side effect of the regex.
 *
 * Duplicate URLs are NOT deduped: each occurrence gets its own idx and its
 * own `links` entry, since each occurrence is a distinct click target that
 * the send layer will track as a distinct MessageLink row.
 *
 * Skipped (left byte-for-byte untouched, never added to `links`):
 *   - non-http(s) schemes (e.g. `mailto:`) — these simply won't match the
 *     http(s) prefix check below, but the check is explicit/defensive
 *   - same-page anchors (`#...`)
 *   - any URL containing `/avmeld` or `/api/avmeld` (the unsubscribe link —
 *     must always work even if tracking infra is broken, and must never be
 *     recorded as an "engagement" click; note `/api/avmeld` already
 *     contains the substring `/avmeld`, so a single substring check covers
 *     both cases)
 */
export function rewriteHtmlForTracking(
  html: string,
  baseUrl: string,
  token: string,
): { html: string; links: string[] } {
  const links: string[] = [];

  const rewritten = html.replace(HREF_PATTERN, (match, _quote: string, url: string) => {
    if (!/^https?:\/\//i.test(url)) return match;
    if (url.startsWith('#')) return match;
    if (url.includes('/avmeld')) return match;

    const idx = links.length;
    links.push(url);
    return `href="${baseUrl}/api/t/c/${token}/${idx}"`;
  });

  return { html: rewritten, links };
}

/** Case-insensitive match on the closing body tag (also matches `</BODY>`). */
const BODY_CLOSE_PATTERN = /<\/body\s*>/i;

/**
 * Inserts a 1x1 open-tracking pixel immediately before `</body>` (matched
 * case-insensitively). If the html has no `</body>` tag at all — flow-engine
 * email templates may be bare fragments without a full document wrapper —
 * the pixel is appended to the very end of the html string instead.
 */
export function injectPixel(html: string, baseUrl: string, token: string): string {
  const pixel = `<img src="${baseUrl}/api/t/o/${token}" width="1" height="1" alt="" style="display:none">`;

  if (BODY_CLOSE_PATTERN.test(html)) {
    return html.replace(BODY_CLOSE_PATTERN, (bodyClose) => `${pixel}${bodyClose}`);
  }

  return `${html}${pixel}`;
}
