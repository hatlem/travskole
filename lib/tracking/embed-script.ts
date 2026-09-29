// Innbyggbart sporingsskript for bjerke.no (serveres som /t.js). Avhengighetsfritt
// ES2017 (ingen ?. / ??) fordi det kjører på et nettsted vi ikke kontrollerer.
// HARD regel som Tracker.tsx: uten analytics-samtykke fra getcookies settes
// ingen cookie og sendes ingenting.

import { VISITOR_COOKIE } from '@/lib/events/constants';
import { SHARED_COOKIE_BASE_DOMAIN, VISITOR_COOKIE_MAX_AGE } from '@/lib/tracking/visitor-cookie';

const SOURCE = String.raw`(function (w, d) {
  'use strict';
  if (w.__bjerkeTrack) return;
  w.__bjerkeTrack = true;

  var COOKIE = __COOKIE__;
  var BASE = __BASE__;
  var MAX_AGE = __MAX_AGE__;
  var script = d.currentScript;
  var endpointOrigin = __ORIGIN__;
  try {
    if (script && script.src) endpointOrigin = new URL(script.src).origin;
  } catch (e) {}
  var endpointHost = new URL(endpointOrigin).host;
  // registrering.bjerke.no har sin egen tracker — ikke dobbeltell via delt GTM-container.
  if (w.location.host === endpointHost) return;
  var ENDPOINT = endpointOrigin + '/api/track';
  var enabled = false;

  function sharedDomain() {
    var h = w.location.hostname.toLowerCase();
    return h === BASE || h.slice(-(BASE.length + 1)) === '.' + BASE ? '.' + BASE : null;
  }

  function cookieAttrs(maxAge) {
    var domain = sharedDomain();
    var attrs = '; Path=/; Max-Age=' + maxAge + '; SameSite=Lax';
    if (domain) attrs += '; Domain=' + domain;
    if (domain || w.location.protocol === 'https:') attrs += '; Secure';
    return attrs;
  }

  function readCookie() {
    var parts = d.cookie ? d.cookie.split(/;\s*/) : [];
    for (var i = 0; i < parts.length; i++) {
      var eq = parts[i].indexOf('=');
      if (eq > 0 && parts[i].slice(0, eq) === COOKIE) {
        var v = parts[i].slice(eq + 1);
        if (/^[0-9a-f-]{36}$/i.test(v)) return v;
      }
    }
    return null;
  }

  function uuid() {
    if (w.crypto && typeof w.crypto.randomUUID === 'function') return w.crypto.randomUUID();
    var b = new Uint8Array(16);
    w.crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    var hex = '';
    for (var i = 0; i < 16; i++) hex += (b[i] + 256).toString(16).slice(1);
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function ensureVisitorId() {
    var id = readCookie() || uuid();
    d.cookie = COOKIE + '=' + id + cookieAttrs(MAX_AGE);
    return readCookie();
  }

  function deleteVisitorCookie() {
    d.cookie = COOKIE + '=; Path=/; Max-Age=0; SameSite=Lax';
    if (sharedDomain()) d.cookie = COOKIE + '=' + cookieAttrs(0);
  }

  function hasConsent(raw) {
    if (!raw) return false;
    try {
      var c = JSON.parse(raw);
      if (!c || typeof c !== 'object') return false;
      if (typeof c.expiry === 'number' && Date.now() > c.expiry) return false;
      return Array.isArray(c.categories) && c.categories.indexOf('analytics') !== -1;
    } catch (e) {
      return false;
    }
  }

  function storedConsent() {
    try {
      return hasConsent(w.localStorage.getItem('getcookies_consent'));
    } catch (e) {
      return false;
    }
  }

  function detailGrants(detail) {
    return !!detail && typeof detail === 'object' && Array.isArray(detail.categories) &&
      detail.categories.indexOf('analytics') !== -1;
  }

  function cleanUrl(raw, keepUtm) {
    try {
      var u = new URL(raw, w.location.href);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
      var q = [];
      if (keepUtm) {
        u.searchParams.forEach(function (value, key) {
          if (key.toLowerCase().indexOf('utm_') === 0) q.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
        });
      }
      return (u.origin + u.pathname + (q.length ? '?' + q.join('&') : '')).slice(0, 500);
    } catch (e) {
      return '';
    }
  }

  function send(type, meta) {
    var publicId = readCookie();
    if (!publicId) return;
    var body = JSON.stringify({ type: type, publicId: publicId, meta: meta });
    try {
      w.fetch(ENDPOINT, {
        method: 'POST',
        mode: 'cors',
        credentials: 'include',
        keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: body
      }).catch(function () {});
    } catch (e) {
      if (w.navigator.sendBeacon) w.navigator.sendBeacon(ENDPOINT, body);
    }
  }

  function pageMeta() {
    var meta = { path: w.location.pathname.slice(0, 300), url: cleanUrl(w.location.href, true) };
    var ref = d.referrer ? cleanUrl(d.referrer, false) : '';
    if (ref) meta.referrer = ref;
    var title = (d.title || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (title) meta.title = title;
    return meta;
  }

  function enable() {
    if (enabled) return;
    if (!ensureVisitorId()) return;
    enabled = true;
    send('page.viewed', pageMeta());
  }

  function disable() {
    enabled = false;
    deleteVisitorCookie();
  }

  function onConsent(e) {
    if (storedConsent() || detailGrants(e && e.detail)) enable();
    else disable();
  }

  function onClick(e) {
    if (!enabled || !e.target || typeof e.target.closest !== 'function') return;
    var el = e.target.closest('[data-bjerke-track]');
    var link = e.target.closest('a[href]');
    var href = link ? link.href : '';
    var label = el ? String(el.getAttribute('data-bjerke-track') || '').trim() : '';
    if (!el) {
      try {
        if (!href || new URL(href).host !== endpointHost) return;
      } catch (err) {
        return;
      }
      label = 'registrering-lenke';
    }
    var meta = { ctaId: (label || 'cta').slice(0, 80), path: w.location.pathname.slice(0, 300) };
    var cleanHref = href ? cleanUrl(href, true) : '';
    if (cleanHref) meta.href = cleanHref;
    send('cta.clicked', meta);
  }

  w.addEventListener('getcookies:consent', onConsent);
  w.addEventListener('getcookies:consent-updated', onConsent);
  w.addEventListener('getcookies:loaded', onConsent);
  d.addEventListener('click', onClick, true);
  if (storedConsent()) enable();
})(window, document);
`;

/** Skriptkilden med konstanter bakt inn. `fallbackOrigin` brukes hvis currentScript mangler. */
export function buildEmbedScript(fallbackOrigin: string): string {
  return SOURCE.replace('__COOKIE__', JSON.stringify(VISITOR_COOKIE))
    .replace('__BASE__', JSON.stringify(SHARED_COOKIE_BASE_DOMAIN))
    .replace('__MAX_AGE__', String(VISITOR_COOKIE_MAX_AGE))
    .replace('__ORIGIN__', JSON.stringify(new URL(fallbackOrigin).origin));
}
