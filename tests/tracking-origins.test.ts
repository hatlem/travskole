import { describe, it, expect } from 'vitest';
import { decideOrigin, normalizeOrigin, parseAllowedOrigins, preflightHeaders } from '@/lib/tracking/origins';
import { validateSettingValue } from '@/lib/settings-shared';

const allowed = ['https://bjerke.no', 'https://www.bjerke.no'];
const self = ['registrering.bjerke.no'];

describe('parseAllowedOrigins', () => {
  it('parser standardverdien', () => {
    expect(parseAllowedOrigins('https://bjerke.no,https://www.bjerke.no')).toEqual(allowed);
  });

  it('godtar linjeskift, mellomrom, avsluttende skråstrek og bare vertsnavn', () => {
    expect(parseAllowedOrigins(' https://Bjerke.no/ \n www.bjerke.no, ,http://localhost:3100')).toEqual([
      'https://bjerke.no',
      'https://www.bjerke.no',
      'http://localhost:3100',
    ]);
  });

  it('dropper wildcard, null, stier og andre protokoller', () => {
    expect(
      parseAllowedOrigins('*,null,https://*.bjerke.no,https://bjerke.no/side,ftp://bjerke.no,https://u:p@bjerke.no'),
    ).toEqual([]);
  });

  it('dedupliserer og tåler tom verdi', () => {
    expect(parseAllowedOrigins('https://bjerke.no,https://bjerke.no')).toEqual(['https://bjerke.no']);
    expect(parseAllowedOrigins('')).toEqual([]);
    expect(parseAllowedOrigins(null)).toEqual([]);
  });
});

describe('validateSettingValue(tracking_allowed_origins)', () => {
  it('godtar gyldige lister og tom verdi', () => {
    expect(validateSettingValue('tracking_allowed_origins', 'https://bjerke.no, www.bjerke.no')).toBeNull();
    expect(validateSettingValue('tracking_allowed_origins', '')).toBeNull();
  });

  it('avviser og navngir ugyldige oppføringer', () => {
    expect(validateSettingValue('tracking_allowed_origins', 'https://bjerke.no,*')).toContain('*');
    expect(validateSettingValue('tracking_allowed_origins', 'https://bjerke.no/side')).toContain('https://bjerke.no/side');
    expect(validateSettingValue('tracking_allowed_origins', 'null')).toContain('null');
  });
});

describe('normalizeOrigin', () => {
  it('fjerner standardport og normaliserer case', () => {
    expect(normalizeOrigin('HTTPS://BJERKE.NO:443')).toBe('https://bjerke.no');
  });
  it('avviser ugyldige verdier', () => {
    expect(normalizeOrigin('null')).toBeNull();
    expect(normalizeOrigin('bjerke.no')).toBeNull();
  });
});

describe('decideOrigin', () => {
  it('uten Origin er det registrering selv', () => {
    expect(decideOrigin(null, self, allowed)).toEqual({ ok: true, site: 'registrering', cors: null });
  });

  it('egen host er registrering uten CORS-headere', () => {
    expect(decideOrigin('https://registrering.bjerke.no', self, allowed)).toEqual({
      ok: true,
      site: 'registrering',
      cors: null,
    });
  });

  it('tillatt origin er bjerke.no med eksakt CORS-origin', () => {
    expect(decideOrigin('https://www.bjerke.no', self, allowed)).toEqual({
      ok: true,
      site: 'bjerke.no',
      cors: 'https://www.bjerke.no',
    });
  });

  it('avviser ukjente og lurendreier-origins', () => {
    expect(decideOrigin('https://evil.example', self, allowed)).toEqual({ ok: false });
    expect(decideOrigin('https://bjerke.no.evil.example', self, allowed)).toEqual({ ok: false });
    expect(decideOrigin('http://bjerke.no', self, allowed)).toEqual({ ok: false });
    expect(decideOrigin('null', self, allowed)).toEqual({ ok: false });
  });
});

describe('preflightHeaders', () => {
  it('ekko av origin med credentials, aldri wildcard', () => {
    const h = preflightHeaders('https://bjerke.no');
    expect(h['Access-Control-Allow-Origin']).toBe('https://bjerke.no');
    expect(h['Access-Control-Allow-Credentials']).toBe('true');
    expect(h.Vary).toBe('Origin');
  });
});
