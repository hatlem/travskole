import { describe, it, expect } from 'vitest';
import {
  audienceLabel,
  cancellationExcerpt,
  consentTextOr,
  ctaWithPrice,
  formatDateRange,
  formatKr,
  isMeaningfulConsentText,
  participantsLabel,
  payButtonLabel,
  priceLabel,
  spotsLeft,
  spotsLeftLabel,
} from '@/lib/buyer-display';

const nbsp = (s: string) => s.replace(/ /g, ' ');

describe('priceLabel', () => {
  it('formats a price in kroner with Norwegian grouping', () => {
    expect(nbsp(priceLabel({ price: 1500 }))).toBe('1 500 kr');
  });
  it('treats zero as free', () => {
    expect(priceLabel({ price: 0 })).toBe('Gratis');
  });
  it('says the price is agreed for request events without a price', () => {
    expect(priceLabel({ price: null, registrationMode: 'request' })).toBe('Pris avtales');
  });
  it('treats a missing price on a standard course as free', () => {
    expect(priceLabel({ price: null, registrationMode: 'standard' })).toBe('Gratis');
  });
});

describe('audienceLabel', () => {
  it('labels adult events', () => {
    expect(audienceLabel({ audience: 'voksen', ageMin: 6, ageMax: 12 })).toBe('Voksne');
  });
  it('labels a child age range', () => {
    expect(audienceLabel({ audience: 'barn', ageMin: 6, ageMax: 12 })).toBe('Barn 6–12 år');
  });
  it('handles open-ended ranges', () => {
    expect(audienceLabel({ audience: 'barn', ageMin: 8 })).toBe('Barn fra 8 år');
    expect(audienceLabel({ audience: 'barn', ageMax: 12 })).toBe('Barn til 12 år');
    expect(audienceLabel({ audience: 'barn' })).toBe('Barn');
  });
});

describe('participantsLabel', () => {
  it('uses singular and plural correctly', () => {
    expect(participantsLabel(1)).toBe('1 deltaker');
    expect(participantsLabel(3)).toBe('3 deltakere');
  });
});

describe('formatDateRange', () => {
  it('says time is agreed without a start date', () => {
    expect(formatDateRange(null)).toBe('Tid avtales');
  });
  it('collapses ranges within one month', () => {
    expect(formatDateRange('2027-12-01T10:00:00Z', '2027-12-05T10:00:00Z')).toBe('1.–5. desember 2027');
  });
  it('shows both dates across months', () => {
    expect(formatDateRange('2027-06-28T10:00:00Z', '2027-07-02T10:00:00Z')).toBe('28. juni 2027 – 2. juli 2027');
  });
  it('shows a single day once', () => {
    expect(formatDateRange('2027-06-28T10:00:00Z', '2027-06-28T12:00:00Z')).toBe('28. juni 2027');
  });
});

describe('consent texts', () => {
  it('rejects placeholder texts', () => {
    expect(isMeaningfulConsentText('x')).toBe(false);
    expect(isMeaningfulConsentText('   test   ')).toBe(false);
    expect(isMeaningfulConsentText(undefined)).toBe(false);
    expect(isMeaningfulConsentText('Jeg godtar vilkårene')).toBe(true);
  });
  it('falls back for short texts', () => {
    expect(consentTextOr('x', 'Standard')).toBe('Standard');
    expect(consentTextOr(' Jeg godtar vilkårene ', 'Standard')).toBe('Jeg godtar vilkårene');
  });
});

describe('cancellationExcerpt', () => {
  it('picks the cancellation sentences from the terms', () => {
    const terms =
      'Jeg bekrefter at påmeldingen er bindende. Tapte kursdager kan ikke tas igjen eller refunderes. Ved avbestilling senere enn 3 dager før oppstart påløper et gebyr på kr 500,–. All ridning skjer på eget ansvar.';
    expect(cancellationExcerpt(terms)).toBe(
      'Tapte kursdager kan ikke tas igjen eller refunderes. Ved avbestilling senere enn 3 dager før oppstart påløper et gebyr på kr 500,–.'
    );
  });
  it('returns null when nothing is relevant or text is a placeholder', () => {
    expect(cancellationExcerpt('All ridning skjer på eget ansvar.')).toBeNull();
    expect(cancellationExcerpt('x')).toBeNull();
  });
});

describe('spots', () => {
  it('computes spots left only when capacity is set', () => {
    expect(spotsLeft(10, 7)).toBe(3);
    expect(spotsLeft(10, 12)).toBe(0);
    expect(spotsLeft(null, 3)).toBeNull();
    expect(spotsLeft(0, 3)).toBeNull();
  });
  it('labels spots', () => {
    expect(spotsLeftLabel(1)).toBe('1 ledig plass');
    expect(spotsLeftLabel(4)).toBe('4 ledige plasser');
    expect(spotsLeftLabel(0)).toBe('Ingen ledige plasser');
  });
});

describe('buttons', () => {
  it('names amount and provider on pay buttons', () => {
    expect(nbsp(payButtonLabel('vipps', 1500))).toBe('Betal 1 500 kr med Vipps');
    expect(payButtonLabel('stripe', null)).toBe('Betal med kort');
  });
  it('adds the price to the call to action', () => {
    expect(nbsp(ctaWithPrice('Meld på', 1500))).toBe('Meld på – 1 500 kr');
    expect(ctaWithPrice('Meld på', 0)).toBe('Meld på');
  });
  it('formats decimals when present', () => {
    expect(nbsp(formatKr(99.5))).toBe('99,5 kr');
  });
});
