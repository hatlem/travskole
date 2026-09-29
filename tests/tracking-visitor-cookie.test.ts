import { describe, it, expect } from 'vitest';
import {
  adoptSharedVisitorCookie,
  buildVisitorCookie,
  buildVisitorCookieDeletions,
  readCookieValues,
  visitorCookieDomain,
} from '@/lib/tracking/visitor-cookie';
import { FakeCookieJar } from './helpers/cookie-jar';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('visitorCookieDomain', () => {
  it('deler på bjerke.no og alle underdomener', () => {
    expect(visitorCookieDomain('bjerke.no')).toBe('.bjerke.no');
    expect(visitorCookieDomain('www.bjerke.no')).toBe('.bjerke.no');
    expect(visitorCookieDomain('registrering.bjerke.no:443')).toBe('.bjerke.no');
    expect(visitorCookieDomain('REGISTRERING.BJERKE.NO.')).toBe('.bjerke.no');
  });

  it('host-only ellers', () => {
    expect(visitorCookieDomain('localhost:3100')).toBeNull();
    expect(visitorCookieDomain('notbjerke.no')).toBeNull();
    expect(visitorCookieDomain('bjerke.no.evil.example')).toBeNull();
    expect(visitorCookieDomain('travskole.azurewebsites.net')).toBeNull();
    expect(visitorCookieDomain(null)).toBeNull();
  });
});

describe('buildVisitorCookie', () => {
  it('delt domene er alltid Secure + SameSite=Lax', () => {
    expect(buildVisitorCookie(A, { host: 'registrering.bjerke.no', https: false })).toBe(
      `bjerke_vid=${A}; Path=/; Max-Age=34128000; SameSite=Lax; Domain=.bjerke.no; Secure`,
    );
  });

  it('localhost over http er host-only uten Secure', () => {
    expect(buildVisitorCookie(A, { host: 'localhost', https: false })).toBe(
      `bjerke_vid=${A}; Path=/; Max-Age=34128000; SameSite=Lax`,
    );
  });

  it('sletting dekker både host-only og domene', () => {
    const deletions = buildVisitorCookieDeletions({ host: 'www.bjerke.no', https: true });
    expect(deletions).toHaveLength(2);
    expect(deletions.every((d) => d.includes('Max-Age=0'))).toBe(true);
    expect(deletions[1]).toContain('Domain=.bjerke.no');
    expect(buildVisitorCookieDeletions({ host: 'localhost', https: false })).toHaveLength(1);
  });
});

describe('readCookieValues', () => {
  it('returnerer alle verdier for navnet', () => {
    expect(readCookieValues(`a=1; bjerke_vid=${A}; bjerke_vid=${B}; bjerke_vidx=3`)).toEqual([A, B]);
    expect(readCookieValues(null)).toEqual([]);
    expect(readCookieValues('bjerke_vid=%E0%A4%A')).toEqual([]);
  });
});

describe('adoptSharedVisitorCookie', () => {
  const opts = { host: 'registrering.bjerke.no', https: true };

  it('gjør eksisterende host-only-cookie om til delt cookie med samme ID', () => {
    const jar = new FakeCookieJar('registrering.bjerke.no');
    jar.seed('bjerke_vid', A, null);
    expect(adoptSharedVisitorCookie(jar, opts)).toBe(A);
    expect(jar.list()).toEqual([{ name: 'bjerke_vid', value: A, domain: '.bjerke.no' }]);
  });

  it('host-only-verdien vinner over en ny delt cookie fra bjerke.no', () => {
    const jar = new FakeCookieJar('registrering.bjerke.no');
    jar.seed('bjerke_vid', B, '.bjerke.no');
    jar.seed('bjerke_vid', A, null);
    expect(adoptSharedVisitorCookie(jar, opts)).toBe(A);
    expect(jar.list()).toEqual([{ name: 'bjerke_vid', value: A, domain: '.bjerke.no' }]);
  });

  it('beholder delt cookie fra bjerke.no', () => {
    const jar = new FakeCookieJar('registrering.bjerke.no');
    jar.seed('bjerke_vid', B, '.bjerke.no');
    expect(adoptSharedVisitorCookie(jar, opts)).toBe(B);
    expect(jar.list()).toEqual([{ name: 'bjerke_vid', value: B, domain: '.bjerke.no' }]);
  });

  it('null uten cookie, og rører ikke localhost-cookies', () => {
    expect(adoptSharedVisitorCookie(new FakeCookieJar('registrering.bjerke.no'), opts)).toBeNull();
    const local = new FakeCookieJar('localhost');
    local.seed('bjerke_vid', A, null);
    expect(adoptSharedVisitorCookie(local, { host: 'localhost', https: false })).toBe(A);
    expect(local.writes).toEqual([]);
  });
});
