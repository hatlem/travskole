/** /avmeld lover det sendelaget faktisk gjør: kun markedsføring stopper. */
import { describe, it, expect } from 'vitest';
import { CONFIRM_TEXT, UNSUBSCRIBED_TEXT } from '@/app/avmeld/texts';

describe('/avmeld-tekstene', () => {
  it('sier at markedsføring stopper og tjenestemeldinger om påmeldinger fortsatt kommer', () => {
    for (const text of [CONFIRM_TEXT, UNSUBSCRIBED_TEXT]) {
      expect(text).toMatch(/markedsføring/);
      expect(text).toMatch(/fortsatt/);
      expect(text).toMatch(/påmeldinger/);
    }
  });

  it('lover ikke at all e-post stopper', () => {
    expect(UNSUBSCRIBED_TEXT).not.toMatch(/ikke lenger e-post/);
  });
});
