# Engagement Platform — Architecture Spec

## Overview

Build an in-house alternative to Lemlist/Woodpecker — a CRM + event-driven
email automation platform — directly inside the Bjerke registration app. It
lets staff maintain contacts and companies, see everything they've done on one
timeline, run a sales/booking pipeline, and build **visual multi-step email
flows** on a canvas. Flows are enrolled by **events** (registered, logged in,
paid, on-page actions), by **schedules** (seasonal re-engagement of past event
bookers), or manually. When LLM keys are configured, an AI layer personalizes
per recipient, generates whole sequences, assists in the editor, and optimizes
send timing; without keys, everything falls back to fixed templates.

The primary business driver: Bjerke hosts **courses** (B2C — parents/kids) and
**venue events** (B2B — julebord, firmafest, afterwork booked by companies).
Making it *easy to re-contact past bookers* — "you booked a julebord last year,
shall we set a date this year?" — is a first-class goal.

This document is the umbrella architecture. Each subsystem below gets its own
design spec → implementation plan → build cycle. It exists to keep the six
parts coherent.

## Why this over the existing system

The current `EmailTrigger` (see `2026-03-17-email-template-system-design.md`) is
per-course and date-only — it cannot express contacts, companies, multi-step
flows, branching, behavioral triggers, or re-engagement. It stays in place and
keeps sending today's course lifecycle emails; the new engine lives alongside
it and can later absorb those triggers as flows.

## Shared spine

Everything hangs off two shared entities and one shared log:

- **`Contact` / `Organization`** — people and companies. The CRM subject and the
  recipient of every flow.
- **`AppEvent`** — the event bus. A single append-only log that *all* sources
  write to (`emitEvent(type, subjectRef, meta)`). Every event both lands on the
  subject's timeline and is evaluated against flow enrollment rules.

## Subsystems and build order

Dependency order. Each is a separate spec/plan/build.

### 1. Contact & CRM core *(first — the spine)*

`Organization`, `Contact`, `ContactList` + membership, `Segment` (rule-based),
`Pipeline` → `Stage` → `Deal` (kanban, with `eventType`/`eventDate` for venue
bookings), unified `ContactActivity` timeline, `Task`, `Note`, `Consent` /
`Suppression`, CSV import with dedup, and a bridge that turns existing
`BookingRequest` / `Registration` rows into contacts/orgs/deals so booking
history is populated from day one.

Detailed in `2026-07-06-contact-crm-core-design.md`.

### 2. Event bus

`AppEvent` model + `emitEvent()`. Sources:
- **Server lifecycle** — `user.registered`, `user.logged_in`, `payment.succeeded`
  (emitted from the NextAuth callbacks, registration flow, and payment
  webhooks — Stripe/Vipps webhooks are not built yet; the emitter is the seam
  they plug into).
- **On-page actions** — a client `/api/track` endpoint (`page.viewed`,
  `registration.started`, `checkout.abandoned`, `cta.clicked`), signed to
  prevent spoofing.
- **Email engagement** — opens/clicks/replies from subsystem 4.

Fixed type taxonomy + free-form `meta` JSON. Idempotency via a dedup key. Each
event: (a) appends to `ContactActivity`, (b) is matched against `FlowTrigger`
rules for enrollment.

### 3. Flow engine + canvas

Graph execution. `Flow`, `FlowNode` (email / wait / condition / branch /
action / entry / exit), `FlowEdge`, `FlowEnrollment` (pointer to current node +
`nextRunAt`), `FlowTrigger` (event/segment/schedule → enroll). A scheduler
(Azure timer, ~every 5 min — up from today's daily) advances due enrollments;
behavioral events enroll immediately. Graph validation on publish (no infinite
loops, every path reaches an exit). Canvas built with **React Flow**
(`@xyflow/react`) — drag-and-drop nodes, edges, zoom, minimap.

### 4. Sending & tracking

ACS SMTP relay (existing credentials). `SenderIdentity` — the seven verified
`bjerke.no` addresses — chosen per flow/step, `Reply-To` = sender. `MessageSend`
(one row per email; carries tracking tokens + idempotency, extends today's
`EmailLog`). Own endpoints for open pixel and click redirect. `List-Unsubscribe`
header + unsubscribe page, honored everywhere.

**Open question (resolve here):** reply-stop needs inbox access. Staff set
`Reply-To` to the *personal* sender address, so detecting replies requires
either IMAP credentials to those mailboxes or routing replies through one
monitored mailbox (`registrering@bjerke.no`). Decide when we reach this
subsystem.

### 5. AI layer

`LLMProvider` interface, **Anthropic (Claude) primary**, OpenAI-compatible
fallback; keys via env. No keys → fixed templates. Capabilities: per-recipient
personalization at send time, sequence generation from a goal, editor assist
(subject variants, tone, shorten), smart send-timing/follow-up. Generated text
is cached on `MessageSend` for auditability. Guardrails: AI rewrites *copy*
only — never invents facts, links, prices, or dates — and always produces an
editable draft, never an unreviewed autonomous send for net-new campaigns.

### 6. Admin UI & analytics

CRM views (contact/company list, detail + timeline, kanban pipeline, tasks),
the flow canvas, and dashboards (opens/clicks/conversions per flow, pipeline
value, re-engagement performance). Woven throughout; role-gated to
admin/superadmin.

## Cross-cutting principles

- **DB:** Prisma on PostgreSQL (prod) / SQLite (dev). Follow existing repo
  conventions — `Int @default(autoincrement())` IDs, `String` for enum-like and
  JSON columns (portability), `@map`/`@@map` snake_case, `createdAt`/`updatedAt`
  on every model.
- **All AI and sending is server-side.** Keys never reach the client.
- **GDPR:** marketing consent + lawful basis recorded per contact; `Suppression`
  respected in every send path; tracking pixel weighed against privacy;
  retention follows the existing `data_retention_days` pattern.
- **Coexistence:** the current course `EmailTrigger`/cron keeps working
  untouched until explicitly migrated.

## Out of scope (for now)

- Arbitrary n8n-style general graph flows beyond the fixed node types above.
- SMS / push channels (email only in this phase).
- Migrating existing course triggers into flows (later, once the engine is
  proven).
