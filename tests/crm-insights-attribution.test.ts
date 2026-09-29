import { describe, it, expect } from 'vitest';
import {
  parseAttributionWindowDays, parseConversionMeta, buildConversionUnits, attributeConversions,
  summarizeAttribution, type AttributionDealRow, type AttributionEventRow, type TouchSendRow,
  type ConversionUnit, type Attribution,
} from '@/lib/crm/insights-attribution';

const PERIOD = { from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-09-01T00:00:00Z') };
const at = (iso: string) => new Date(iso);

function dealRow(overrides: Partial<AttributionDealRow>): AttributionDealRow {
  return {
    id: 1, contactId: 1, status: 'open', value: 1000,
    createdAt: at('2026-07-10T12:00:00Z'), closedAt: null,
    registrationId: null, bookingRequestId: null,
    ...overrides,
  };
}
function eventRow(overrides: Partial<Omit<AttributionEventRow, 'meta'>> & { meta?: Record<string, unknown> }): AttributionEventRow {
  const { meta, ...rest } = overrides;
  return {
    type: 'registration.created', contactId: 1, occurredAt: at('2026-07-10T12:00:00Z'),
    meta: JSON.stringify(meta ?? {}),
    ...rest,
  };
}
function unit(key: string, contactId: number, iso: string, value = 0): ConversionUnit {
  return { key, moments: [{ contactId, at: at(iso) }], value };
}
function send(flowId: number, contactId: number, opened: string | null, clicked: string | null = null): TouchSendRow {
  return { flowId, contactId, openedAt: opened ? at(opened) : null, firstClickedAt: clicked ? at(clicked) : null };
}

describe('parseAttributionWindowDays', () => {
  it('godtar heltall 1–90', () => {
    expect(parseAttributionWindowDays('7')).toBe(7);
    expect(parseAttributionWindowDays(' 30 ')).toBe(30);
    expect(parseAttributionWindowDays('90')).toBe(90);
  });
  it('faller tilbake til 14 ved ugyldig verdi', () => {
    for (const raw of ['', '0', '-3', '2.5', 'abc', '91', null, undefined]) {
      expect(parseAttributionWindowDays(raw)).toBe(14);
    }
  });
});

describe('parseConversionMeta', () => {
  it('leser id-er og beløp', () => {
    expect(parseConversionMeta('{"registrationId":5,"amountKr":1490}')).toEqual({
      registrationId: 5, bookingRequestId: null, amountKr: 1490,
    });
  });
  it('tåler ugyldig JSON og feil typer', () => {
    expect(parseConversionMeta('not json')).toEqual({ registrationId: null, bookingRequestId: null, amountKr: null });
    expect(parseConversionMeta('{"bookingRequestId":"7","amountKr":"100"}')).toEqual({
      registrationId: null, bookingRequestId: null, amountKr: null,
    });
    expect(parseConversionMeta('null').registrationId).toBeNull();
  });
});

describe('buildConversionUnits', () => {
  it('slår sammen deal, påmelding og betaling for samme påmelding til én booking', () => {
    const units = buildConversionUnits(
      [dealRow({ id: 1, registrationId: 5, status: 'won', value: 2000, closedAt: at('2026-07-12T00:00:00Z') })],
      [
        eventRow({ type: 'registration.created', meta: { registrationId: 5 } }),
        eventRow({ type: 'payment.succeeded', occurredAt: at('2026-07-11T00:00:00Z'), meta: { registrationId: 5, amountKr: 1500 } }),
      ],
      PERIOD,
    );
    expect(units).toHaveLength(1);
    expect(units[0].key).toBe('reg:5');
    expect(units[0].moments).toHaveLength(4); // deal opprettet + vunnet + påmelding + betaling
    expect(units[0].value).toBe(2000); // vunnet deal-verdi foran innbetalt beløp
  });

  it('verdi = innbetalt beløp når dealen ikke er vunnet', () => {
    const [u] = buildConversionUnits(
      [dealRow({ bookingRequestId: 3, status: 'open' })],
      [eventRow({ type: 'payment.succeeded', meta: { bookingRequestId: 3, amountKr: 750 } })],
      PERIOD,
    );
    expect(u).toMatchObject({ key: 'book:3', value: 750 });
  });

  it('manuelle deals uten bro får egen nøkkel', () => {
    const units = buildConversionUnits([dealRow({ id: 9 }), dealRow({ id: 10 })], [], PERIOD);
    expect(units.map((u) => u.key)).toEqual(['deal:10', 'deal:9']);
  });

  it('tapte deals og bookinger uten øyeblikk i perioden utelates', () => {
    const units = buildConversionUnits(
      [
        dealRow({ id: 1, status: 'lost', registrationId: 1 }),
        dealRow({ id: 2, createdAt: at('2026-01-01T00:00:00Z') }),
      ],
      [eventRow({ meta: { registrationId: 1 } })],
      PERIOD,
    );
    expect(units).toEqual([]);
  });

  it('deal opprettet før perioden men vunnet i perioden teller på vinnertidspunktet', () => {
    const [u] = buildConversionUnits(
      [dealRow({ createdAt: at('2026-01-01T00:00:00Z'), status: 'won', closedAt: at('2026-07-01T00:00:00Z') })],
      [],
      PERIOD,
    );
    expect(u.moments).toEqual([{ contactId: 1, at: at('2026-07-01T00:00:00Z') }]);
  });

  it('øyeblikk uten kontakt kan ikke tilskrives og ignoreres', () => {
    expect(buildConversionUnits([dealRow({ contactId: null })], [eventRow({ contactId: null })], PERIOD)).toEqual([]);
  });
});

describe('attributeConversions', () => {
  const booking = unit('reg:1', 1, '2026-07-15T12:00:00Z', 1000);

  it('åpning innen vinduet før bookingen gir kreditt', () => {
    const [a] = attributeConversions([booking], [send(7, 1, '2026-07-10T09:00:00Z')], 14);
    expect(a).toMatchObject({ key: 'reg:1', flowId: 7, via: 'open', value: 1000 });
  });

  it('berøring etter bookingen eller utenfor vinduet teller ikke', () => {
    const sends = [send(7, 1, '2026-07-16T09:00:00Z'), send(8, 1, '2026-06-30T11:59:00Z')];
    expect(attributeConversions([booking], sends, 14)).toEqual([]);
  });

  it('vinduet er inkluderende i begge ender', () => {
    const exact = [send(7, 1, '2026-07-01T12:00:00Z')];
    expect(attributeConversions([booking], exact, 14)).toHaveLength(1);
    const sameInstant = [send(7, 1, '2026-07-15T12:00:00Z')];
    expect(attributeConversions([booking], sameInstant, 14)).toHaveLength(1);
  });

  it('kun kontaktens egne e-poster teller', () => {
    expect(attributeConversions([booking], [send(7, 2, '2026-07-10T09:00:00Z')], 14)).toEqual([]);
  });

  it('last-touch: nyeste åpning vinner', () => {
    const sends = [send(7, 1, '2026-07-05T09:00:00Z'), send(8, 1, '2026-07-12T09:00:00Z')];
    expect(attributeConversions([booking], sends, 14)[0].flowId).toBe(8);
  });

  it('klikk veier tyngre: eldre klikk slår nyere åpning', () => {
    const sends = [send(7, 1, '2026-07-05T09:00:00Z', '2026-07-05T09:05:00Z'), send(8, 1, '2026-07-14T09:00:00Z')];
    expect(attributeConversions([booking], sends, 14)[0]).toMatchObject({ flowId: 7, via: 'click' });
  });

  it('nyeste klikk vinner blant klikk', () => {
    const sends = [
      send(7, 1, null, '2026-07-05T09:00:00Z'),
      send(8, 1, null, '2026-07-13T09:00:00Z'),
    ];
    expect(attributeConversions([booking], sends, 14)[0]).toMatchObject({ flowId: 8, via: 'click' });
  });

  it('klikk utenfor vinduet faller tilbake til åpning innenfor', () => {
    const sends = [send(7, 1, '2026-06-01T09:00:00Z', '2026-06-01T09:05:00Z'), send(8, 1, '2026-07-14T09:00:00Z')];
    expect(attributeConversions([booking], sends, 14)[0]).toMatchObject({ flowId: 8, via: 'open' });
  });

  it('et hvilket som helst øyeblikk i bookingen kan kvalifisere (f.eks. betaling etter klikk)', () => {
    const multi: ConversionUnit = {
      key: 'reg:2',
      moments: [{ contactId: 1, at: at('2026-06-05T00:00:00Z') }, { contactId: 1, at: at('2026-08-01T00:00:00Z') }],
      value: 500,
    };
    const [a] = attributeConversions([multi], [send(9, 1, null, '2026-07-30T00:00:00Z')], 14);
    expect(a).toMatchObject({ flowId: 9, via: 'click' });
  });

  it('kortere vindu fjerner kreditt', () => {
    expect(attributeConversions([booking], [send(7, 1, '2026-07-10T09:00:00Z')], 3)).toEqual([]);
  });

  it('likt tidspunkt avgjøres deterministisk', () => {
    const sends = [send(9, 1, '2026-07-10T09:00:00Z'), send(4, 1, '2026-07-10T09:00:00Z')];
    expect(attributeConversions([booking], sends, 14)[0].flowId).toBe(4);
  });
});

describe('summarizeAttribution', () => {
  const flows = [
    { id: 1, name: 'Julebord-gjenbooking', status: 'active' },
    { id: 2, name: 'Velkommen', status: 'active' },
    { id: 3, name: 'Tom', status: 'paused' },
  ];
  const attributions: Attribution[] = [
    { key: 'a', flowId: 1, via: 'click', touchAt: at('2026-07-01T00:00:00Z'), value: 10000 },
    { key: 'b', flowId: 1, via: 'open', touchAt: at('2026-07-01T00:00:00Z'), value: 5000 },
    { key: 'c', flowId: 2, via: 'open', touchAt: at('2026-07-01T00:00:00Z'), value: 0 },
    { key: 'd', flowId: 99, via: 'click', touchAt: at('2026-07-01T00:00:00Z'), value: 1 }, // ukjent/malflyt
  ];

  it('per flyt: bookinger, klikk/åpning, verdi og konverteringsrate', () => {
    const { perFlow } = summarizeAttribution(attributions, flows, new Map([[1, 40], [2, 200]]), 10);
    expect(perFlow[0]).toEqual({
      flowId: 1, name: 'Julebord-gjenbooking', status: 'active',
      sent: 40, attributed: 2, viaClick: 1, viaOpen: 1, value: 15000, conversionRate: 5,
    });
    expect(perFlow[1]).toMatchObject({ flowId: 2, attributed: 1, conversionRate: 0.5 });
    expect(perFlow[2]).toMatchObject({ flowId: 3, sent: 0, attributed: 0, conversionRate: null });
  });

  it('totalen ignorerer flyter som ikke er med (f.eks. maler)', () => {
    const { total } = summarizeAttribution(attributions, flows, new Map([[1, 40], [2, 200]]), 10);
    expect(total).toEqual({
      sent: 240, attributed: 3, viaClick: 1, viaOpen: 2, value: 15000,
      conversionRate: 1.3, conversions: 10, attributedShare: 30,
    });
  });

  it('ingen data gir nuller, aldri NaN', () => {
    const { total, perFlow } = summarizeAttribution([], [], new Map(), 0);
    expect(perFlow).toEqual([]);
    expect(total).toMatchObject({ sent: 0, attributed: 0, conversionRate: null, attributedShare: null });
  });
});
