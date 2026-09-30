import { describe, it, expect } from 'vitest';
import { activityActionLabel, activityEntityLabel, formatActivityDetails } from '@/lib/activity-labels';

describe('activity labels', () => {
  it('translates actions and entities with æøå, and passes unknown codes through', () => {
    expect(activityEntityLabel('registration')).toBe('Påmelding');
    expect(activityEntityLabel('sender_identity')).toBe('Avsender');
    expect(activityEntityLabel('child')).toBe('Barn');
    expect(activityEntityLabel('setting')).toBe('Innstilling');
    expect(activityActionLabel('export')).toBe('Eksportert');
    expect(activityActionLabel('ukjent_handling')).toBe('ukjent_handling');
  });

  it('formats JSON details as readable Norwegian', () => {
    expect(formatActivityDetails('{"from":"pending","to":"cancelled","selfService":true}'))
      .toBe('Fra: Venter · Til: Avlyst · Selvbetjent: Ja');
    expect(formatActivityDetails('{"from":{"name":"Ny"},"to":{"name":"Vunnet"}}')).toBe('Fra: Ny · Til: Vunnet');
    expect(formatActivityDetails('{"key":"contact_email"}')).toBe('Innstilling: contact_email');
  });

  it('leaves non-JSON details and empty values alone', () => {
    expect(formatActivityDetails('Fritekst')).toBe('Fritekst');
    expect(formatActivityDetails(null)).toBe('');
  });
});
