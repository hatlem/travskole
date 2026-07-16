# Event Bus & Payments — Design Spec

*Subproject 2 of the Engagement Platform (see `2026-07-06-engagement-platform-architecture.md`). Builds on the Contact & CRM Core (subproject 1, merged 2026-07-16).*

## Overview

Two tightly related capabilities, shipped as one subproject in two independently deliverable parts:

- **Part A — Event bus.** One append-only `AppEvent` log that every behavioral source writes to: server lifecycle code, a consent-gated client tracker (anonymous visitors + known contacts, stitched on identification), and payment webhooks. Selected events flow into the CRM timeline (`ContactActivity`) so subproject 1's UI gets richer with zero changes. Subproject 3 (flow engine) will consume this log as its trigger source.
- **Part B — Payments.** Real Stripe Checkout and Vipps ePayment flows for courses/bookings that have those methods enabled (foundation already in `lib/payments.ts`), with signature-verified webhooks that emit `payment.*` events onto the bus and drive deal/status transitions in the CRM.

**Non-goals:** flow triggers/sequence enrollment (subproject 3), email engagement tracking (subproject 4), a generic third-party webhook receiver (cut — no concrete consumer; Stripe/Vipps get dedicated endpoints).

## Part A — Event bus

### Data model (Prisma, follows repo conventions: Int ids, snake_case @map, createdAt/updatedAt)

```prisma
model Visitor {
  id          Int       @id @default(autoincrement())
  publicId    String    @unique @map("public_id")      // uuid v4, value of the bjerke_vid cookie
  contactId   Int?      @map("contact_id")              // set on identity stitching
  contact     Contact?  @relation(fields: [contactId], references: [id], onDelete: SetNull)
  firstSeenAt DateTime  @default(now()) @map("first_seen_at")
  lastSeenAt  DateTime  @default(now()) @map("last_seen_at")
  events      AppEvent[]
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  @@index([contactId])
  @@map("visitors")
}

model AppEvent {
  id         Int       @id @default(autoincrement())
  type       String                                     // from the fixed taxonomy — validated in code
  source     String                                     // 'server' | 'client' | 'webhook'
  contactId  Int?      @map("contact_id")
  contact    Contact?  @relation(fields: [contactId], references: [id], onDelete: SetNull)
  visitorId  Int?      @map("visitor_id")
  visitor    Visitor?  @relation(fields: [visitorId], references: [id], onDelete: SetNull)
  meta       String    @default("{}")                   // JSON string, free-form per type
  dedupeKey  String?   @unique @map("dedupe_key")       // idempotency; P2002 swallowed on emit
  occurredAt DateTime  @default(now()) @map("occurred_at")
  createdAt  DateTime  @default(now()) @map("created_at")

  @@index([type])
  @@index([contactId, occurredAt])
  @@index([visitorId, occurredAt])
  @@index([occurredAt])
  @@map("app_events")
}
```

`Contact` gains back-relations `visitors Visitor[]` and `events AppEvent[]`. No raw IP addresses are stored anywhere.

### Taxonomy v1 (`lib/events/taxonomy.ts`, fixed union — unknown types rejected)

| Group | Types | Emitted by |
|---|---|---|
| Server lifecycle | `user.registered`, `user.logged_in`, `booking.created`, `booking.status_changed`, `registration.created`, `registration.confirmed`, `registration.cancelled`, `consent.updated` | server code at existing call sites |
| Client (allowlisted for /api/track) | `page.viewed`, `course.viewed`, `signup.started`, `cta.clicked` | client tracker |
| Payment | `payment.succeeded`, `payment.failed`, `payment.refunded` | Stripe/Vipps webhooks (Part B) |

`CLIENT_EVENT_TYPES` is the strict subset accepted by `/api/track`; server/payment types sent from the client are rejected with 400.

### Engine (`lib/events/bus.ts`)

`emitEvent({ type, contactId?, visitorId?, meta?, dedupeKey?, occurredAt?, source })`:

- **Fire-safe:** wraps everything in try/catch, logs and never throws (same guarantee as the CRM bridge — an event failure can never break a public flow).
- Validates `type` against the taxonomy; drops (logs) unknown types.
- Dedup: on `dedupeKey` P2002, silently return (idempotent).
- Side effects, best-effort after the insert: bump `Contact.lastActivityAt` / `Visitor.lastSeenAt`; for types in a `TIMELINE_TYPES` map, append a `ContactActivity` (Norwegian title per type) when the event has a contact — this is how the CRM timeline gets behavioral entries without UI changes.
- Existing lifecycle call sites (registration/booking routes, auth) get one-line `emitEvent(...).catch(() => {})` additions, mirroring the bridge-hook pattern from subproject 1.

### Client tracker + getcookies (consent-gated, hard requirement)

- The public layout embeds the getcookies widget (`https://cdn.getcookies.co/...loader.js`, site-ID for bjerke.no from the getcookies dashboard) and a small `<Tracker />` client component.
- **Consent contract (verified against getcookies source, widget v2.3.x):**
  - Synchronous read: `localStorage['getcookies_consent']` → `{ categories: string[], expiry: epoch-ms, ... }`; analytics granted ⇔ `categories.includes('analytics')` and not expired.
  - Reactive: `window` CustomEvents `getcookies:consent`, `getcookies:consent-updated`, `getcookies:loaded` (detail = consent object; `loaded` may carry `{ implied: true }` for geo-implied consent that is NOT in localStorage — the tracker must honor it).
- Behavior: no analytics consent → no `bjerke_vid` cookie, no tracking calls at all. On grant → set `bjerke_vid` (uuid v4, first-party, `SameSite=Lax`, 13 months) and start sending. On revoke (`consent-updated` without `analytics`) → stop and delete the cookie.
- Events sent: `page.viewed` on App Router navigation, `course.viewed` on course detail pages (meta: courseId/slug), `signup.started` on first interaction with the signup form, `cta.clicked` for explicitly instrumented buttons. `fetch(..., { keepalive: true })`, fire-and-forget.
- `POST /api/track`: Zod-validated `{ type ∈ CLIENT_EVENT_TYPES, publicId, meta? }`; resolves/creates the `Visitor` by `publicId`; attaches `contactId` when a session exists; per-IP+visitor rate limit; always 204 (no oracle for probing).

### Identity stitching

When an authenticated/identifying server event fires (`user.registered`, `user.logged_in`, `registration.created`, `booking.created`) and the request carries a `bjerke_vid` cookie whose `Visitor` has no `contactId`:
1. Set `visitor.contactId`.
2. Re-attribute the visitor's anonymous events: `updateMany` setting `contactId` on that visitor's `AppEvent` rows (single query).
Pure decision logic (`planStitch(visitor, contactId)`) lives in `lib/events/stitch.ts` and is unit-tested; the DB write layer stays thin.

### Getcookies widget extension (separate repo: `~/Projects/getcookies`)

The real `window.GetCookies` lacks `addEventListener`/`removeEventListener` (the loader stub queues them but replay drops them; the generated GTM template even calls a non-existent `.on()`). We add both (+ `.on`/`.off` aliases) to `src/index.js` as thin wrappers over the existing window CustomEvents, making the stub replay correct and the GTM template valid. Backwards compatible; own commit + e2e assertion in the getcookies repo. The travskole tracker does NOT depend on this (it uses window events directly) — this is a correctness fix we make because we can.

## Part B — Payments (Stripe + Vipps)

### Provider abstraction

`lib/payments.ts` (existing foundation: per-course methods, test-mode, key helpers) grows into `lib/payments/`:

- `provider.ts` — `PaymentProvider` interface: `createCheckout(input) → { redirectUrl, externalRef }`, `verifyWebhook(request) → VerifiedEvent | null`, `mapEvent(raw) → { type: 'payment.succeeded'|'payment.failed'|'payment.refunded', externalRef, amount, meta }`.
- `stripe.ts` — Stripe Checkout Session (`mode: 'payment'`, `kronerToOre` for amounts, success/cancel URLs); webhook verified with `STRIPE_WEBHOOK_SECRET` via `stripe.webhooks.constructEvent`; handles `checkout.session.completed`, `payment_intent.payment_failed`, `charge.refunded`. Test/live keys per the existing `isTestMode()` toggle.
- `vipps.ts` — Vipps MobilePay ePayment API: `POST /epayment/v1/payments` (access token via client credentials, `Ocp-Apim-Subscription-Key`, MSN), redirect to `redirectUrl`; webhooks registered via Vipps webhook API and verified per Vipps' HMAC scheme; maps `AUTHORIZED`→ capture → `payment.succeeded`, `FAILED/EXPIRED/CANCELLED`→`payment.failed`, `REFUNDED`→`payment.refunded`. MT (test) environment used until live keys are switched in.
- Env vars (new): `STRIPE_WEBHOOK_SECRET`, `VIPPS_CLIENT_ID`, `VIPPS_CLIENT_SECRET`, `VIPPS_SUBSCRIPTION_KEY`, `VIPPS_MSN`, `VIPPS_TEST_MODE`. Documented in `.env.example`; production values go to Basefarm with the deploy notes.

### Schema additions

`Registration` and `BookingRequest` gain: `paymentStatus String @default("none")` (`none|pending|paid|failed|refunded`), `paymentProvider String?` (`stripe|vipps`), `paymentRef String? @unique` (provider's session/payment id — idempotency anchor for webhooks). Additive columns; nullable/defaulted so existing rows are unaffected.

### Flows

1. **Checkout start:** after a registration/booking is created for a course whose `paymentMethods` includes `stripe` or `vipps`, the confirmation step offers the enabled provider(s). `POST /api/payments/checkout` (Zod: registrationId|bookingRequestId + provider) creates the provider session, stores `paymentRef`/`paymentProvider`/`paymentStatus='pending'`, returns the redirect URL. Faktura remains the no-op default it is today.
2. **Return pages:** `/betaling/takk` (success — status shown from DB, not trusted from the URL) and `/betaling/avbrutt` (cancel — offers retry/faktura). Norwegian copy.
3. **Webhooks:** `POST /api/webhooks/stripe` and `POST /api/webhooks/vipps` — signature verification FIRST (401 on failure), then idempotent processing keyed on `paymentRef` + event id (`dedupeKey`): update `paymentStatus`, emit the mapped `payment.*` event on the bus (contact resolved via the registration/booking → CRM link), and on `payment.succeeded` move the linked Deal to the won stage via the same transition semantics as the kanban (preserve `closedAt` if already closed). Webhook routes are public (no session) but verified; they never trust body contents without signature.
4. **Timeline:** `payment.*` are `TIMELINE_TYPES`, so payments appear on the contact's CRM timeline automatically ("Betaling mottatt — Begynnerkurs, 2 500 kr").

## Admin UI

New CRM tab **«Hendelser»** (`/admin/crm/hendelser`): server-side paginated event log (newest first) with type/source/date/contact filters, meta shown in an expandable row. Follows every subproject-1 UI convention (CrmTabs, TableSkeleton, EmptyState, fetch-hardening with res.ok/finally/AbortController, Norwegian copy). Payment status becomes visible where registrations/bookings already render (status badge column), and on the deal card.

## GDPR & retention

- Anonymous tracking runs only after explicit analytics consent via getcookies (ekomloven § 2-7b); consent decisions are logged as `consent.updated` events.
- Retention: visitors with no `contactId` and their events are purged after **180 days** (constant), as a step in the existing daily Azure timer cron. Stitched (identified) events follow the contact's lifecycle (deleted via SetNull/cascade rules when a contact is deleted).
- No raw IPs stored; `meta` for client events is limited to path/courseId/CTA-id (enforced by Zod).
- Payment webhooks store provider refs and amounts, not card/account data.

## Testing

Repo pattern: pure logic gets Vitest TDD, DB/route layers stay thin.
- `lib/events/taxonomy.ts` — type validation, client-allowlist.
- `lib/events/stitch.ts` — stitching decision logic.
- `lib/payments/` — provider event mapping (raw Stripe/Vipps payloads → `payment.*`), amount conversion, checkout input validation. Webhook signature verification tested with recorded fixtures (Stripe's test signatures; Vipps HMAC vectors).
- Tracker consent logic extracted to a pure helper (`parseConsent(raw) → boolean`) and unit-tested against real `getcookies_consent` payload shapes incl. expiry and implied-consent absence.
- E2E smoke at finish: Stripe test-mode checkout completed against the dev DB; Vipps MT flow if test app available.

## Migration & rollout

- Schema: additive (`visitors`, `app_events`, three columns on `registrations`/`booking_requests`). Same Basefarm routine: generated SQL script (`scripts/event-bus-migration.sql`) reflecting the final schema, applied before deploy.
- New env vars must be set in Azure before the payments part goes live; webhook URLs (`/api/webhooks/stripe`, `/api/webhooks/vipps`) registered in the respective dashboards (Stripe CLI/dashboard; Vipps webhook API).
- Build order inside the subproject: Part A is fully shippable without Part B; Part B depends on Part A's bus only for event emission. Two implementation plans (2a: bus+tracker+stitching+admin, 2b: payments) executed in sequence.

## Deliberate scope cuts

- No generic `WebhookSource` receiver (no consumer today).
- No `signup.abandoned`/derived events (requires sessionization — flow engine territory).
- No dashboards/aggregates over events (subproject 6).
