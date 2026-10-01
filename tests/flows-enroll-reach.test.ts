import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn() }));

import { summarizeReach } from '@/lib/flows/enroll-reach';
import { enrollResultMessage } from '@/lib/flows/enroll-message';
import { AWAITING_ACTIVATION_RUN_AT, isAwaitingActivation } from '@/lib/flows/awaiting-activation';

const yes = { marketing: true, lawfulBasis: 'consent', consentAt: new Date() };
const no = { marketing: false, lawfulBasis: 'consent', consentAt: new Date() };

describe('summarizeReach', () => {
  it('teller samtykke, berettiget interesse og manglende', () => {
    const rows = [
      { consent: yes, organizationId: null },
      { consent: null, organizationId: 7 },
      { consent: null, organizationId: null },
      { consent: no, organizationId: 7 },
    ];
    expect(summarizeReach(rows, true)).toEqual({ consented: 1, legitimateInterest: 1, missing: 2 });
    expect(summarizeReach(rows, false)).toEqual({ consented: 1, legitimateInterest: 0, missing: 3 });
  });
});

describe('enrollResultMessage', () => {
  it('sier hvor mange som faktisk får markedsføring', () => {
    expect(enrollResultMessage({ enrolled: 4 }, { reach: { consented: 1, legitimateInterest: 0, missing: 3 } })).toBe(
      '4 lagt til – 1 har samtykket og får e-post; 3 mangler samtykke.',
    );
  });

  it('nevner bedriftskontakter som får e-post uten eget samtykke', () => {
    expect(enrollResultMessage({ enrolled: 3 }, { reach: { consented: 1, legitimateInterest: 2, missing: 0 } })).toBe(
      '3 lagt til – 3 får e-post (1 har samtykket, 2 som bedriftskontakt).',
    );
  });

  it('er tydelig på at et utkast ikke sender noe', () => {
    expect(enrollResultMessage({ enrolled: 2 }, { awaitingActivation: true })).toBe(
      '2 lagt til og venter på at flyten aktiveres. Ingen e-post sendes før du aktiverer flyten.',
    );
    expect(
      enrollResultMessage({ enrolled: 2 }, { awaitingActivation: true, reach: { consented: 2, legitimateInterest: 0, missing: 0 } }),
    ).toBe('2 lagt til og venter på at flyten aktiveres – 2 har samtykket og får e-post når flyten aktiveres.');
  });

  it('viktig informasjon går til alle', () => {
    expect(enrollResultMessage({ enrolled: 1 }, {})).toBe('1 person er lagt til i flyten og får e-postene.');
    expect(enrollResultMessage({ enrolled: 0 }, {})).toBe('Ingen nye ble lagt til — se oversikten for hvorfor.');
  });
});

describe('isAwaitingActivation', () => {
  it('kjenner igjen løp parkert til aktivering', () => {
    expect(isAwaitingActivation({ status: 'active', currentNodeId: null, nextRunAt: AWAITING_ACTIVATION_RUN_AT })).toBe(true);
    expect(isAwaitingActivation({ status: 'active', currentNodeId: null, nextRunAt: new Date() })).toBe(false);
    expect(isAwaitingActivation({ status: 'active', currentNodeId: 5, nextRunAt: AWAITING_ACTIVATION_RUN_AT })).toBe(false);
    expect(isAwaitingActivation({ status: 'exited', currentNodeId: null, nextRunAt: AWAITING_ACTIVATION_RUN_AT.toISOString() })).toBe(false);
  });
});
