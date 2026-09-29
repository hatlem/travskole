/**
 * Kjører det faktiske /t.js-skriptet i en node:vm-sandkasse med en minimal
 * falsk nettleser, og verifiserer samtykke-, cookie- og sendeoppførselen.
 */
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { buildEmbedScript } from '@/lib/tracking/embed-script';
import { FakeCookieJar } from './helpers/cookie-jar';

const CONSENT = JSON.stringify({ categories: ['necessary', 'analytics'], expiry: Date.now() + 86_400_000 });
const NO_CONSENT = JSON.stringify({ categories: ['necessary'], expiry: Date.now() + 86_400_000 });

type Listener = (e: { detail?: unknown; target?: unknown }) => void;

interface FakeEl {
  attrs: Record<string, string>;
  href?: string;
  parent?: FakeEl;
  matches(selector: string): boolean;
}

function el(attrs: Record<string, string>, parent?: FakeEl, href?: string): FakeEl {
  return {
    attrs,
    href,
    parent,
    matches(selector: string) {
      if (selector === '[data-bjerke-track]') return 'data-bjerke-track' in this.attrs;
      if (selector === 'a[href]') return this.href !== undefined;
      return false;
    },
  };
}

function asTarget(node: FakeEl) {
  return {
    closest(selector: string) {
      for (let n: FakeEl | undefined = node; n; n = n.parent) {
        if (n.matches(selector)) return { href: n.href, getAttribute: (name: string) => n!.attrs[name] ?? null };
      }
      return null;
    },
  };
}

function setup({
  pageUrl = 'https://www.bjerke.no/travskole?email=a@b.no&utm_source=fb',
  storedConsent = null as string | null,
  scriptSrc = 'https://registrering.bjerke.no/t.js',
  withFetch = true,
} = {}) {
  const url = new URL(pageUrl);
  const jar = new FakeCookieJar(url.hostname);
  const winListeners: Record<string, Listener[]> = {};
  const docListeners: Record<string, Listener[]> = {};
  const requests: { url: string; init?: Record<string, unknown>; body: Record<string, unknown> }[] = [];
  const beacons: { url: string; body: Record<string, unknown> }[] = [];

  const document = {
    get cookie() {
      return jar.cookie;
    },
    set cookie(v: string) {
      jar.cookie = v;
    },
    referrer: 'https://www.google.com/search?q=bjerke',
    title: 'Travskole | Bjerke',
    currentScript: scriptSrc ? { src: scriptSrc } : null,
    addEventListener: (type: string, fn: Listener) => (docListeners[type] ??= []).push(fn),
  };
  const storage: Record<string, string> = storedConsent ? { getcookies_consent: storedConsent } : {};
  const window: Record<string, unknown> = {
    location: { href: url.href, host: url.host, hostname: url.hostname, pathname: url.pathname, protocol: url.protocol },
    localStorage: {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => (storage[k] = v),
    },
    crypto: webcrypto,
    navigator: {
      sendBeacon: (u: string, body: string) => {
        beacons.push({ url: u, body: JSON.parse(body) });
        return true;
      },
    },
    addEventListener: (type: string, fn: Listener) => (winListeners[type] ??= []).push(fn),
  };
  if (withFetch) {
    window.fetch = (u: string, init: Record<string, unknown>) => {
      requests.push({ url: u, init, body: JSON.parse(init.body as string) });
      return Promise.resolve({});
    };
  }

  const context = vm.createContext({ window, document, URL, Date, JSON, Uint8Array });
  const run = () => vm.runInContext(buildEmbedScript('https://registrering.bjerke.no'), context);
  run();

  return {
    jar,
    requests,
    beacons,
    storage,
    run,
    fire: (type: string, detail?: unknown) => (winListeners[type] ?? []).forEach((fn) => fn({ detail })),
    click: (node: FakeEl) => (docListeners.click ?? []).forEach((fn) => fn({ target: asTarget(node) })),
  };
}

describe('t.js (bjerke.no-skriptet)', () => {
  it('bruker ES2017-syntaks (ingen ?. eller ??)', () => {
    const src = buildEmbedScript('https://registrering.bjerke.no');
    expect(src).not.toMatch(/\?\.|\?\?/);
    expect(src).not.toContain('__COOKIE__');
  });

  it('uten samtykke: ingen cookie, ingen forespørsler', () => {
    const t = setup({ storedConsent: NO_CONSENT });
    t.fire('getcookies:loaded');
    t.click(el({ 'data-bjerke-track': 'hero' }));
    expect(t.jar.list()).toEqual([]);
    expect(t.jar.writes.every((w) => w.includes('Max-Age=0'))).toBe(true);
    expect(t.requests).toEqual([]);
  });

  it('samtykke gitt før lasting: delt cookie og page.viewed med renset URL', () => {
    const t = setup({ storedConsent: CONSENT });
    const [cookie] = t.jar.list();
    expect(cookie.domain).toBe('.bjerke.no');
    expect(t.jar.writes[0]).toMatch(/SameSite=Lax; Domain=\.bjerke\.no; Secure$/);

    expect(t.requests).toHaveLength(1);
    const [req] = t.requests;
    expect(req.url).toBe('https://registrering.bjerke.no/api/track');
    expect(req.init).toMatchObject({ method: 'POST', credentials: 'include', keepalive: true, mode: 'cors' });
    expect(req.body).toEqual({
      type: 'page.viewed',
      publicId: cookie.value,
      meta: {
        path: '/travskole',
        url: 'https://www.bjerke.no/travskole?utm_source=fb',
        referrer: 'https://www.google.com/search',
        title: 'Travskole | Bjerke',
      },
    });
  });

  it('samtykke gitt etter lasting via event (også implisitt samtykke i detail)', () => {
    const t = setup();
    expect(t.requests).toHaveLength(0);
    t.fire('getcookies:consent', { categories: ['analytics'] });
    expect(t.requests.map((r) => r.body.type)).toEqual(['page.viewed']);
    t.fire('getcookies:consent-updated', { categories: ['analytics'] });
    expect(t.requests).toHaveLength(1); // ingen dobbel sidevisning
  });

  it('gjenbruker eksisterende delt besøker-ID', () => {
    const id = '33333333-3333-4333-8333-333333333333';
    const t = setup();
    t.jar.seed('bjerke_vid', id, '.bjerke.no');
    t.fire('getcookies:consent', { categories: ['analytics'] });
    expect(t.requests[0].body.publicId).toBe(id);
  });

  it('manglende samtykke på dette nettstedet sletter ikke den delte cookien', () => {
    const id = '44444444-4444-4444-8444-444444444444';
    const t = setup();
    t.jar.seed('bjerke_vid', id, '.bjerke.no');
    t.fire('getcookies:loaded');
    t.fire('getcookies:consent');
    expect(t.jar.list().map((c) => c.value)).toEqual([id]);
    expect(t.requests).toHaveLength(0);
  });

  it('trukket samtykke sletter cookien og stopper sending', () => {
    const t = setup({ storedConsent: CONSENT });
    t.storage.getcookies_consent = NO_CONSENT;
    t.fire('getcookies:consent-updated', { categories: ['necessary'] });
    expect(t.jar.list()).toEqual([]);
    t.click(el({ 'data-bjerke-track': 'hero' }));
    expect(t.requests).toHaveLength(1);
  });

  it('cta.clicked for data-bjerke-track og lenker til registrering', () => {
    const t = setup({ storedConsent: CONSENT });
    const wrapper = el({ 'data-bjerke-track': 'kurs-banner' });
    t.click(el({}, wrapper));
    t.click(el({}, undefined, 'https://registrering.bjerke.no/arrangementer?ref=x&utm_campaign=vinter'));
    t.click(el({}, undefined, 'https://www.bjerke.no/om-oss'));
    const ctas = t.requests.filter((r) => r.body.type === 'cta.clicked').map((r) => r.body.meta);
    expect(ctas).toEqual([
      { ctaId: 'kurs-banner', path: '/travskole' },
      {
        ctaId: 'registrering-lenke',
        path: '/travskole',
        href: 'https://registrering.bjerke.no/arrangementer?utm_campaign=vinter',
      },
    ]);
  });

  it('gjør ingenting på registrering.bjerke.no (egen tracker der)', () => {
    const t = setup({ pageUrl: 'https://registrering.bjerke.no/', storedConsent: CONSENT });
    expect(t.requests).toEqual([]);
    expect(t.jar.writes).toEqual([]);
  });

  it('lastes bare én gang', () => {
    const t = setup({ storedConsent: CONSENT });
    t.run();
    expect(t.requests).toHaveLength(1);
  });

  it('faller tilbake til sendBeacon uten fetch', () => {
    const t = setup({ storedConsent: CONSENT, withFetch: false });
    expect(t.beacons).toHaveLength(1);
    expect(t.beacons[0].url).toBe('https://registrering.bjerke.no/api/track');
  });

  it('host-only cookie utenfor bjerke.no (f.eks. staging)', () => {
    const t = setup({ pageUrl: 'http://localhost:4000/', storedConsent: CONSENT, scriptSrc: 'http://localhost:3100/t.js' });
    expect(t.jar.writes[0]).not.toContain('Domain=');
    expect(t.jar.writes[0]).not.toContain('Secure');
    expect(t.requests[0].url).toBe('http://localhost:3100/api/track');
  });
});
