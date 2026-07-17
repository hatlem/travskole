# Flow Engine & Canvas — Design Spec

*Subproject 3 of the Engagement Platform (see `2026-07-06-engagement-platform-architecture.md`). Builds on the CRM core (1), event bus (2a) and payments (2b), all merged to main. Scope decision (approved): sender identities and a real `MessageSend` log ship NOW (pulled forward from subproject 4), plus legally required unsubscribe handling; open/click tracking and IMAP reply-stop remain in subproject 4.*

## Overview

Staff build **visual multi-step email flows** on a React Flow canvas — the Lemlist/Woodpecker-style capability sold to Bjerke. A flow is a validated DAG of typed nodes. Contacts enter flows via **event-bus triggers** (e.g. `registration.confirmed` for course X), via **manual enrollment** (contact detail / whole segment), and advance through the graph by a **5-minute scheduler**. Email steps send through the existing ACS relay with a **chosen sender identity** (the 7 verified bjerke.no addresses), idempotent send logging, suppression/consent enforcement at send time, and a signed unsubscribe link in every flow email.

**Non-goals (subproject 4+):** open/click tracking pixels, IMAP reply-stop, AI personalization, deliverability tooling, flow analytics dashboards (subproject 6).

## Data model (Prisma; repo conventions: Int ids, snake_case @map, createdAt/updatedAt)

```prisma
model Flow {
  id          Int              @id @default(autoincrement())
  name        String
  description String?
  status      String           @default("draft") // draft | active | paused | archived
  isMarketing Boolean          @default(true) @map("is_marketing") // markedsføring krever samtykke ved send
  nodes       FlowNode[]
  edges       FlowEdge[]
  triggers    FlowTrigger[]
  enrollments FlowEnrollment[]
  createdAt   DateTime         @default(now()) @map("created_at")
  updatedAt   DateTime         @updatedAt @map("updated_at")
  @@map("flows")
}

model FlowNode {
  id        Int      @id @default(autoincrement())
  flowId    Int      @map("flow_id")
  flow      Flow     @relation(fields: [flowId], references: [id], onDelete: Cascade)
  type      String   // start | email | wait | condition | action | end
  config    String   @default("{}") // JSON per nodetype (se under)
  posX      Float    @default(0) @map("pos_x")
  posY      Float    @default(0) @map("pos_y")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  @@index([flowId])
  @@map("flow_nodes")
}

model FlowEdge {
  id         Int      @id @default(autoincrement())
  flowId     Int      @map("flow_id")
  flow       Flow     @relation(fields: [flowId], references: [id], onDelete: Cascade)
  fromNodeId Int      @map("from_node_id")
  toNodeId   Int      @map("to_node_id")
  branch     String?  // 'ja' | 'nei' for condition-noder; null ellers
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")
  @@index([flowId])
  @@map("flow_edges")
}

model FlowTrigger {
  id        Int      @id @default(autoincrement())
  flowId    Int      @map("flow_id")
  flow      Flow     @relation(fields: [flowId], references: [id], onDelete: Cascade)
  eventType String   @map("event_type") // fra bussens taksonomi
  filter    String   @default("{}") // JSON subset-match mot event.meta (f.eks. {"courseId": 3})
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  @@index([eventType])
  @@map("flow_triggers")
}

model FlowEnrollment {
  id            Int       @id @default(autoincrement())
  flowId        Int       @map("flow_id")
  flow          Flow      @relation(fields: [flowId], references: [id], onDelete: Cascade)
  contactId     Int       @map("contact_id")
  contact       Contact   @relation(fields: [contactId], references: [id], onDelete: Cascade)
  currentNodeId Int?      @map("current_node_id") // null før første tick (står på start)
  status        String    @default("active") // active | completed | exited | failed
  nextRunAt     DateTime  @default(now()) @map("next_run_at")
  enteredAt     DateTime  @default(now()) @map("entered_at")
  finishedAt    DateTime? @map("finished_at")
  failReason    String?   @map("fail_reason")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")
  @@index([status, nextRunAt]) // runnerens arbeidskø
  @@index([flowId, contactId, status]) // maks-én-aktiv-håndheving i kode
  @@map("flow_enrollments")
}

model SenderIdentity {
  id          Int      @id @default(autoincrement())
  email       String   @unique // en av de 7 verifiserte bjerke.no-adressene
  displayName String   @map("display_name")
  active      Boolean  @default(true)
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  @@map("sender_identities")
}

model MessageSend {
  id               Int             @id @default(autoincrement())
  enrollmentId     Int?            @map("enrollment_id")
  nodeId           Int?            @map("node_id")
  contactId        Int             @map("contact_id")
  contact          Contact         @relation(fields: [contactId], references: [id], onDelete: Cascade)
  senderIdentityId Int?            @map("sender_identity_id")
  senderIdentity   SenderIdentity? @relation(fields: [senderIdentityId], references: [id], onDelete: SetNull)
  toEmail          String          @map("to_email")
  subject          String
  bodyHtml         String          @map("body_html")
  status           String          @default("sent") // sent | failed | skipped_suppressed | skipped_no_consent | test
  dedupeKey        String?         @unique @map("dedupe_key") // flow:{enrollmentId}:{nodeId}
  sentAt           DateTime        @default(now()) @map("sent_at")
  createdAt        DateTime        @default(now()) @map("created_at")
  @@index([contactId, sentAt])
  @@map("message_sends")
}
```

`Contact` gains back-relations `flowEnrollments FlowEnrollment[]` and `messageSends MessageSend[]`. `SenderIdentity` gains `messageSends MessageSend[]`. `MessageSend` is append-only (no `updatedAt`), same documented exception as `AppEvent`; in subproject 4 it gains tracking-token columns.

Seed (idempotent script or in the admin API's ensure-step): the 7 verified identities — registrering@ («Bjerke Registrering», default), hilde.apneseth@, andre.ringelien@, hege.karin.arverud@, stine.rasmussen@, bjerke@, arild.engebretsen@ — display names editable in admin.

## Node types & config (JSON in `FlowNode.config`)

| Type | Config | Semantics |
|---|---|---|
| `start` | `{}` | Exactly one per flow. Enrollment enters here. |
| `email` | `{ subject, bodyHtml, senderIdentityId }` | Renders merge-tags (existing `replaceMergeTags` + `wrapEmailHtml`), appends unsubscribe footer, sends via ACS with the chosen identity as sender/Reply-To. Idempotent via `MessageSend.dedupeKey`. |
| `wait` | `{ days?: number, hours?: number }` (≥ 1 time total) | Sets `nextRunAt = now + duration`; enrollment sleeps. |
| `condition` | `{ kind: 'in_segment' \| 'stage_is' \| 'deal_status', value }` | Evaluated against the contact at tick time (reuses `contactMatchesSegment` for `in_segment`). Two outgoing edges required: branch `ja`/`nei`. («åpnet e-post» blir en ny kind i delprosjekt 4.) |
| `action` | `{ kind: 'add_tag' \| 'remove_tag' \| 'set_stage' \| 'notify_admin' \| 'exit', value? }` | Mutates the contact / notifies (email to admin) / exits the enrollment. |
| `end` | `{}` | Enrollment → `completed`. |

## Engine (`lib/flows/`)

- **`graph.ts` (pure, TDD):** typed parse of nodes/edges/config; `validateFlow(nodes, edges): ValidationError[]` — exactly one start; every node reachable from start; **DAG (no cycles)**; every non-end node has the required outgoing edges (condition: both `ja` and `nei`; others: exactly one); every path reaches an `end` or an `exit`-action; email nodes have subject/body/sender; wait ≥ 1 hour. Activation requires zero errors; drafts may be invalid.
- **`step.ts` (pure, TDD):** `planStep(node, edges, context) → StepPlan` — a discriminated union: `{ kind: 'send_email', ... , next }`, `{ kind: 'sleep', until, next }`, `{ kind: 'branch', taken: 'ja'|'nei', next }`, `{ kind: 'act', action, next }`, `{ kind: 'complete' }`, `{ kind: 'fail', reason }`. Context carries the contact snapshot (tags, stage, deals, segment rules) — all evaluation pure.
- **`enroll.ts` (pure match + thin DB):** `matchTriggers(event, triggers)` — eventType equality + shallow subset-match of filter against event meta (TDD). `enrollFromEvent(event)` (DB): for each matching active flow, create enrollment unless one is already `active` for (flow, contact); fire-safe, called best-effort from `emitEvent` (never blocks the bus).
- **`runner.ts` (thin DB):** claims due enrollments (`status: 'active', nextRunAt <= now`, batch 50, ordered by nextRunAt), executes plans: email → suppression + consent check (skip-with-log if suppressed/no marketing consent when flow is marked marketing) → render → `MessageSend` create with dedupeKey (P2002 ⇒ already sent, advance without resend) → ACS send → advance; sleep → set nextRunAt; branch/act → apply + advance immediately (max 20 hops per enrollment per tick — DAG guarantee makes this a safety net, not a correctness need). Per-enrollment try/catch: failure ⇒ `status: 'failed'` + `failReason`, batch continues. Flow paused/archived ⇒ enrollments untouched (resume continues where they stood).
- **Marketing flag:** `Flow` gets `isMarketing Boolean @default(true)` — marketing flows require `Consent.marketing = true` at send time; transactional flows (false) skip that check but still honor Suppression.

## Unsubscribe (ships now — legally required)

- `lib/flows/unsubscribe-token.ts` (pure, TDD): HMAC-signed token bound to contactId + purpose `'unsub'`, no expiry (unsubscribe links must not rot), NEXTAUTH_SECRET — same pattern as checkout-token.
- Every flow email footer: «Du mottar denne e-posten fra Bjerke Travbane. [Meld deg av] » → `GET /avmeld?token=…` — public page: verifies token, creates `Suppression` for the contact's email, sets `Consent.marketing = false`, emits `consent.updated`, shows Norwegian confirmation. Idempotent.
- `List-Unsubscribe` header set on flow emails (mailto + URL) — cheap deliverability win.

## Scheduler

New Azure timer function `azure-functions/cron-flows/` (`0 */5 * * * *`) → `POST /api/cron/flows` gated by the same CRON_SECRET pattern as the existing daily cron. The route runs one runner batch and returns counts `{ processed, sent, failed }`. Manual "kjør nå"-knapp in admin calls the same route (admin-gated variant).

## Admin API (under `/api/admin/crm/`, established hardening pattern)

- `flows` CRUD; graph saved atomically as one payload `{ nodes, edges }` (replace-all inside a transaction — the canvas is source of truth); `POST flows/[id]/activate` runs `validateFlow` → 400 with the error list; pause/resume/archive.
- `flows/[id]/triggers` CRUD (eventType must be in the bus taxonomy).
- `flows/[id]/enrollments` list (paginated) + `POST` manual enroll `{ contactId }` or `{ segmentId }` (bulk, capped + counted response).
- `sender-identities` list/update (displayName, active) + idempotent seed of the 7.
- `POST flows/[id]/test-send` `{ nodeId, toEmail }` — renders that email node with sample merge data, sends to the given address, records `MessageSend` with status `test`, no enrollment involved.

## Canvas & UI (`/admin/crm/flyter`)

- **List page:** name, status badge, active-enrollment count, triggers summary; new/pause/resume/archive; CrmTabs entry «Flyter» + breadcrumb.
- **Editor (`/admin/crm/flyter/[id]`):** `@xyflow/react` canvas — node palette (drag in the six types), connectable handles (condition nodes: two labeled source handles ja/nei), config side-panel per selected node (email: subject/body textarea with merge-tag hints + sender dropdown; wait: duration; condition/action: kind+value selects), save-draft button (bulk graph save), «Aktiver»-button showing validation errors inline (nodes with errors highlighted), trigger management panel, enrollment counter, test-send from an email node. All fetch/mutation hardening per the established pattern; Norwegian copy.
- New dependency: `@xyflow/react` (the maintained React Flow package).

## GDPR & safety

- Suppression honored at every send; marketing flows additionally require marketing consent — both checked at send time, not enrollment time.
- Unsubscribe in every flow email (above). All sends logged in `MessageSend` (auditability). No tracking pixels yet (that debate belongs to subproject 4's consent design).
- Engine failure can never break public flows: enrollment happens best-effort off the bus; the runner is cron-isolated.
- Max-one-active-enrollment per (flow, contact) prevents duplicate sequences; completed contacts can be re-enrolled later (re-engagement).

## Testing

Pure/TDD: `validateFlow` (each rule + a valid golden graph), `planStep` (every node type + malformed config → fail-plan), `matchTriggers` (type + filter subset semantics), unsubscribe-token (roundtrip/tamper), merge of node config parsing. Thin DB/runner/routes verified via typecheck + suite; finish task does a live dry-run: activate a 3-node flow (start → email → end) against the dev DB, run the cron route, verify MessageSend + enrollment completed, plus browser smoke of the canvas.

## Migration & rollout

Additive schema (7 tables + Contact back-relations); `scripts/flow-engine-migration.sql` for Basefarm (same routine). New Azure timer must be deployed alongside (function.json included in repo; Basefarm/deploy notes updated). New env: none beyond existing CRON_SECRET/NEXTAUTH_SECRET. Build order inside the plan: schema → pure engine → send-lag → runner/cron → APIs → canvas → finish.
