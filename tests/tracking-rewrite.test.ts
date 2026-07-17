import { describe, it, expect } from 'vitest';
import { rewriteHtmlForTracking, injectPixel } from '@/lib/tracking/rewrite';

/**
 * Pure regex-based html transform for click/open tracking. No DOM lib, no IO.
 * See task-3-brief.md — consumed later by the send-layer (Task 8), which
 * persists `links` as MessageLink rows (idx = array index).
 */

const baseUrl = 'https://skole.eksempel.no';
const token = 'tok_abc123';

describe('rewriteHtmlForTracking', () => {
  it('rewrites multiple distinct http(s) links in document order with matching idx', () => {
    const html =
      '<p><a href="https://example.com/one">One</a></p>' +
      '<p><a href="http://example.com/two">Two</a></p>' +
      '<p><a href="https://example.com/three">Three</a></p>';

    const { html: out, links } = rewriteHtmlForTracking(html, baseUrl, token);

    expect(links).toEqual([
      'https://example.com/one',
      'http://example.com/two',
      'https://example.com/three',
    ]);
    expect(out).toBe(
      `<p><a href="${baseUrl}/api/t/c/${token}/0">One</a></p>` +
        `<p><a href="${baseUrl}/api/t/c/${token}/1">Two</a></p>` +
        `<p><a href="${baseUrl}/api/t/c/${token}/2">Three</a></p>`,
    );
  });

  it('leaves mailto: hrefs untouched and out of links', () => {
    const html = '<a href="mailto:foo@example.com">Mail us</a>';
    const { html: out, links } = rewriteHtmlForTracking(html, baseUrl, token);
    expect(out).toBe(html);
    expect(links).toEqual([]);
  });

  it('leaves #anchor hrefs untouched and out of links', () => {
    const html = '<a href="#section-2">Jump</a>';
    const { html: out, links } = rewriteHtmlForTracking(html, baseUrl, token);
    expect(out).toBe(html);
    expect(links).toEqual([]);
  });

  it('leaves hrefs containing /avmeld untouched and out of links', () => {
    const html = '<a href="https://example.com/avmeld?token=abc">Avmeld deg</a>';
    const { html: out, links } = rewriteHtmlForTracking(html, baseUrl, token);
    expect(out).toBe(html);
    expect(links).toEqual([]);
  });

  it('leaves hrefs containing /api/avmeld untouched and out of links', () => {
    const html = '<a href="https://example.com/api/avmeld/xyz">Avmeld deg</a>';
    const { html: out, links } = rewriteHtmlForTracking(html, baseUrl, token);
    expect(out).toBe(html);
    expect(links).toEqual([]);
  });

  it('gives duplicate URLs separate idx entries (no dedupe)', () => {
    const html =
      '<a href="https://example.com/same">First</a>' +
      '<a href="https://example.com/same">Second</a>';

    const { html: out, links } = rewriteHtmlForTracking(html, baseUrl, token);

    expect(links).toEqual(['https://example.com/same', 'https://example.com/same']);
    expect(out).toBe(
      `<a href="${baseUrl}/api/t/c/${token}/0">First</a>` +
        `<a href="${baseUrl}/api/t/c/${token}/1">Second</a>`,
    );
  });

  it('handles single-quoted hrefs and normalizes output to double-quote form', () => {
    const html = `<a href='https://example.com/single'>Single</a>`;
    const { html: out, links } = rewriteHtmlForTracking(html, baseUrl, token);
    expect(links).toEqual(['https://example.com/single']);
    expect(out).toBe(`<a href="${baseUrl}/api/t/c/${token}/0">Single</a>`);
  });

  it('returns the original html unchanged (byte-identical) and links: [] when there are no qualifying links', () => {
    const html = '<p>No links here, just <a href="#top">an anchor</a> and <a href="mailto:x@y.no">mail</a>.</p>';
    const { html: out, links } = rewriteHtmlForTracking(html, baseUrl, token);
    expect(out).toBe(html);
    expect(links).toEqual([]);
  });
});

describe('injectPixel', () => {
  it('inserts the pixel immediately before </body>', () => {
    const html = '<html><body><p>Hei</p></body></html>';
    const out = injectPixel(html, baseUrl, token);
    expect(out).toBe(
      `<html><body><p>Hei</p><img src="${baseUrl}/api/t/o/${token}" width="1" height="1" alt="" style="display:none"></body></html>`,
    );
  });

  it('inserts the pixel before </BODY> (uppercase, case-insensitive match)', () => {
    const html = '<HTML><BODY><p>Hei</p></BODY></HTML>';
    const out = injectPixel(html, baseUrl, token);
    expect(out).toBe(
      `<HTML><BODY><p>Hei</p><img src="${baseUrl}/api/t/o/${token}" width="1" height="1" alt="" style="display:none"></BODY></HTML>`,
    );
  });

  it('appends the pixel at the very end when there is no </body> tag at all', () => {
    const html = '<p>Just a fragment, no wrapper</p>';
    const out = injectPixel(html, baseUrl, token);
    expect(out).toBe(
      `<p>Just a fragment, no wrapper</p><img src="${baseUrl}/api/t/o/${token}" width="1" height="1" alt="" style="display:none">`,
    );
  });
});

describe('rewriteHtmlForTracking + injectPixel chained (mirrors Task 8 send-layer usage)', () => {
  it('rewrites links and injects the pixel correctly when chained', () => {
    const bodyHtml =
      '<html><body>' +
      '<p><a href="https://example.com/a">A</a></p>' +
      '<p><a href="https://example.com/avmeld?token=abc">Avmeld deg</a></p>' +
      '</body></html>';

    const { html: rewritten, links } = rewriteHtmlForTracking(bodyHtml, baseUrl, token);
    const finalHtml = injectPixel(rewritten, baseUrl, token);

    expect(links).toEqual(['https://example.com/a']);
    expect(finalHtml).toBe(
      '<html><body>' +
        `<p><a href="${baseUrl}/api/t/c/${token}/0">A</a></p>` +
        '<p><a href="https://example.com/avmeld?token=abc">Avmeld deg</a></p>' +
        `<img src="${baseUrl}/api/t/o/${token}" width="1" height="1" alt="" style="display:none">` +
        '</body></html>',
    );
  });
});
