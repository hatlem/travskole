import { describe, it, expect } from 'vitest';
import { parseSubjectVariants } from '@/lib/ai/prompts';

describe('parseSubjectVariants', () => {
  it('parser tre nummererte linjer', () => {
    expect(parseSubjectVariants('1. Velkommen!\n2. Hei der\n3. Klar for kurs?')).toEqual(['Velkommen!', 'Hei der', 'Klar for kurs?']);
  });
  it('takler bullets og blanke linjer, maks 3', () => {
    expect(parseSubjectVariants('- A\n\n* B\n- C\n- D')).toEqual(['A', 'B', 'C']);
  });
  it('tom liste for tomt svar', () => { expect(parseSubjectVariants('  ')).toEqual([]); });
});
