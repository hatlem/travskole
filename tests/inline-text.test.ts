import { describe, it, expect } from 'vitest';
import { inlineCommit } from '@/components/admin/InlineText';

describe('inlineCommit', () => {
  it('lagrer ny tekst, trimmet', () => {
    expect(inlineCommit('  Juletrav 2026 ', 'Juletrav', true)).toEqual({ save: 'Juletrav 2026' });
  });
  it('lagrer ikke når ingenting er endret (bare mellomrom)', () => {
    expect(inlineCommit('Juletrav ', 'Juletrav', true)).toBeNull();
  });
  it('tomt påkrevd felt beholder det gamle navnet', () => {
    expect(inlineCommit('   ', 'Juletrav', true)).toBeNull();
  });
  it('valgfritt felt kan tømmes', () => {
    expect(inlineCommit('', 'Gammel beskrivelse', false)).toEqual({ save: '' });
  });
});
