import { describe, expect, it } from 'vitest';
import { sampleLabel } from '@/lib/utsendelser/sample';

const org = { name: 'AF Gruppen' };

describe('sampleLabel', () => {
  it('viser person med firma', () => {
    expect(sampleLabel({ name: 'Ola Nordmann', email: 'ola@af.no', organization: org })).toBe('Ola Nordmann i AF Gruppen');
  });

  it('viser person uten firma', () => {
    expect(sampleLabel({ name: 'Ola Nordmann', email: 'ola@af.no', organization: null })).toBe('Ola Nordmann');
  });

  it('viser adresse og firma for funksjonsadresser', () => {
    expect(sampleLabel({ name: 'firmapost', email: 'firmapost@afgruppen.no', organization: org })).toBe('firmapost@afgruppen.no (AF Gruppen)');
  });

  it('bruker navnet når adressen mangler', () => {
    expect(sampleLabel({ name: 'post', email: null, organization: null })).toBe('post');
  });
});
