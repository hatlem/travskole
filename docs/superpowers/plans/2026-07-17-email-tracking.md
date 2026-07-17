# Email Tracking (4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship subproject 4 — open/click tracking on flow emails, reply-stop and bounce suppression via a config-gated Graph poller, the `opened_email` flow condition, and the Vipps dual-env-set integration fix.

**Architecture:** Additive MessageSend columns + MessageLink table. Pure TDD'd modules: HTML rewrite/pixel injection, inbound-message classification, mode-aware Vipps env resolution. Thin layers: tracking endpoints (GIF/302), a Graph poller hooked into the existing cron tick, send-layer integration capturing messageId + injecting tracking. New bus types with timeline titles. Editor gains the opened_email condition.

**Tech Stack:** as before + Microsoft Graph REST (plain fetch, client credentials; no SDK).

**Spec:** `docs/superpowers/specs/2026-07-17-email-tracking-design.md`

## Global Constraints

- pnpm, never npm. Dev server never port 3000 (3001).
- Prisma conventions; additive schema; `pnpm prisma db push`; production SQL in the final task.
- Tracking is consent-coupled: pixel/rewrite ONLY for `isMarketing` sends (which already require marketing consent); `messageId` stored for ALL flow sends (reply-stop is legitimate interest).
- Click redirect NEVER redirects to a URL from the request — only stored `MessageLink.url`. Unsubscribe links are never rewritten. Unknown tracking tokens are not an oracle (same GIF / forsiden-302).
- Poller is fire-safe per message and a no-op without `GRAPH_*` env. Reply → exit enrollment (reason 'svar'); hard bounce (5.x.x) → Suppression upsert; soft bounce → event only.
- Bus taxonomy additions: `email.opened`, `email.clicked`, `email.replied`, `email.bounced` with Norwegian timeline titles; dedupeKeys `open:{messageSendId}`, `click:{messageSendId}:{idx}`, `reply:{messageSendId}`, `bounce:{messageSendId}`.
- Vipps env selection must mirror Stripe's testMode pattern and the Azure-provisioned names (`VIPPS_*` + `VIPPS_*_TEST`).
- Tests: Vitest `tests/*.test.ts`; TDD for pure modules. Suite baseline: 322 passing.
- Hardening/copy/commit conventions as established. Footer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Vipps dual-env-set fix

**Files:**
- Modify: `lib/payments/vipps.ts`, `app/api/payments/checkout/route.ts`, `.env.example`
- Test: `tests/payments-vipps-env.test.ts` (new, TDD for the pure resolver)

**Interfaces:**
- Produces: `vippsEnv(testMode: boolean): { clientId?: string; clientSecret?: string; subscriptionKey?: string; msn?: string }` (pure, reads process.env with `_TEST` suffix when testMode; export for tests with injectable env object: `vippsEnvFrom(env: Record<string, string | undefined>, testMode)`), `isVippsConfigured(testMode: boolean)`, `vippsBaseUrl(testMode: boolean)` (apitest ⇔ testMode — `VIPPS_TEST_MODE` env removed), `createVippsPayment(input & { testMode: boolean })`. Checkout route threads its existing `testMode` into both `isVippsConfigured` and `createVippsPayment`. `.env.example`: dual sets documented incl. `VIPPS_SUBSCRIPTION_KEY_SECONDARY(_TEST)` (documented, unused), `VIPPS_TEST_MODE` removed.
- TDD `vippsEnvFrom`: test-set selection, live-set selection, partial-set → isVippsConfigured false.

- [ ] Steps: RED tests → implement → thread testMode through checkout → `pnpm exec tsc --noEmit` + full suite (322 + ~4) → commit `fix(pay): mode-aware vipps env sets`.

---

### Task 2: Schema — tracking fields + MessageLink

**Files:** Modify `prisma/schema.prisma`.

**Interfaces:** Spec's Prisma additions verbatim: 7 new MessageSend columns + `@@index([messageId])` + back-relation `links MessageLink[]`; new `MessageLink` model. Additive only.

- [ ] Steps: edit → `pnpm prisma validate && pnpm prisma db push && pnpm prisma generate` → suite green → commit `feat(track): tracking schema`.

---

### Task 3: `lib/tracking/rewrite.ts` (TDD)

**Files:** Create `lib/tracking/rewrite.ts`; Test `tests/tracking-rewrite.test.ts`.

**Interfaces:**
- `rewriteHtmlForTracking(html: string, baseUrl: string, token: string): { html: string; links: string[] }` — replaces every `href="http(s)://…"` with `{baseUrl}/api/t/c/{token}/{idx}` (idx = position in returned `links`); skips `mailto:`, `#`-anchors, and any URL containing `/avmeld` or `/api/avmeld`; duplicate URLs get separate idx entries (per-occurrence). `injectPixel(html: string, baseUrl: string, token: string): string` — `<img src="{baseUrl}/api/t/o/{token}" width="1" height="1" alt="" style="display:none">` inserted before `</body>` (append at end if no `</body>`).
- TDD: multi-link rewrite with correct idx order; mailto/anchor/avmeld skipped; duplicate URLs; single-quote hrefs handled or explicitly normalized (state behavior); pixel before `</body>`; no-body fallback; html without links unchanged (links: []).

- [ ] Steps: RED → implement (regex-based, no DOM dep) → GREEN + suite → commit `feat(track): html rewrite + pixel`.

---

### Task 4: `lib/tracking/reply-match.ts` (TDD)

**Files:** Create `lib/tracking/reply-match.ts`; Test `tests/tracking-reply-match.test.ts`.

**Interfaces:**
- `classifyInboundMessage(msg: InboundLike, knownMessageIds: Set<string>): Classification` exactly per spec (reply via In-Reply-To OR References intersection, normalized angle-brackets/whitespace; bounce via `isDsn` + status `5.x.x` hard / `4.x.x` soft with `failedRecipient`; else ignore). Also `extractMessageIds(headerValue: string | null): string[]` (parses `<id1> <id2>` lists).
- TDD with realistic fixtures: Gmail reply (In-Reply-To match), Outlook reply (References-only match), unrelated inbound → ignore, hard DSN 5.1.1 with recipient, soft DSN 4.4.1, DSN without recipient, angle-bracket/case normalization.

- [ ] Steps: RED → implement pure → GREEN + suite → commit `feat(track): inbound classification`.

---

### Task 5: Taxonomy + StepContext extension

**Files:** Modify `lib/events/taxonomy.ts`, `lib/flows/graph.ts` (condition kind), `lib/flows/step.ts` (+ their tests).

**Interfaces:**
- Taxonomy: add the four `email.*` types to `SERVER_EVENT_TYPES`; `timelineTitle` cases («Åpnet e-post», «Klikket lenke i e-post» + meta.url hint if string, «Svarte på e-post», «E-post kom i retur»). Update taxonomy tests (honest additions).
- graph.ts: `condition_config` accepts kind `opened_email` (no value required — adjust validator + add test).
- step.ts: `StepContext` gains `lastSendOpened: boolean | null`; `opened_email` evaluates `ctx.lastSendOpened === true` (null/false → nei). Tests for all three states.

- [ ] Steps: RED (new cases) → implement → GREEN + suite → commit `feat(track): email event types + opened condition`.

---

### Task 6: Apply-layer — `lib/tracking/apply.ts`

**Files:** Create `lib/tracking/apply.ts`.

**Interfaces (thin DB, no unit tests):**
- `recordOpen(token: string): Promise<boolean>` — find MessageSend by trackingToken; false if none; set openedAt if null; emit `email.opened` (dedupeKey per constraints, contactId from the row).
- `recordClick(token: string, idx: number): Promise<string | null>` — resolve MessageLink via the send's id+idx; null if missing; update firstClickedAt-if-null + increment clickCount; emit `email.clicked` with meta `{ url }`; return the stored URL.
- `recordReply(matchedMessageId: string): Promise<void>` — find send by messageId; set repliedAt-if-null; emit `email.replied`; if the send has an enrollmentId whose enrollment is active → status 'exited', failReason null, finishedAt now (reason field: reuse failReason? NO — add nothing; set status 'exited' and log reason via ContactActivity? Keep simple: status 'exited'; the email.replied timeline entry tells the story).
- `recordBounce(matchedMessageId: string | null, failedRecipient: string | null, hard: boolean): Promise<void>` — prefer messageId match; else (DSN without ids) match latest send to failedRecipient within 7 days; set bouncedAt; emit `email.bounced` (meta.hard); hard → Suppression upsert on normalized failedRecipient/toEmail.
- All fire-safe internally where reachable from the poller; open/click called from routes (throwing is fine — routes guard).

- [ ] Steps: implement → tsc + suite → commit `feat(track): tracking apply layer`.

---

### Task 7: Tracking endpoints

**Files:** Create `app/api/t/o/[token]/route.ts`, `app/api/t/c/[token]/[idx]/route.ts`.

**Interfaces:**
- GIF endpoint: constant 43-byte transparent GIF (base64 inline), `Content-Type: image/gif`, `Cache-Control: no-store, no-cache`; calls recordOpen fire-and-forget (`.catch`), ALWAYS returns the GIF (unknown token identical response). Token param format-guard (hex, length) before DB.
- Click endpoint: params token + idx (integer guard); `recordClick` → URL ⇒ `NextResponse.redirect(url, 302)`; null ⇒ redirect to `getBaseUrl()` forsiden. Never a URL from the request.

- [ ] Steps: implement → tsc + suite → commit `feat(track): pixel + click endpoints`.

---

### Task 8: Send-layer integration

**Files:** Modify `lib/flows/send.ts` (+ `lib/mail.ts` if sendMailAs must return the transport messageId — check nodemailer's `info.messageId` and thread it back).

**Interfaces:**
- `sendMailAs` returns `{ messageId: string | null }` (from nodemailer info; null when transporter unconfigured). Existing callers updated (ignore return where irrelevant).
- `sendFlowEmail`: AFTER footer append, when `isMarketing` (the consented path): generate token (`crypto.randomBytes(12).toString('hex')`), `rewriteHtmlForTracking` + `injectPixel`, create the MessageSend WITH trackingToken, then create MessageLink rows (createMany) BEFORE the network send; store `messageId` on the row after the send resolves (update). Transactional sends: no rewrite/pixel/token, but messageId still stored. SMTP-failure path (delete+audit recreate) must ALSO delete the MessageLink rows (cascade handles it — verify onDelete Cascade covers it) and the audit row carries no token.
- Test-send route: unchanged (no tracking on tests) — verify it doesn't accidentally gain a token.

- [ ] Steps: implement → tsc + suite → commit `feat(track): tracked flow sends`.

---

### Task 9: Graph-poller (config-gated) + cron hook

**Files:** Create `lib/tracking/poller.ts`; Modify `app/api/cron/flows/route.ts` (run poller after runFlowBatch, include counts in response).

**Interfaces:**
- `isGraphConfigured(): boolean` (GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET + GRAPH_MAILBOXES all present).
- `pollMailboxes(): Promise<{ replies: number; bounces: number; scanned: number }>` — no-op zeros when unconfigured. Per mailbox: token via client-credentials (`https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`, scope `https://graph.microsoft.com/.default`); cursor per mailbox stored via the repo's Setting mechanism (`getSetting`/`setSetting` — read lib/settings.ts for the write helper; key `graph_cursor_{mailbox}`); fetch messages after cursor (`$select` med internetMessageHeaders + receivedDateTime + from + subject; `$top=50`); map Graph payload → InboundLike (headers: In-Reply-To/References/Content-Type for DSN detection — Graph exposes internetMessageHeaders array); `classifyInboundMessage` against the known-id set (query MessageSend messageIds seen last 30 days, build Set once per run); apply via recordReply/recordBounce; advance cursor to max receivedDateTime. Everything fire-safe (one bad message logged + skipped; one failing mailbox doesn't stop the rest).
- Cron route: response becomes `{ processed, sent, failed, completed, poller: { replies, bounces, scanned } }`.

- [ ] Steps: implement → tsc + suite → commit `feat(track): graph reply/bounce poller`.

---

### Task 10: Runner + editor wiring

**Files:** Modify `lib/flows/runner.ts` (supply `lastSendOpened` in StepContext: query the enrollment's most recent MessageSend with a dedupeKey (real sends) and read openedAt), editor condition-select (`app/admin/crm/flyter/[id]/node-config-panel.tsx` — add «Åpnet forrige e-post» option for kind opened_email, no value input).

- [ ] Steps: implement → tsc + scoped eslint + suite → `pnpm build` → commit `feat(track): opened-condition wiring`.

---

### Task 11: Finish — migration SQL, Patryk-bestilling, verification, live smoke

**Files:** Create `scripts/email-tracking-migration.sql`, `docs/bestilling-graph-tilgang.md`; Modify `.env.example` (GRAPH_* block).

- [ ] Migration SQL via prisma migrate diff from pre-Task-2 schema (parent of `feat(track): tracking schema`-committen) — verify additive (MessageSend ALTERs + message_links + indexes).
- [ ] `docs/bestilling-graph-tilgang.md`: kort norsk bestillingstekst til Patryk — Entra app-registrering, application permission `Mail.Read`, admin consent, `New-ApplicationAccessPolicy` scopet til de 7 avsenderpostboksene (list dem), levering av GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET via hemmelig kanal, og at appen setter `GRAPH_MAILBOXES` selv. PLUSS en påminnelses-seksjon om STRIPE_WEBHOOK_SECRET-runden (webhook-URL-ene /api/webhooks/stripe + /api/webhooks/vipps er klare).
- [ ] Full verification: tsc, suite (report count), build.
- [ ] LIVE smoke mot dev-server 3001 + dev-DB: opprett en MessageSend-rad med trackingToken + én MessageLink via prisma-script; `curl /api/t/o/{token}` → GIF-bytes + openedAt satt + email.opened-event finnes; `curl -I /api/t/c/{token}/0` → 302 Location = lagret URL + clickCount 1; ukjent token → GIF/forside-302; rydd opp raden. Kjør cron-ruta uten Graph-env → poller-counts {0,0,0}. Kill server.
- [ ] Commit `feat(track): prod SQL + finish`.
