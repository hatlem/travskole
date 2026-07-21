# Betalings-hardening (delprosjekt 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Håndtere `checkout.session.expired` (ny status `expired`) og delrefusjon (ny status `partially_refunded`), vise betalingsbadge på kanban, og gi `lib/flows/send.ts` dedikert unit-testdekning.

**Architecture:** Additiv utvidelse av den monotone betalings-rank-maskinen + event-mapping + taksonomi; ett felles badge-hjelper-modul brukt overalt; `send.ts`-tester via `vi.mock`. Ingen schema-migrering (paymentStatus er fri streng), ingen nye env-vars.

**Tech Stack:** Next.js 16, Prisma 5/Postgres, Zod, Vitest, TypeScript strict. Spec: `docs/superpowers/specs/2026-07-21-payment-hardening-design.md`.

## Global Constraints

- Norsk (bokmål) i all admin-copy/tidslinje-titler/doc-kommentarer.
- Monoton replay-garanti bevares: `write ⇔ rang(next) > rang(current)`; forsinkede/omspilte webhooks kan aldri degradere en terminal status.
- Rank-rekkefølge (eksakt): `none:0, pending:1, expired:2, failed:3, paid:4, partially_refunded:5, refunded:6`.
- Mapping-kode leser KUN felter som faktisk finnes i payloaden; manglende total ved refusjon ⇒ konservativ full `refunded`.
- Ingen schema-migrering, ingen nye env-vars. paymentStatus-kolonnen er allerede fri streng (`none|pending|paid|failed|refunded` i kommentar — utvides til å inkludere `expired|partially_refunded`).
- Badge: status pares alltid med tekst (a11y), aldri bare farge. Semantiske farger (§8).
- `pnpm exec tsc --noEmit` rent (ignorer «Already up to date»-banner) + full suite grønn etter hver task. Commit-melding eksakt som oppgitt.

---

### Task 1: Utvidet rank-maskin (`lib/payments/transitions.ts`, TDD)

**Files:**
- Modify: `lib/payments/transitions.ts`
- Test: `tests/payments-transitions.test.ts`

**Interfaces:**
- Produces: `STATUS_RANK` (7 nøkler), `PaymentStatus` union utvidet med `'expired' | 'partially_refunded'`. `planStatusTransition(current, next)` uendret signatur.

- [ ] **Step 1: Legg til failende tester** i `tests/payments-transitions.test.ts` (behold eksisterende):

```typescript
import { planStatusTransition, STATUS_RANK } from '@/lib/payments/transitions';

describe('utvidet rank (expired / partially_refunded)', () => {
  it('rank-rekkefølge', () => {
    expect(STATUS_RANK).toEqual({ none: 0, pending: 1, expired: 2, failed: 3, paid: 4, partially_refunded: 5, refunded: 6 });
  });
  it('pending → expired skriver', () => {
    expect(planStatusTransition('pending', 'expired')).toEqual({ write: true, downgrade: false });
  });
  it('expired → paid skriver (re-checkout vinner)', () => {
    expect(planStatusTransition('expired', 'paid')).toEqual({ write: true, downgrade: false });
  });
  it('paid → partially_refunded skriver', () => {
    expect(planStatusTransition('paid', 'partially_refunded')).toEqual({ write: true, downgrade: false });
  });
  it('partially_refunded → refunded skriver (full etter delvis)', () => {
    expect(planStatusTransition('partially_refunded', 'refunded')).toEqual({ write: true, downgrade: false });
  });
  it('omspilt paid etter partially_refunded degraderer ikke', () => {
    expect(planStatusTransition('partially_refunded', 'paid')).toEqual({ write: false, downgrade: true });
  });
  it('omspilt partially_refunded etter refunded degraderer ikke', () => {
    expect(planStatusTransition('refunded', 'partially_refunded')).toEqual({ write: false, downgrade: true });
  });
});
```

- [ ] **Step 2:** `pnpm exec vitest run tests/payments-transitions.test.ts` — de nye FEILER (rank mangler nye nøkler).
- [ ] **Step 3: Implementer** — endre de to linjene i `lib/payments/transitions.ts`:

```typescript
export const STATUS_RANK = { none: 0, pending: 1, expired: 2, failed: 3, paid: 4, partially_refunded: 5, refunded: 6 } as const;
```

`PaymentStatus` er `keyof typeof STATUS_RANK`, så den plukker automatisk opp `expired`/`partially_refunded` — ingen annen endring i filen. Oppdater doc-kommentaren øverst til å nevne at `expired` (forlatt checkout) og `partially_refunded` (delvis refusjon) er lagt til, med samme monotone garanti.

- [ ] **Step 4:** Testfilen PASS (eksisterende + 7 nye); full suite; tsc rent.
- [ ] **Step 5:** Commit: `feat(pay): expired + partially_refunded in status rank`

---

### Task 2: Event-mapping + apply-status (`lib/payments/mapping.ts` + `lib/payments/apply.ts`, TDD)

**Files:**
- Modify: `lib/payments/mapping.ts`, `lib/payments/apply.ts`
- Test: `tests/payments-mapping.test.ts`

**Interfaces:**
- Consumes: `PaymentStatus` (Task 1).
- Produces: `PaymentEventInput['type']` utvidet med `'payment.expired' | 'payment.partially_refunded'`; `apply.ts` `STATUS_MAP` mapper de to nye event-typene til `'expired'`/`'partially_refunded'`.

**Kontekst — nåværende `PaymentEventInput.type` (mapping.ts linje 2):**
```typescript
  type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded';
```
**Nåværende `apply.ts` `STATUS_MAP` (linje 22-26):**
```typescript
const STATUS_MAP: Record<PaymentEventInput['type'], string> = {
  'payment.succeeded': 'paid',
  'payment.failed': 'failed',
  'payment.refunded': 'refunded',
};
```
(Å utvide unionen i mapping.ts BRYTER `STATUS_MAP` ved tsc — derfor endres begge filer i samme task.)

- [ ] **Step 1: Legg til failende tester** i `tests/payments-mapping.test.ts`:

```typescript
  it('checkout.session.expired → payment.expired keyed on session id', () => {
    const r = mapStripeEvent({
      id: 'evt_x', type: 'checkout.session.expired',
      data: { object: { id: 'cs_999', payment_intent: null } },
    });
    expect(r).toMatchObject({ type: 'payment.expired', provider: 'stripe', ref: 'cs_999', refKind: 'paymentRef', eventId: 'evt_x' });
  });

  it('charge.refunded FULL (amount_refunded === amount) → payment.refunded', () => {
    const r = mapStripeEvent({
      id: 'evt_f', type: 'charge.refunded',
      data: { object: { id: 'ch_1', payment_intent: 'pi_1', amount: 250000, amount_refunded: 250000 } },
    });
    expect(r).toMatchObject({ type: 'payment.refunded', ref: 'pi_1', amountKr: 2500 });
  });

  it('charge.refunded PARTIAL (amount_refunded < amount) → payment.partially_refunded', () => {
    const r = mapStripeEvent({
      id: 'evt_p', type: 'charge.refunded',
      data: { object: { id: 'ch_2', payment_intent: 'pi_2', amount: 250000, amount_refunded: 50000 } },
    });
    expect(r).toMatchObject({ type: 'payment.partially_refunded', ref: 'pi_2', amountKr: 500 });
  });

  it('charge.refunded uten total (amount mangler) → konservativ full refunded', () => {
    const r = mapStripeEvent({
      id: 'evt_u', type: 'charge.refunded',
      data: { object: { id: 'ch_3', payment_intent: 'pi_3', amount_refunded: 50000 } },
    });
    expect(r?.type).toBe('payment.refunded');
  });

  it('Vipps PARTIAL refund (refundert < opprinnelig) → partially_refunded', () => {
    const r = mapVippsEvent({ reference: 'reg-1-ab', name: 'REFUNDED', amount: { value: 50000 }, transactionInfo: { refundedAmount: 50000, amount: 250000 } });
    expect(r?.type).toBe('payment.partially_refunded');
  });

  it('Vipps REFUNDED uten total → konservativ full refunded', () => {
    const r = mapVippsEvent({ reference: 'reg-2-cd', name: 'REFUNDED', amount: { value: 250000 } });
    expect(r?.type).toBe('payment.refunded');
  });
```

- [ ] **Step 2:** Kjør — de nye FEILER.
- [ ] **Step 3: Implementer.** I `lib/payments/mapping.ts`:

Utvid unionen:
```typescript
  type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded' | 'payment.expired' | 'payment.partially_refunded';
```

Legg til `checkout.session.expired`-gren i `mapStripeEvent` (etter `payment_intent.payment_failed`-grenen, før `charge.refunded`):
```typescript
  if (event.type === 'checkout.session.expired') {
    return {
      type: 'payment.expired', provider: 'stripe',
      ref: String(o.id), refKind: 'paymentRef',
      registrationId: idFromMeta(o.metadata, 'registrationId'),
      bookingRequestId: idFromMeta(o.metadata, 'bookingRequestId'),
      amountKr: null,
      eventId: event.id,
    };
  }
```

Erstatt `charge.refunded`-grenen med del/full-skille:
```typescript
  if (event.type === 'charge.refunded') {
    if (typeof o.payment_intent !== 'string') return null;
    const refunded = num(o.amount_refunded);
    const total = num(o.amount); // charge-total; kan mangle
    // Del vs full: kun når vi HAR totalen og refundert < total er det delvis.
    // Mangler totalen ⇒ konservativt full refunded (dagens oppførsel).
    const isPartial = total !== null && refunded !== null && refunded < total;
    return {
      type: isPartial ? 'payment.partially_refunded' : 'payment.refunded',
      provider: 'stripe', ref: o.payment_intent, refKind: 'paymentRef',
      amountKr: refunded !== null ? refunded / 100 : null,
      eventId: event.id,
    };
  }
```

Vipps: erstatt den faste `REFUNDED: 'payment.refunded'` med håndtering som skiller del/full i `mapVippsEvent`. Behold `VIPPS_MAP` for de ikke-refusjonsstatusene, men behandle `REFUNDED` spesielt:
```typescript
const VIPPS_MAP: Record<string, PaymentEventInput['type']> = {
  AUTHORIZED: 'payment.succeeded',
  CAPTURED: 'payment.succeeded',
  FAILED: 'payment.failed',
  EXPIRED: 'payment.failed',
  CANCELLED: 'payment.failed',
  TERMINATED: 'payment.failed',
  // REFUNDED håndteres spesielt i mapVippsEvent (del vs full).
};
```
I `mapVippsEvent`, etter `amountValue`-beregningen, legg til REFUNDED-spesialtilfellet FØR `VIPPS_MAP`-oppslaget:
```typescript
  // Vipps-refusjon: skill del vs full når payloaden bærer både refundert beløp
  // og opprinnelig total (transactionInfo). Mangler totalen ⇒ konservativ full.
  if (name === 'REFUNDED') {
    const ti = typeof body.transactionInfo === 'object' && body.transactionInfo !== null
      ? (body.transactionInfo as Record<string, unknown>) : null;
    const refunded = ti ? num(ti.refundedAmount) : null;
    const total = ti ? num(ti.amount) : null;
    const isPartial = total !== null && refunded !== null && refunded < total;
    return {
      type: isPartial ? 'payment.partially_refunded' : 'payment.refunded',
      provider: 'vipps', ref: reference, refKind: 'paymentRef',
      amountKr: amountValue !== null ? amountValue / 100 : null,
      eventId: `${reference}:${name}`,
    };
  }
  const type = VIPPS_MAP[name];
  if (!type) return null;
```
(Behold resten av `mapVippsEvent` uendret — `amountValue` beregnes fortsatt over dette, og den generiske returen under bruker `type` fra `VIPPS_MAP`.)

I `lib/payments/apply.ts`, utvid `STATUS_MAP`:
```typescript
const STATUS_MAP: Record<PaymentEventInput['type'], string> = {
  'payment.succeeded': 'paid',
  'payment.failed': 'failed',
  'payment.refunded': 'refunded',
  'payment.expired': 'expired',
  'payment.partially_refunded': 'partially_refunded',
};
```
(Ingen annen apply.ts-endring: `newStatus` hentes fra `STATUS_MAP`, `planStatusTransition` er rank-drevet, `moveWonDeal` kjører kun på `payment.succeeded`.)

- [ ] **Step 4:** Testfilen PASS; tsc rent (bekrefter at unions-utvidelsen + STATUS_MAP er komplett); full suite.
- [ ] **Step 5:** Commit: `feat(pay): map expired + partial refund (stripe + vipps)`

---

### Task 3: Taksonomi — nye bus-typer + tidslinje-titler (`lib/events/taxonomy.ts`, TDD)

**Files:**
- Modify: `lib/events/taxonomy.ts`
- Test: `tests/events-taxonomy.test.ts`

**Interfaces:**
- Consumes: apply.ts emitterer `type: input.type` til bussen (`payment.expired`/`payment.partially_refunded`) — disse MÅ være i `SERVER_EVENT_TYPES`, ellers avviser `emitEvent` dem og tidslinje-innslaget uteblir.

**Kontekst — nåværende payment-titler i `timelineTitle` (linje 87-91):**
```typescript
    case 'payment.succeeded':
      return amount !== null ? `Betaling mottatt (${amount} kr)` : 'Betaling mottatt';
    case 'payment.failed':
      return 'Betaling feilet';
    case 'payment.refunded':
      return amount !== null ? `Betaling refundert (${amount} kr)` : 'Betaling refundert';
```

- [ ] **Step 1: Legg til failende tester** i `tests/events-taxonomy.test.ts`: `isEventType('payment.expired')` og `'payment.partially_refunded'` → true; `timelineTitle('payment.expired', {})` → `'Betaling utløpt'`; `timelineTitle('payment.partially_refunded', { amountKr: 500 })` → `'Delvis refundert (500 kr)'`; `timelineTitle('payment.partially_refunded', {})` → `'Delvis refundert'`.
- [ ] **Step 2:** Kjør — FEILER.
- [ ] **Step 3: Implementer.** Legg til i `PAYMENT_EVENT_TYPES` (eller `SERVER_EVENT_TYPES` — sjekk hvilken array betalingstypene ligger i; de tre `payment.*` ligger i `PAYMENT_EVENT_TYPES` per linje 27-29): `'payment.expired'`, `'payment.partially_refunded'`. Legg til `timelineTitle`-cases:
```typescript
    case 'payment.expired':
      return 'Betaling utløpt';
    case 'payment.partially_refunded':
      return amount !== null ? `Delvis refundert (${amount} kr)` : 'Delvis refundert';
```
(`amount` er allerede beregnet øverst i funksjonen fra `meta.amountKr`/`meta.amount`.)

- [ ] **Step 4:** Tester PASS; full suite; tsc.
- [ ] **Step 5:** Commit: `feat(pay): expired + partial-refund timeline events`

---

### Task 4: Felles betalings-badge-hjelper (`lib/payments/badge.ts`) + refaktorering

**Files:**
- Create: `lib/payments/badge.ts`
- Modify: `app/admin/registrations/page.tsx` (bruk hjelperen), og evt. andre steder som har egen `PAYMENT_STATUS_BADGES`
- Test: `tests/payments-badge.test.ts`

**Interfaces:**
- Produces: `paymentStatusBadge(status: string | null | undefined): { label: string; className: string } | null` — norsk etikett + Tailwind-klasser per status; `null` for ukjent/tom.

**Kontekst — eksisterende inline-map i registrations page (linje 53-56):**
```typescript
  paid: { label: 'Betalt', className: 'bg-green-100 text-green-800' },
  pending: { label: 'Venter', className: 'bg-amber-100 text-amber-800' },
  failed: { label: 'Feilet', className: 'bg-red-100 text-red-800' },
  refunded: { label: 'Refundert', className: 'bg-gray-100 text-gray-600' },
```

- [ ] **Step 1: Failende test** `tests/payments-badge.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { paymentStatusBadge } from '@/lib/payments/badge';

describe('paymentStatusBadge', () => {
  it('kjente statuser', () => {
    expect(paymentStatusBadge('paid')?.label).toBe('Betalt');
    expect(paymentStatusBadge('pending')?.label).toBe('Venter');
    expect(paymentStatusBadge('failed')?.label).toBe('Feilet');
    expect(paymentStatusBadge('refunded')?.label).toBe('Refundert');
    expect(paymentStatusBadge('expired')?.label).toBe('Utløpt');
    expect(paymentStatusBadge('partially_refunded')?.label).toBe('Delvis refundert');
  });
  it('ukjent/tom → null', () => {
    expect(paymentStatusBadge('none')).toBe(null);
    expect(paymentStatusBadge(undefined)).toBe(null);
    expect(paymentStatusBadge('rart')).toBe(null);
  });
});
```
(Merk: `none` gir `null` — «ingen betaling» skal ikke vises som badge, samme som dagens oppførsel der bare paid/pending/failed/refunded har badge.)

- [ ] **Step 2:** Kjør — FEILER. **Step 3: Implementer** `lib/payments/badge.ts`:
```typescript
// Felles betalings-badge: norsk etikett + semantisk farge per status.
// Brukt overalt betalingsstatus vises (påmeldings-/booking-lister,
// kontakt-deals, kanban) så expired/partially_refunded ser likt ut alle steder.
// Status pares alltid med tekst (a11y) — aldri bare farge.
const BADGES: Record<string, { label: string; className: string }> = {
  pending: { label: 'Venter', className: 'bg-amber-100 text-amber-800' },
  expired: { label: 'Utløpt', className: 'bg-gray-100 text-gray-600' },
  failed: { label: 'Feilet', className: 'bg-red-100 text-red-800' },
  paid: { label: 'Betalt', className: 'bg-green-100 text-green-800' },
  partially_refunded: { label: 'Delvis refundert', className: 'bg-orange-100 text-orange-800' },
  refunded: { label: 'Refundert', className: 'bg-blue-100 text-blue-800' },
};

export function paymentStatusBadge(status: string | null | undefined): { label: string; className: string } | null {
  if (!status) return null;
  return BADGES[status] ?? null;
}
```

- [ ] **Step 4: Refaktorer** `app/admin/registrations/page.tsx`: erstatt den lokale `PAYMENT_STATUS_BADGES`-map + `PaymentBadge`-komponentens oppslag med `paymentStatusBadge(status)` fra hjelperen (behold `<span className=...>{badge.label}</span>`-renderingen; nå får den også expired/partially_refunded-etiketter). Grep for andre steder med egen betalings-badge-map (`grep -rn "Refundert\|paymentStatus" app/admin components/`) og pek dem til samme hjelper hvis de finnes.
- [ ] **Step 5:** tsc rent; scoped eslint på endrede filer; full suite; `pnpm build`. Commit: `feat(pay): shared payment-status badge helper`

---

### Task 5: Kanban-betalingsbadge (`pipelines`-API + pipeline-UI)

**Files:**
- Modify: `app/api/admin/crm/pipelines/route.ts` (deal-select), `app/admin/crm/pipeline/page.tsx` (render badge)

**Interfaces:**
- Consumes: `paymentStatusBadge` (Task 4).

- [ ] **Step 1:** I `app/api/admin/crm/pipelines/route.ts`, legg til i deal-`select` (etter `status: true`):
```typescript
              paymentStatus: true,
              paymentProvider: true,
```
- [ ] **Step 2:** I `app/admin/crm/pipeline/page.tsx`: importer `paymentStatusBadge` fra `@/lib/payments/badge`; på hvert deal-kort, der eventtype/verdi vises, render badgen når den finnes:
```tsx
{(() => { const b = paymentStatusBadge(deal.paymentStatus); return b ? (
  <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${b.className}`}>{b.label}</span>
) : null; })()}
```
Legg `paymentStatus?: string` (+ `paymentProvider?: string`) i deal-TypeScript-typen på siden. (Les filen først for eksakt korttmarkup + eksisterende type; plasser badgen konsistent med de andre metadata-pill-ene på kortet.)
- [ ] **Step 3:** tsc rent; scoped eslint; full suite; `pnpm build`. Commit: `feat(pay): payment badge on kanban cards`

---

### Task 6: Unit-tester for `lib/flows/send.ts` (`tests/flows-send.test.ts`)

**Files:**
- Create: `tests/flows-send.test.ts`
- (Ingen produksjonskode-endring — kun tester. Hvis en sti er umulig å teste uten en minimal, ufarlig refaktor, gjør minst mulig og noter det.)

**Interfaces:**
- Consumes: `sendFlowEmail(input: SendFlowEmailInput): Promise<SendFlowEmailResult>` fra `@/lib/flows/send`.

- [ ] **Step 1: Skriv testene** med `vi.mock` for `@/lib/prisma`, `@/lib/mail`, `@/lib/ai/provider` (og evt. `@/lib/events/bus` for å unngå ekte emisjon). Struktur (les send.ts fullt først for eksakte returverdier/felt):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock-oppsett: prisma med de metodene send.ts bruker (contact.findUnique,
// suppression.findUnique, consent.findUnique, senderIdentity.findUnique,
// messageSend.create/update/delete, messageLink.createMany), sendMailAs,
// getLLMProvider. Bygg dem som vi.fn() du kan omkonfigurere per test.
const prisma = { /* ... method mocks ... */ };
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/mail', () => ({ sendMailAs: vi.fn() }));
vi.mock('@/lib/ai/provider', () => ({ getLLMProvider: vi.fn(() => null) }));

import { sendFlowEmail } from '@/lib/flows/send';
import { sendMailAs } from '@/lib/mail';

const baseInput = { enrollmentId: 1, nodeId: 2, contactId: 3, subject: 'Emne', bodyHtml: '<p>Hei <a href="https://x.no/k">lenke</a></p>', senderIdentityId: 4, isMarketing: true };

beforeEach(() => { vi.clearAllMocks(); /* default happy-path mock-retur */ });
```

Dekk disse casene (hver egen `it`), med presise assertions på returverdi + at riktige prisma/mail-kall skjedde/ikke skjedde:
1. **Suppression** → `sendMailAs` aldri kalt; returnerer `'skipped_suppressed'`; `messageSend.create` kalt med status `skipped_suppressed` og UTEN dedupeKey.
2. **Manglende marketing-samtykke** (isMarketing, consent.marketing=false) → `'skipped_no_consent'`, ingen send.
3. **Vellykket send** → `'sent'`; dedupe-rad opprettet med dedupeKey + trackingToken; `messageLink.createMany` kalt (marketing m/lenke); `sendMailAs` kalt.
4. **P2002 på dedupe-create** (mock `messageSend.create` til å kaste en `Prisma.PrismaClientKnownRequestError` med `code:'P2002'` på FØRSTE kall) → returnerer `'already_sent'`; `sendMailAs` aldri kalt.
5. **createMany-feil** (mock `messageLink.createMany` til å kaste en ikke-P2002-feil) → returnerer `'failed'`; `messageSend.delete` kalt (dedupe-slot frigjort) + fersk `create` med status `failed` uten dedupeKey; `sendMailAs` ALDRI kalt (gjenoppretting skjer før nettverkssend).
6. **sendMailAs-feil** → `'failed'`; `recoverFromFailedSend`-oppførsel (delete + failed-recreate).
7. **messageId-oppdatering feiler ETTER vellykket send** (mock `sendMailAs` → `{messageId:'<abc@h>'}`, men `messageSend.update` kaster) → returnerer FORTSATT `'sent'` (ikke `'failed'`); ingen `recoverFromFailedSend` (ingen delete av den sendte raden). Dette låser delprosjekt-4-Critical'en.
8. **Personalisering fail-safe**: sett `getLLMProvider` → en provider hvis `generateText` returnerer `null` (eller en guardrail-avvist streng); bekreft at send fortsetter med original kropp (`aiPersonalized` ikke satt) og aldri kaster.

- [ ] **Step 2:** Kjør `pnpm exec vitest run tests/flows-send.test.ts` — juster mock-formene til de faktiske prisma-kallene i send.ts til alt er GRØNT. Ingen produksjonskodeendring med mindre strengt nødvendig (da: minimal + notér i rapport).
- [ ] **Step 3:** Full suite; tsc rent. Commit: `test(flows): unit coverage for send-layer idempotency + recovery`

---

### Task 7: Finish — live smoke + verifikasjon

**Files:** ingen nye (kun verifikasjon).

- [ ] **Step 1: Full verifikasjon:** `pnpm exec tsc --noEmit` (rent), full suite (rapporter eksakt antall), `pnpm build` (OK).
- [ ] **Step 2: Live smoke (dev-server 3001, dev-DB):**
  1. Via `npx tsx`: opprett en test-`Registration` (namespaced, f.eks. tilknyttet en eksisterende kontakt/kurs; sett `paymentStatus:'pending'`, `paymentProvider:'stripe'`, `paymentRef:'cs_smoke_<hex>'`, `paymentIntentRef:'pi_smoke_<hex>'`). Skriv ut id-ene.
  2. **Expired:** kall `applyPaymentEvent(mapStripeEvent({id,type:'checkout.session.expired',data:{object:{id:'cs_smoke_<hex>'}}}))` (eller den faktiske apply-inngangen — les `app/api/webhooks/stripe/route.ts` for hvordan mapping→apply kalles) via et tsx-script mot dev-DB; verifiser radens `paymentStatus` ble `expired` + en `AppEvent` `payment.expired` finnes.
  3. **Delrefusjon:** sett raden tilbake til `paid` (rank tillater ikke expired→paid uten en paid-event; enklest: oppdater raden direkte til paid for smoke-formål), så kall apply med en `charge.refunded` der `amount:250000, amount_refunded:50000, payment_intent:'pi_smoke_<hex>'`; verifiser `paymentStatus` ble `partially_refunded` + `AppEvent` `payment.partially_refunded` med beløp i meta.
  4. **Kanban-badge:** browser-sjekk (Playwright) `/admin/crm/pipeline` viser betalingsbadge på et deal-kort (om et deal med paymentStatus finnes; ellers verifiser via API at `paymentStatus` nå er med i responsen).
  5. **Opprydding (obligatorisk):** slett test-Registration + tilknyttede AppEvents; re-query og bekreft borte. Rapporter.
- [ ] **Step 3:** Commit (kun hvis småfikser trengs): `fix(pay): finish adjustments` — ellers ingen commit.

---

## Self-review (utført)

- **Spec-dekning:** rank (T1), mapping+apply inkl. expired/del-full Stripe+Vipps (T2), taksonomi+tidslinje (T3), felles badge-hjelper (T4), kanban-badge (T5), send.ts-tester (T6), verifikasjon+smoke (T7). Alle spec-seksjoner dekket. Ingen schema/env — bekreftet.
- **Placeholder-scan:** ingen TBD/TODO; alle kodesteg komplette (T6 gir teststruktur + presise caseliste siden mock-formen avhenger av send.ts' faktiske kall — implementeren leser filen; dette er bevisst, ikke en placeholder).
- **Type-konsistens:** `PaymentStatus`/`STATUS_RANK` (T1) → `PaymentEventInput['type']`-union + `STATUS_MAP` (T2, tsc-håndhevet) → bus-typer (T3) → `paymentStatusBadge` (T4) → kanban (T5). Statusstrengene (`expired`,`partially_refunded`) og event-typene (`payment.expired`,`payment.partially_refunded`) er identiske overalt.
