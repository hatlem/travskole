import { describe, it, expect } from 'vitest';
import { hidesFloatingFeedbackOnMobile } from '@/lib/site-chrome';

describe('hidesFloatingFeedbackOnMobile', () => {
  it('hides the bubble on forms, Min side and course detail pages', () => {
    for (const path of [
      '/arrangementer/kurs/2027/ponniskole/pamelding',
      '/pamelding/bekreftet',
      '/dashboard',
      '/login',
      '/betaling/takk',
      '/arrangementer/kurs/2027/ponniskole',
    ]) {
      expect(hidesFloatingFeedbackOnMobile(path), path).toBe(true);
    }
  });
  it('keeps it on browsing pages', () => {
    for (const path of ['/', '/arrangementer', '/vilkar', null]) {
      expect(hidesFloatingFeedbackOnMobile(path), String(path)).toBe(false);
    }
  });
});
