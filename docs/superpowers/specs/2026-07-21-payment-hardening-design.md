# Betalings-hardening — Design Spec (delprosjekt 7)

*Oppfølging/hardening etter at engasjementsplattformens 6 delprosjekter er ferdige. Lukker kjente betalings-tilstandsmaskin-follow-ups + en kanban-visningsmangel + testgjeld på send-laget. Ingen schema-endringer, ingen nye env-vars.*

## Overview

Fire hardening-punkter: (1) `checkout.session.expired` håndteres nå (ny status `expired`, ikke lenger evig `pending`); (2) delrefusjon skiller seg fra full refusjon (ny status `partially_refunded`, ikke lenger «hel rad refundert» ved delvis); (3) kanban-kortene får en betalingsbadge (pipelines-API mangler i dag `paymentStatus`); (4) dedikert unit-testdekning for `lib/flows/send.ts`. De to nye statusene rippler konsistent til alle betalings-badge-visninger og CRM-tidslinjen.

**Non-goals:** endre eksisterende paid/pending/failed/refunded-oppførsel; schema-migrering (paymentStatus er allerede fri streng); nye betalingsleverandører.

## Utvidet tilstandsmaskin (`lib/payments/transitions.ts`)

Monoton rank utvides additivt (replay-garantien beholdes — forsinkede/omspilte webhooks kan aldri degradere en terminal status):

```
STATUS_RANK = { none:0, pending:1, expired:2, failed:3, paid:4, partially_refunded:5, refunded:6 }
```

- `expired` rett over `pending`: en `checkout.session.expired` skriver over den opprinnelige `pending`; en senere vellykket re-checkout (`paid`, 4) overstyrer alltid. Trygghet: `apply.ts` matcher events mot radens `paymentRef` — en re-checkout gir ny session/ref, så en forsinket `expired` for den gamle økten matcher ikke lenger raden (naturlig no-op). En `expired` kan aldri degradere en aktiv re-checkout.
- `partially_refunded` mellom `paid` og `refunded`: delrefusjon skriver over `paid`; senere FULL refusjon oppgraderer til `refunded`; omspilt `paid` etter delrefusjon degraderer ikke (4 < 5); omspilt/forsinket delrefusjon etter full refusjon degraderer ikke (5 < 6).

`PaymentStatus`-typen utvides tilsvarende. `planStatusTransition` er uendret (rank-drevet). Nye tabelltester dekker begge nye overganger + alle no-op/degrade-grener.

## Event-mapping (`lib/payments/mapping.ts`, TDD)

**Stripe:**
- Ny gren `checkout.session.expired` → `{ type:'payment.expired', provider:'stripe', ref:<session-id>, refKind:'paymentRef', eventId }`.
- `charge.refunded` leser nå BÅDE `amount` (charge-total) og `amount_refunded`: `amount_refunded < amount` → `payment.partially_refunded`; `amount_refunded === amount` → `payment.refunded` (uendret). Begge bærer `amountKr` (refundert beløp, øre/100).

**Vipps:** refusjonshendelsen leses for refundert beløp vs opprinnelig autorisert/fanget beløp. Bærer payloaden nok til å skille (refundert < total) → `payment.partially_refunded`, ellers full `refunded`. Manglende/upålitelig total ⇒ konservativ full `refunded` (dagens oppførsel), dokumentert. Mapping-koden leser KUN felter som faktisk finnes i payloaden — ingen gjetting.

Nye bus-typer i `lib/events/taxonomy.ts` `SERVER_EVENT_TYPES`: `payment.expired`, `payment.partially_refunded`, med norske tidslinje-titler («Betaling utløpt», «Delvis refundert (X kr)» — beløp fra meta når tilgjengelig).

## Apply-lag (`lib/payments/apply.ts`)

De nye event-typene rutes gjennom samme sti som eksisterende: ref-matching (paymentRef/paymentIntentRef) → `planStatusTransition` → skriv kun ved strengt økende rang → deal-flytting/event-emisjon. apply.ts trenger kun å kjenne de to nye status-strengene som gyldige `next`-verdier. Delrefusjonens beløp legges på event-metaen for tidslinjen.

## Kanban-badge + konsistent visning

- `app/api/admin/crm/pipelines/route.ts`: legg `paymentStatus` (+ `paymentProvider`) i deal-selecten.
- `/admin/crm/pipeline`: render en betalingsbadge på kanban-kortene.
- **Felles badge-hjelper** (norsk etikett + semantisk farge per status) brukes ALLE steder betalingsstatus vises — påmeldings-liste, booking-liste, kontakt-detalj-deals, kanban — så `expired`/`partially_refunded` får riktig etikett/farge overalt. Farger (§8): pending=gul, expired=grå, failed=rød, paid=grønn, partially_refunded=oransje, refunded=nøytral/blå. Status pares alltid med tekst (a11y §16), aldri bare farge.

## Unit-tester for `lib/flows/send.ts` (`tests/flows-send.test.ts`)

Mock `@/lib/prisma`, `@/lib/mail` (`sendMailAs`), `@/lib/ai/provider` via `vi.mock` (produksjonssignatur uendret). Dekk de kritiske stiene:
- P2002 på dedupe-rad → `already_sent` (ingen nettverkskall).
- Suppression / manglende marketing-samtykke → `skipped_suppressed`/`skipped_no_consent`, ingen dedupeKey.
- Vellykket send → `sent`, dedupeKey + trackingToken (marketing) + MessageLink-rader.
- `messageLink.createMany`-feil → `recoverFromFailedSend` (dedupe-slot frigjort, ingen dobbel-send) — Critical-scenarioet fra delprosjekt 4.
- `sendMailAs`-feil → gjenoppretting; og at en feilet `messageId`-oppdatering ETTER vellykket send IKKE trigger gjenoppretting (den andre delprosjekt-4-Critical'en).
- Personalisering: guardrail-avvisning/provider-null → original kropp sendes (fail-safe), aldri kastet; `aiPersonalized`-flagg kun ved guardrail-pass.

## Testing & utrulling

Rene deler (transitions/mapping/badge-hjelper) TDD'd med tabelltester; apply/webhook/pipelines/kanban via tsc + suite + build; finish-task med live smoke mot dev-DB (simuler `checkout.session.expired` + del-`charge.refunded` mot en test-rad, verifiser radstatus + tidslinje-event, rydd opp). **Ingen schema-migrering** (paymentStatus er allerede fri streng-kolonne — nye verdier trenger ingen DDL), ingen nye env-vars. Følger prod ved neste ordinære deploy (samme runbook).
