import { describe, it, expect } from 'vitest';
import { STRINGS, STRING_SECTIONS, getString, formatString, makeT } from '@/lib/strings';

describe('STRINGS catalog', () => {
  it('every key belongs to a known section', () => {
    const sections = Object.keys(STRING_SECTIONS);
    for (const key of Object.keys(STRINGS)) {
      const prefix = key.split('.')[0];
      expect(sections, `unknown section for key "${key}"`).toContain(prefix);
    }
  });

  it('no empty default texts', () => {
    for (const [key, value] of Object.entries(STRINGS)) {
      expect(value.length, `empty default for "${key}"`).toBeGreaterThan(0);
    }
  });
});

describe('getString', () => {
  it('returns the default when no override exists', () => {
    expect(getString({}, 'nav.login')).toBe('Logg inn');
  });

  it('prefers an admin override', () => {
    expect(getString({ 'str.nav.login': 'Min konto' }, 'nav.login')).toBe('Min konto');
  });

  it('falls back to default on empty override', () => {
    expect(getString({ 'str.nav.login': '' }, 'nav.login')).toBe('Logg inn');
  });

  it('returns the key itself for unknown keys', () => {
    expect(getString({}, 'finnes.ikke')).toBe('finnes.ikke');
  });
});

describe('formatString', () => {
  it('fills placeholders', () => {
    expect(formatString('Hei {{navn}}!', { navn: 'Kari' })).toBe('Hei Kari!');
  });

  it('keeps unknown placeholders visible', () => {
    expect(formatString('Hei {{ukjent}}!', {})).toBe('Hei {{ukjent}}!');
  });

  it('handles numbers and repeats', () => {
    expect(formatString('{{min}}-{{max}} år ({{min}}+)', { min: 7, max: 14 })).toBe('7-14 år (7+)');
  });
});

describe('makeT', () => {
  it('binds settings and formats values', () => {
    const t = makeT({ 'str.reg.intro_adult': 'Meld deg på {{kurs}} her' });
    expect(t('reg.intro_adult', { kurs: 'Voksenkurs' })).toBe('Meld deg på Voksenkurs her');
    expect(t('nav.login')).toBe('Logg inn');
  });
});
