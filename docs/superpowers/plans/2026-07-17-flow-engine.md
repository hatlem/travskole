# Flow Engine & Canvas (3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship subproject 3 — validated DAG email flows with event-bus/manual enrollment, a 5-minute scheduler, sender identities, idempotent sends with unsubscribe, and a React Flow canvas editor.

**Architecture:** Eight new Prisma models beside the existing schema. Pure engine logic (graph validation, step planning, trigger matching, unsubscribe tokens) in `lib/flows/*` with Vitest TDD; thin DB layers (send, runner, enroll) mirroring the bus/bridge fire-safety split; cron route + new Azure timer; admin APIs with the established hardening pattern; canvas on `@xyflow/react`.

**Tech Stack:** Next.js 16 App Router, Prisma 5 (PostgreSQL), Zod 4, Vitest, `@xyflow/react`, existing ACS mail (`lib/mail.ts`), existing merge-tags (`lib/email-templates.ts`), event bus (`lib/events/*`), CRM segments (`lib/crm/segments.ts`).

**Spec:** `docs/superpowers/specs/2026-07-17-flow-engine-design.md`

## Global Constraints

- pnpm, never npm. Dev server never port 3000 (use 3001).
- Prisma conventions (Int ids, snake_case @map, createdAt/updatedAt — documented append-only exception: `MessageSend` has no updatedAt). Sync: `pnpm prisma db push`; production SQL in the final task.
- Engine fire-safety split: enrollment-from-events is best-effort (never throws into the bus); the RUNNER is cron-isolated and per-enrollment fault-tolerant (one failed enrollment → status 'failed' + failReason, batch continues).
- Send idempotency is non-negotiable: `MessageSend.dedupeKey = flow:{enrollmentId}:{nodeId}` unique; P2002 ⇒ already sent ⇒ advance WITHOUT resending.
- Suppression checked at send time for ALL flow emails; marketing flows (`Flow.isMarketing`) additionally require `Consent.marketing = true`. Skipped sends are logged as MessageSend with status `skipped_suppressed`/`skipped_no_consent` (no dedupeKey — a later legitimate send after re-consent must not be blocked).
- Every flow email: unsubscribe footer link (`/avmeld?token=…`, signed HMAC token, no expiry) + `List-Unsubscribe` header.
- Validation gate: activation requires `validateFlow` → zero errors; drafts may be invalid. DAG (no cycles) is a hard rule.
- Admin API hardening pattern (401 requireAdmin, integer-id guards → 400 'Ugyldig id', guarded JSON → 400 'Ugyldig JSON', Zod, P2025/P2003 → 404, P2002 → 409, logActivity fire-and-forget). UI hardening pattern per `app/admin/crm/kontakter/page.tsx` (+ `setTimeout(load,0)` effect, initialLoading split on detail pages, in-flight guards).
- UI copy Norwegian (bokmål). Routes: `/admin/crm/flyter`, `/admin/crm/flyter/[id]`, public `/avmeld`.
- Tests: Vitest `tests/*.test.ts`, alias `@` → repo root; TDD for all pure modules. Suite baseline: 234 passing.
- Commits: conventional, ≤ 50 chars, footer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- TypeScript strict; named exports; `const` over `let`; early returns. Never log secrets/tokens.

---

### Task 1: Prisma schema — flow models

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: models `Flow` (incl. `isMarketing Boolean @default(true)`), `FlowNode`, `FlowEdge`, `FlowTrigger`, `FlowEnrollment`, `SenderIdentity`, `MessageSend` EXACTLY as the spec's Prisma block (`docs/superpowers/specs/2026-07-17-flow-engine-design.md`, section "Data model") — copy it verbatim, it is the source of truth. Back-relations: `Contact.flowEnrollments FlowEnrollment[]`, `Contact.messageSends MessageSend[]`, `SenderIdentity.messageSends MessageSend[]`.

- [ ] **Step 1:** Copy the spec's model block into `prisma/schema.prisma` (end of file, under a `// ── Flyt-motor (delprosjekt 3) ──` header) and add the three back-relations. `MessageSend` intentionally has no `updatedAt` (append-only, documented exception like `AppEvent`).
- [ ] **Step 2:** `pnpm prisma validate && pnpm prisma db push && pnpm prisma generate` → all succeed (7 new tables).
- [ ] **Step 3:** `pnpm test` → 234 passed.
- [ ] **Step 4: Commit** `git add prisma/schema.prisma && git commit -m "feat(flows): flow engine schema"`

---

### Task 2: Add @xyflow/react dependency

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`

- [ ] **Step 1:** `pnpm add @xyflow/react`
- [ ] **Step 2:** `pnpm exec tsc --noEmit` clean; `pnpm test` → 234 passed.
- [ ] **Step 3: Commit** `git add package.json pnpm-lock.yaml && git commit -m "chore(flows): add @xyflow/react"`

---

### Task 3: `lib/flows/graph.ts` — parse + validateFlow (TDD)

**Files:**
- Create: `lib/flows/graph.ts`
- Test: `tests/flows-graph.test.ts`

**Interfaces:**
- Produces (later tasks import these exact names):

```ts
export type FlowNodeType = 'start' | 'email' | 'wait' | 'condition' | 'action' | 'end';
export interface GraphNode { id: number; type: FlowNodeType; config: Record<string, unknown> }
export interface GraphEdge { id: number; fromNodeId: number; toNodeId: number; branch: string | null }
export interface ValidationError { nodeId: number | null; code: string; message: string } // message på norsk
export function parseNodeConfig(raw: string): Record<string, unknown>; // tolerant JSON → {} on garbage
export function validateFlow(nodes: GraphNode[], edges: GraphEdge[]): ValidationError[];
```

- Validation rules (each its own error `code`, Norwegian `message`):
  - `no_start` / `multiple_starts`: exactly one `start` node.
  - `unreachable`: every node reachable from start (BFS along edges).
  - `cycle`: graph must be a DAG (DFS coloring; report one offending nodeId).
  - `missing_edge`: every non-end node needs outgoing edges — `condition` exactly two with branches `ja` and `nei` (`missing_branch` when mislabeled/missing); all other non-end types exactly one (branch null).
  - `dead_end`: every path from start must reach an `end` node OR an `action` node with `kind: 'exit'` (treat exit-action as terminal even without outgoing edge; an exit-action with an outgoing edge is `exit_with_edge`).
  - `email_config`: email nodes require non-empty string `subject`, non-empty string `bodyHtml`, integer `senderIdentityId`.
  - `wait_config`: wait nodes require `days`/`hours` numbers whose total ≥ 1 hour.
  - `condition_config`: kind ∈ `in_segment | stage_is | deal_status` + non-empty `value`.
  - `action_config`: kind ∈ `add_tag | remove_tag | set_stage | notify_admin | exit`; `value` required for tag/stage kinds.
  - Empty graph → `no_start` only (don't cascade noise).

- [ ] **Step 1: Write the failing tests** — `tests/flows-graph.test.ts` with a `n(id, type, config?)`/`e(id, from, to, branch?)` helper pair and these cases: valid golden graph (start→email→wait→condition→[ja: action(add_tag)→end, nei: end]) → `[]`; missing start; two starts; unreachable node; simple cycle (a→b→a) → contains code 'cycle'; condition with only 'ja' edge → 'missing_branch'; email without senderIdentityId → 'email_config'; wait 0 hours → 'wait_config'; exit-action terminal accepted; exit-action WITH outgoing edge → 'exit_with_edge'; non-end node without outgoing edge → 'dead_end' or 'missing_edge'; `parseNodeConfig('not json')` → `{}`.
- [ ] **Step 2:** RED run: `pnpm vitest run tests/flows-graph.test.ts` → module missing.
- [ ] **Step 3:** Implement — pure, no imports beyond types. BFS reachability, DFS cycle detection, per-type config validators. All messages Norwegian (e.g. «Flyten må ha nøyaktig én start-node», «Flyten har en løkke — flyter må være uten sykler», «E-post-noden mangler emne, innhold eller avsender»).
- [ ] **Step 4:** GREEN + `pnpm test` (234 + ~11 new — record actual).
- [ ] **Step 5: Commit** `git add lib/flows/graph.ts tests/flows-graph.test.ts && git commit -m "feat(flows): graph validation"`

---

### Task 4: `lib/flows/step.ts` — planStep (TDD)

**Files:**
- Create: `lib/flows/step.ts`
- Test: `tests/flows-step.test.ts`

**Interfaces:**
- Consumes: `GraphNode`, `GraphEdge`, `FlowNodeType` from `./graph`; `contactMatchesSegment`, `parseSegmentRules`, `SegmentContact` from `@/lib/crm/segments`.
- Produces:

```ts
export interface StepContext {
  contact: SegmentContact & { stage: string | null; tags: string[] };
  segmentRulesById: Record<number, string>; // segmentId → raw rules-JSON (for in_segment)
  now: Date;
}
export type StepPlan =
  | { kind: 'send_email'; subject: string; bodyHtml: string; senderIdentityId: number; nextNodeId: number }
  | { kind: 'sleep'; until: Date; nextNodeId: number }
  | { kind: 'advance'; nextNodeId: number }              // condition/action fortsetter umiddelbart
  | { kind: 'act'; action: { kind: string; value?: string }; nextNodeId: number | null } // null ⇒ exit-terminal
  | { kind: 'complete' }
  | { kind: 'fail'; reason: string };
export function planStep(node: GraphNode, edges: GraphEdge[], ctx: StepContext): StepPlan;
```

- Semantics: `start` → advance along its single edge. `email` → send_email with config + next. `wait` → sleep until `ctx.now + duration`, next. `condition` → evaluate kind (`in_segment`: parse rules for `Number(value)` from `segmentRulesById`, missing rules ⇒ nei-gren; `stage_is`: `ctx.contact.stage === value`; `deal_status`: any deal with that status — reuse the SegmentContact deals) → advance along the matching branch edge. `action` → act with the action; `nextNodeId` from its edge or null when kind exit. `end` → complete. Any malformed config / missing expected edge (should be prevented by validation, but defensive) → fail with Norwegian reason.

- [ ] **Step 1: Failing tests** — cases per node type incl.: start advances; email plan carries config verbatim; wait computes `until` from days+hours; condition in_segment ja/nei (reusing a real segment-rules JSON), stage_is match/mismatch, deal_status; action exit → nextNodeId null; end → complete; email node with missing edge → fail; unknown type → fail.
- [ ] **Step 2:** RED. **Step 3:** Implement pure. **Step 4:** GREEN + full suite (record count). 
- [ ] **Step 5: Commit** `git add lib/flows/step.ts tests/flows-step.test.ts && git commit -m "feat(flows): step planner"`

---

### Task 5: `lib/flows/match.ts` — trigger matching (TDD)

**Files:**
- Create: `lib/flows/match.ts`
- Test: `tests/flows-match.test.ts`

**Interfaces:**
- Produces:

```ts
export interface TriggerLike { flowId: number; eventType: string; filter: string } // filter = JSON
export interface EventLike { type: string; meta: Record<string, unknown> }
export function matchTriggers(event: EventLike, triggers: TriggerLike[]): number[]; // unike flowId-er som matcher
```

- Semantics: type equality AND shallow subset-match — every key in the parsed filter must strictly-equal (`===`) the same key in `event.meta` (numbers/strings/booleans; no coercion, so filter `{"courseId": 3}` does NOT match meta `courseId: "3"`). Empty/garbage filter ⇒ type-only match. Duplicate flowIds deduped.

- [ ] **Step 1: Failing tests** — type match with empty filter; filter subset match; filter key missing in meta → no match; type mismatch → no match; NO type coercion ("3" ≠ 3); garbage filter JSON ⇒ type-only; dedupe of two triggers for same flow.
- [ ] **Step 2:** RED. **Step 3:** Implement pure. **Step 4:** GREEN + suite. 
- [ ] **Step 5: Commit** `git add lib/flows/match.ts tests/flows-match.test.ts && git commit -m "feat(flows): trigger matching"`

---

### Task 6: `lib/flows/unsubscribe-token.ts` (TDD)

**Files:**
- Create: `lib/flows/unsubscribe-token.ts`
- Test: `tests/flows-unsubscribe-token.test.ts`

**Interfaces:**
- Produces: `signUnsubscribeToken(contactId: number, secret?: string): string` and `verifyUnsubscribeToken(token: string, secret?: string): { contactId: number } | null`. Same construction as `lib/payments/checkout-token.ts` (READ IT and mirror the base64url + HMAC-SHA256 + timing-safe pattern) with payload `unsub.${contactId}` — NO expiry (avmeldingslenker skal aldri råtne). Secret default `process.env.NEXTAUTH_SECRET`; sign throws on missing secret, verify returns null and never throws.

- [ ] **Step 1: Failing tests** — roundtrip; tampered payload; tampered signature; garbage; wrong secret; non-integer id in payload → null; verify without secret env (explicit param test) → null.
- [ ] **Step 2:** RED. **Step 3:** Implement. **Step 4:** GREEN + suite. 
- [ ] **Step 5: Commit** `git add lib/flows/unsubscribe-token.ts tests/flows-unsubscribe-token.test.ts && git commit -m "feat(flows): unsubscribe token"`

---

### Task 7: Send-laget — `sendMailAs` + `lib/flows/send.ts`

**Files:**
- Modify: `lib/mail.ts` (new export `sendMailAs`)
- Create: `lib/flows/send.ts`

**Interfaces:**
- Consumes: the internal `sendMail` machinery in `lib/mail.ts` (READ the file first — mirror how the ACS client and fixed sender are configured), `replaceMergeTags`/`wrapEmailHtml` + `MergeTagData` from `@/lib/email-templates`, `signUnsubscribeToken` from `./unsubscribe-token`, `normalizeEmail` from `@/lib/crm/normalize`, `prisma`.
- Produces:
  - `lib/mail.ts`: `export async function sendMailAs(input: { from: string; replyTo?: string; to: string; subject: string; html: string; headers?: Record<string, string> }): Promise<void>` — same ACS client as `sendMail` but with caller-specified sender address (the 7 identities are verified on the ACS domain) and optional headers (used for `List-Unsubscribe`). If ACS's SDK requires the senderAddress in a specific format, mirror what `sendMail` does today and parametrize only the address.
  - `lib/flows/send.ts`: `sendFlowEmail(input: { enrollmentId: number; nodeId: number; contactId: number; subject: string; bodyHtml: string; senderIdentityId: number; isMarketing: boolean }): Promise<'sent' | 'already_sent' | 'skipped_suppressed' | 'skipped_no_consent' | 'failed'>`:
    1. Load contact (email, name) — no email ⇒ 'failed'.
    2. Suppression check (`prisma.suppression.findUnique({ where: { email: normalizeEmail(...) } })` — verify the Suppression model's unique field name in schema first) ⇒ log MessageSend status `skipped_suppressed` WITHOUT dedupeKey, return.
    3. If `isMarketing`: `Consent` for contact must have `marketing: true` ⇒ else `skipped_no_consent` (same no-dedupeKey logging).
    4. Load SenderIdentity (must be active) ⇒ else 'failed'.
    5. Render: `replaceMergeTags` on subject/body with MergeTagData built from the contact (read `lib/email-templates.ts` MergeTagData fields and map what's available; unknown fields empty string), `wrapEmailHtml`, then append the Norwegian unsubscribe footer: `<p style="font-size:12px;color:#6b7280">Du mottar denne e-posten fra Bjerke Travbane. <a href="{APP_URL}/avmeld?token={signUnsubscribeToken(contactId)}">Meld deg av</a></p>` (APP_URL from `process.env.NEXTAUTH_URL`).
    6. Create MessageSend with `dedupeKey: flow:{enrollmentId}:{nodeId}` FIRST (status 'sent' optimistically) — P2002 ⇒ return 'already_sent' (idempotency BEFORE the network call so retried batches can never double-send).
    7. `sendMailAs({ from: identity.email, replyTo: identity.email, to, subject, html, headers: { 'List-Unsubscribe': `<mailto:${identity.email}>, <{unsubUrl}>` } })`; on throw: update the MessageSend row to status 'failed' and return 'failed'.
- No unit tests (DB/IO layer); verification typecheck + suite.

- [ ] **Step 1:** Read `lib/mail.ts` sendMail internals; implement `sendMailAs`. **Step 2:** Implement `lib/flows/send.ts` per contract. **Step 3:** `pnpm exec tsc --noEmit` clean; `pnpm test` green. **Step 4: Commit** `git add lib/mail.ts lib/flows/send.ts && git commit -m "feat(flows): identity-based flow send"`

---

### Task 8: Runner + enrollment (DB) + bus-kobling

**Files:**
- Create: `lib/flows/runner.ts`
- Create: `lib/flows/enroll.ts`
- Modify: `lib/events/bus.ts` (best-effort hook at the END of `emitEvent`'s side-effect block)

**Interfaces:**
- Consumes: graph/step/match/send modules (Tasks 3–7 exact signatures), `prisma`, `logger`, `sendAdminEmail` (for notify_admin), `emitEvent` NOT consumed (avoid cycles — see hook note).
- Produces:
  - `lib/flows/enroll.ts`: `enrollFromEvent(input: { type: string; contactId: number | null; meta: Record<string, unknown> }): Promise<void>` — fire-safe (outer try/catch → logger, never throws): no contactId ⇒ return; load triggers of ACTIVE flows; `matchTriggers`; for each matched flowId: skip if an `active` enrollment exists for (flowId, contactId); create enrollment (`currentNodeId: null`, `nextRunAt: now`). Also `enrollContact(flowId, contactId)` (same guard, used by admin API) and `enrollSegment(flowId, segmentId): Promise<number>` (evaluate segment rules over contacts — reuse the contact-list segment evaluation approach from `app/api/admin/crm/contacts/route.ts`; cap 500 per call, return created count).
  - `lib/flows/runner.ts`: `runFlowBatch(now?: Date): Promise<{ processed: number; sent: number; failed: number; completed: number }>` — claim due enrollments (`status 'active', nextRunAt <= now`, take 50, orderBy nextRunAt, include flow status check: skip enrollments whose flow is not 'active'); per enrollment try/catch: load graph once per flow (cache in-batch by flowId), resolve current node (null ⇒ the start node), loop max 20 hops: `planStep` → execute (send via `sendFlowEmail` — 'failed' result ⇒ enrollment failed; skipped/sent/already ⇒ advance), sleep ⇒ persist `currentNodeId`+`nextRunAt` and break; act ⇒ apply (add/remove tag on contact.tags JSON — read how Contact.tags is stored and mirror; set_stage ⇒ contact.stage update; notify_admin ⇒ `sendAdminEmail` to the admin address used elsewhere — grep for the admin notification address pattern; exit ⇒ enrollment 'exited'); complete ⇒ 'completed'+finishedAt; fail-plan ⇒ 'failed'+failReason; hop-limit hit ⇒ 'failed' reason 'hop-limit'.
  - `lib/events/bus.ts` hook: after the existing side-effects in `emitEvent`, add `import('./enroll-bridge')`-style indirection is NOT needed — import `enrollFromEvent` from `@/lib/flows/enroll` lazily via dynamic `import()` INSIDE the function (avoids a static cycle bus→flows→bus if send/enroll ever emit) and call `.catch(() => {})`, only when the event has a contactId.
- No unit tests (DB layer; the pure planning is already covered). Verification: typecheck + suite.

- [ ] **Step 1:** Implement enroll.ts. **Step 2:** Implement runner.ts. **Step 3:** Bus hook (verify no import cycle: `pnpm exec tsc --noEmit`). **Step 4:** `pnpm test` green. **Step 5: Commit** `git add lib/flows/runner.ts lib/flows/enroll.ts lib/events/bus.ts && git commit -m "feat(flows): runner + event enrollment"`

---

### Task 9: Cron-rute + Azure-timer

**Files:**
- Create: `app/api/cron/flows/route.ts`
- Create: `azure-functions/cron-flows/function.json`, `azure-functions/cron-flows/index.js`

**Interfaces:**
- Consumes: `runFlowBatch` from `@/lib/flows/runner`. CRON_SECRET gating — mirror `app/api/cron/email-triggers/route.ts` EXACTLY (timingSafeEqual Bearer check, 401 on mismatch/missing).
- Produces: `POST /api/cron/flows` → `{ processed, sent, failed, completed }` (200) or 401. Azure function: copy `azure-functions/cron-email-triggers/index.js` structure verbatim with schedule `0 */5 * * * *` and target default `https://registrering.bjerke.no/api/cron/flows` (CRON_TARGET_URL_FLOWS override env).

- [ ] **Step 1:** Implement route (secret check first, then runFlowBatch, log summary). **Step 2:** Azure function files (schedule + fetch mirroring the existing one). **Step 3:** typecheck + suite green. **Step 4: Commit** `git add app/api/cron/flows azure-functions/cron-flows && git commit -m "feat(flows): cron route + azure timer"`

---

### Task 10: Admin-API — flows CRUD, graf-lagring, aktivering, triggere

**Files:**
- Create: `app/api/admin/crm/flows/route.ts` (GET list m/ enrollment-tellere via groupBy; POST create `{ name, description?, isMarketing? }`)
- Create: `app/api/admin/crm/flows/[id]/route.ts` (GET detail incl. nodes/edges/triggers; PATCH `{ name?, description?, isMarketing?, status? }` — status transitions restricted: draft→active KUN via activate-endepunktet; active↔paused; →archived alltid lov; DELETE only when draft/archived)
- Create: `app/api/admin/crm/flows/[id]/graph/route.ts` (PUT `{ nodes: [{ tempId|id, type, config, posX, posY }], edges: [{ fromRef, toRef, branch }] }` — replace-all in ÉN `prisma.$transaction` (delete edges→nodes, recreate, map tempId→new id for edges); returns the saved graph with real ids; ONLY allowed while flow er draft ELLER paused — 409 «Kan ikke endre grafen i en aktiv flyt»)
- Create: `app/api/admin/crm/flows/[id]/activate/route.ts` (POST: load graph → `parseNodeConfig`+`validateFlow` → errors ⇒ 400 `{ errors }`; require ≥1 trigger OR accept activation with manual-only enrollment (no trigger requirement — dokumentér valget i koden); set status 'active')
- Create: `app/api/admin/crm/flows/[id]/triggers/route.ts` (GET/POST/DELETE; eventType must pass `isEventType` from `@/lib/events/taxonomy` → 400; filter validated as JSON object)

**Interfaces:**
- Consumes: `validateFlow`/`parseNodeConfig` (Task 3), `isEventType`, prisma, established hardening pattern (reference `app/api/admin/crm/organizations/[id]/route.ts`).
- Produces: the exact routes above; UI (Tasks 13–14) consumes them.

- [ ] **Step 1:** Implement all five files per contract with full hardening. **Step 2:** typecheck + suite green. **Step 3: Commit** `git add app/api/admin/crm/flows && git commit -m "feat(flows): flows admin API"`

---

### Task 11: Admin-API — enrollments, sender-identities, test-send

**Files:**
- Create: `app/api/admin/crm/flows/[id]/enrollments/route.ts` (GET paginated `{ enrollments, total, page, pageSize }` incl. contact {id,name}; POST `{ contactId }` → `enrollContact`, or `{ segmentId }` → `enrollSegment`, returns `{ enrolled: n }`)
- Create: `app/api/admin/crm/flows/[id]/test-send/route.ts` (POST `{ nodeId, toEmail }` — node must be email-type in this flow; render with sample MergeTagData (fornavn «Test» osv.) + unsubscribe footer med echte token for a dummy… NEI: bruk token for kontakt-id 0-sentinel? — enklere: test-send hopper over avmeldingsfooter og skriver «[testutsending]»-banner øverst; MessageSend status 'test', dedupeKey null; sendMailAs med nodens senderIdentity)
- Create: `app/api/admin/crm/sender-identities/route.ts` (GET list — with idempotent ensure-seed of the 7 spec addresses on first GET; PATCH `{ id, displayName?, active? }`)

**Interfaces:**
- Consumes: `enrollContact`/`enrollSegment` (Task 8), `sendMailAs` (Task 7), merge-tags. Seed data: registrering@bjerke.no «Bjerke Registrering», hilde.apneseth@bjerke.no «Hilde Apneseth», andre.ringelien@bjerke.no «Andre Ringelien», hege.karin.arverud@bjerke.no «Hege Karin Arverud», stine.rasmussen@bjerke.no «Stine Rasmussen», bjerke@bjerke.no «Bjerke Travbane», arild.engebretsen@bjerke.no «Arild Engebretsen» (createMany skipDuplicates on unique email).
- Produces: routes for the UI.

- [ ] **Step 1:** Implement per contract (hardening pattern). **Step 2:** typecheck + suite. **Step 3: Commit** `git add app/api/admin/crm/flows app/api/admin/crm/sender-identities && git commit -m "feat(flows): enrollments + identities API"`

---

### Task 12: Offentlig avmelding — `/avmeld`

**Files:**
- Create: `app/avmeld/page.tsx` (server component)

**Interfaces:**
- Consumes: `verifyUnsubscribeToken` (Task 6), prisma, `emitEvent`, `normalizeEmail`.
- Produces: `GET /avmeld?token=…` — verify → null ⇒ nøytral norsk feilside («Ugyldig eller utløpt lenke»). Valid: load contact; upsert `Suppression` on normalized email (verify model fields in schema — mirror the suppressions admin API), set `Consent.marketing = false` (upsert), fire-and-forget `emitEvent({ type: 'consent.updated', source: 'server', contactId, meta: { marketing: false, kilde: 'avmelding' } })`, render «Du er nå avmeldt» + norsk forklaring. Idempotent (already suppressed ⇒ same success page). NO PII beyond a generic confirmation (ikke vis e-postadressen). `export const dynamic = 'force-dynamic'`.

- [ ] **Step 1:** Implement. **Step 2:** typecheck + suite. **Step 3: Commit** `git add app/avmeld && git commit -m "feat(flows): public unsubscribe page"`

---

### Task 13: UI — flyter-liste

**Files:**
- Create: `app/admin/crm/flyter/page.tsx`
- Modify: `components/admin/CrmTabs.tsx` (tab «Flyter» mellom Hendelser og Import)
- Modify: `app/admin/AdminShell.tsx` (breadcrumb `flyter: 'Flyter'`)

**Interfaces:**
- Consumes: `GET/POST /api/admin/crm/flows`, `PATCH /api/admin/crm/flows/[id]` (pause/resume/archive), delete. Reference pattern: `app/admin/crm/kontakter/page.tsx` (ALL hardening: res.ok/Norwegian errors, try/catch/finally, AbortController, setTimeout(load,0), TableSkeleton, EmptyState m/retry, in-flight guards).
- Produces: list with columns Navn, Status-badge (Utkast grå / Aktiv grønn / Pauset amber / Arkivert grå), Aktive påmeldinger (count), Markedsføring (ja/nei), Sist endret; row actions: Åpne (→ editor), Pause/Gjenoppta (aktive/pausede), Arkiver (confirm via eksisterende ConfirmModal-komponent hvis den finnes — sjekk components/admin), Slett (kun utkast/arkivert, confirm); «Ny flyt»-knapp med navn-input → POST → naviger til editor. Norsk copy. Empty state: «Ingen flyter ennå — lag din første automatiske e-postflyt.»

- [ ] **Step 1:** Implement page + tab + breadcrumb per pattern. **Step 2:** `pnpm exec tsc --noEmit` clean; `pnpm exec eslint app/admin/crm/flyter components/admin/CrmTabs.tsx --max-warnings 0` clean; `pnpm test` green. **Step 3: Commit** `git add app/admin/crm/flyter components/admin/CrmTabs.tsx app/admin/AdminShell.tsx && git commit -m "feat(flows): flyter list page"`

---

### Task 14: UI — flyt-editor på React Flow-lerret

**Files:**
- Create: `app/admin/crm/flyter/[id]/page.tsx` (tynn wrapper: laster flyt + sender-identiteter + segmenter, rendrer editoren)
- Create: `app/admin/crm/flyter/[id]/flow-editor.tsx` (client — lerret + paneler; split i flere filer i samme mappe hvis den passerer ~400 linjer: `node-config-panel.tsx`, `trigger-panel.tsx`, `node-types.tsx`)

**Interfaces:**
- Consumes: `@xyflow/react` (`ReactFlow`, `Background`, `Controls`, `MiniMap`, `applyNodeChanges`, `applyEdgeChanges`, `addEdge`), APIs from Tasks 10–11, `EVENT_TYPES` from `@/lib/events/taxonomy` (trigger-dropdown), `validateFlow`-feilene kommer fra activate-endepunktet (client kjører IKKE egen validering — én kilde til sannhet).
- Produces (kravkontrakt — les @xyflow/react-dokumentasjonen via node_modules types):
  - Lerret med custom node-komponenter per type (seks typer, norske etiketter: Start, E-post, Vent, Betingelse, Handling, Slutt) — små kort med ikon + tittel (e-post: emnelinjen som undertekst). Betingelse-noder har TO source-handles merket «ja» (grønn) og «nei» (rød); andre én source-handle; start ingen target-handle; end ingen source-handle.
  - Palett (venstre): klikk/dra for å legge til node av hver type (nye noder får negative tempId-er client-side).
  - Config-panel (høyre, vises ved valgt node): e-post → emne-input, innholds-textarea (hint-tekst om merge-tags: {{fornavn}} osv. — les MergeTagData-feltene og list dem), avsender-dropdown (fra sender-identities API); vent → dager/timer talls-inputs; betingelse → kind-select + verdi (segment-dropdown ved in_segment, stadium-select ved stage_is, status-select ved deal_status); handling → kind-select + verdi-input; start/slutt → ingen config.
  - Lagre-knapp: serialiserer nodes/edges → `PUT /graph` (tempId-mapping fra responsen oppdaterer lerret-state); disabled når aktiv flyt (vis «Sett på pause for å redigere»).
  - Aktiver-knapp: `POST /activate`; ved 400 vises feilene i en liste OG nodene med feil får rød ring (match `nodeId` → styling). Pause/Gjenoppta i toppbaren. Status-badge.
  - Trigger-panel: liste + legg til (eventType-dropdown fra EVENT_TYPES, valgfritt filter som JSON-textarea med guard) + slett.
  - Test-send: på valgt e-post-node, knapp «Send test» → prompt/input for e-postadresse → `POST /test-send` → toast.
  - Enrollment-teller i toppbaren + lenke til en enkel påmeldingsliste-visning (kan være en enkel modal/seksjon som henter `GET /enrollments`).
  - All hardening (res.ok, AbortController på lastingen, in-flight guards på alle mutasjoner, initialLoading-splitt m/ CardSkeleton, norske feilmeldinger). `import '@xyflow/react/dist/style.css'` i editoren.

- [ ] **Step 1:** Implement (les først `node_modules/@xyflow/react/dist/esm/index.d.ts`-overflaten eller README for API-en; hold FILENE fokuserte — split som beskrevet). **Step 2:** `pnpm exec tsc --noEmit` clean; scoped eslint clean; `pnpm test` green; `pnpm build` MÅ kjøres i denne oppgaven (React Flow + CSS-import kan knekke builden — fang det her, ikke i finish). **Step 3: Commit** `git add app/admin/crm/flyter && git commit -m "feat(flows): canvas editor"`

---

### Task 15: Ferdigstilling — migrerings-SQL, verifisering, live tørrkjøring

**Files:**
- Create: `scripts/flow-engine-migration.sql`
- Modify: `.env.example` (kommentar om CRON_TARGET_URL_FLOWS på Function-appen — ingen nye web-app-vars)

**Interfaces:**
- Consumes: everything.

- [ ] **Step 1:** Migration SQL via `pnpm prisma migrate diff` fra pre-Task-1-skjemaet (forelder til «feat(flows): flow engine schema»-committen) til final — verify: KUN de 7 nye tabellene + indekser/FK-er, additivt, norsk header.
- [ ] **Step 2:** Full verification (record outputs): `pnpm exec tsc --noEmit`; `pnpm test` (report final count); `pnpm build`.
- [ ] **Step 3:** LIVE TØRRKJØRING mot dev-DB (dette er oppgavens kjerne — gjør den ærlig og rapportér all output):
  1. Seed sender-identities (kall GET sender-identities-ruta med en admin-session via en liten node-script mot prisma DIREKTE er enklere: opprett de 7 med createMany skipDuplicates).
  2. Med prisma-script: opprett en flyt «Tørrkjøring» med graf start → email (emne «Test fra flyt-motoren», body «Hei {{fornavn}}», avsender registrering@) → end; aktiver (kjør validateFlow i scriptet og bekreft null feil); opprett enrollment for en eksisterende dev-kontakt med e-post du kontrollerer? — NEI: bruk kontakt med e-post satt til en @example.com-adresse opprettet for formålet, så ingen ekte e-post går ut ved et uhell; ACS-send vil feile/soft-bounce mot example.com — det er OK: verifiser da at MessageSend-raden ble opprettet med status sent/failed og at enrollment endte som completed/failed KONSISTENT med resultatet. Alternativt: hvis ACS-nøkler ikke finnes i dev-miljøet (sjekk .env), forvent send-failure-stien og verifiser at runneren håndterte den korrekt (enrollment failed m/ failReason, batchen fullførte).
  3. Kjør `runFlowBatch()` direkte i scriptet; print resultatet; verifiser DB-tilstand (enrollment status, MessageSend-rad, dedupe: kjør batchen én gang til → ingen ny MessageSend).
  4. Rydd opp testdataene (slett flyten cascade + testkontakten) og dokumentér oppryddingen.
- [ ] **Step 4:** Smoke curls med server på 3001: `POST /api/cron/flows` uten Bearer → 401; `GET /avmeld` uten token → 200 med feiltekst; kill server.
- [ ] **Step 5: Commit** `git add scripts/flow-engine-migration.sql .env.example && git commit -m "feat(flows): prod SQL + finish"`
