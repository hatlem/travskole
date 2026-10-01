import { describe, it, expect } from 'vitest';
import { buildOnboardingSteps, onboardingDismissKey, type OnboardingFacts } from '@/lib/admin-onboarding';
import { isRealTermsText } from '@/lib/admin-notices';

const empty: OnboardingFacts = {
  courseCount: 0,
  contactInfoSaved: false,
  importedContactCount: 0,
  flowCount: 0,
  termsWritten: false,
};

describe('Kom i gang-sjekklisten', () => {
  it('har alle fem stegene ugjort for en ny installasjon', () => {
    const steps = buildOnboardingSteps(empty);
    expect(steps.map((s) => s.id)).toEqual(['course', 'contact-info', 'terms', 'import', 'flow']);
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(steps.every((s) => s.href.startsWith('/admin'))).toBe(true);
  });

  it('avleder hvert steg fra ekte data', () => {
    const steps = buildOnboardingSteps({
      courseCount: 2,
      contactInfoSaved: true,
      importedContactCount: 14,
      flowCount: 1,
      termsWritten: true,
    });
    expect(steps.every((s) => s.done)).toBe(true);
  });

  it('markerer bare det som faktisk er gjort', () => {
    const done = buildOnboardingSteps({ ...empty, courseCount: 1, flowCount: 3 })
      .filter((s) => s.done)
      .map((s) => s.id);
    expect(done).toEqual(['course', 'flow']);
  });

  it('skjuler per bruker', () => {
    expect(onboardingDismissKey('kari@bjerke.no')).not.toBe(onboardingDismissKey('ola@bjerke.no'));
  });

  it('godtar ikke plassholder som vilkårstekst', () => {
    expect(isRealTermsText('x')).toBe(false);
    expect(isRealTermsText(null)).toBe(false);
    expect(isRealTermsText('Påmeldingen er bindende. Avbestilling senest 14 dager før.')).toBe(true);
  });
});
