# E-postsporing — Design Spec (delprosjekt 4)

*Subproject 4 of the Engagement Platform. Builds on delprosjekt 3's flow engine (SenderIdentity/MessageSend shipped there). Basefarm status (e-posttråd 3. juli 2026): alle 7 avsenderadresser verifisert i ACS med Reply-To; Stripe/Vipps-nøkler (live + test-sett) ligger i Azure; `STRIPE_WEBHOOK_SECRET`-runden gjenstår (webhook-endepunktene finnes nå); programmatisk postboks-tilgang for svar/bounce-lesing bestilles som én Entra app-registrering med Microsoft Graph `Mail.Read` (application access policy scopet til de aktuelle postboksene) — klassisk IMAP-basic-auth er avviklet i Exchange Online.*

## Overview

Open/click tracking for flow emails, reply-stop, and bounce handling. Opens and clicks land as `email.opened`/`email.clicked` events on the bus (visible in the CRM timeline and Hendelser), replies stop the contact's active enrollment in that flow (`email.replied`), and hard bounces auto-suppress (`email.bounced`). The mailbox poller runs against Microsoft Graph and is config-gated — fully built and TDD'd now, activates when the Graph credentials land. Tracking is consent-coupled: links/pixel are only injected for marketing sends to consented contacts (same gate as the send itself).

**Also in scope (integration correctness from the Basefarm thread):** `lib/payments/vipps.ts` must select the `_TEST`-suffixed env set (`VIPPS_CLIENT_ID_TEST` etc.) when payment test mode is on, mirroring Stripe's key selection — Patryk provisioned dual sets per our own request; the current single-set + `VIPPS_TEST_MODE` reading doesn't match production.

**Non-goals:** analytics dashboards (subproject 6), AI (5), web-visitor tracking (shipped in 2a).

## Datamodell (additivt)

`MessageSend` gains:
```prisma
  trackingToken  String?   @unique @map("tracking_token")   // 24 hex, random — genereres kun for sporede sends
  messageId      String?   @map("message_id")               // SMTP Message-ID fra transporten — nøkkel for svar-matching
  openedAt       DateTime? @map("opened_at")
  firstClickedAt DateTime? @map("first_clicked_at")
  clickCount     Int       @default(0) @map("click_count")
  repliedAt      DateTime? @map("replied_at")
  bouncedAt      DateTime? @map("bounced_at")
```
Plus `@@index([messageId])`. New model:
```prisma
model MessageLink {
  id            Int         @id @default(autoincrement())
  messageSendId Int         @map("message_send_id")
  messageSend   MessageSend @relation(fields: [messageSendId], references: [id], onDelete: Cascade)
  idx           Int
  url           String
  createdAt     DateTime    @default(now()) @map("created_at")
  @@unique([messageSendId, idx])
  @@map("message_links")
}
```

## Sporing (pixel + klikk)

- **Ren omskriving (`lib/tracking/rewrite.ts`, TDD):** `rewriteHtmlForTracking(html, baseUrl, token): { html, links: string[] }` — every `href="http(s)://…"` in the body is replaced with `{baseUrl}/api/t/c/{token}/{idx}`; the original URLs are returned ordered (persisted as `MessageLink` rows). Skips `mailto:`, anchors, and the unsubscribe link (`/avmeld` and `/api/avmeld` URLs are never rewritten). Pixel `<img src="{baseUrl}/api/t/o/{token}" width="1" height="1" alt="" style="display:none">` injected before `</body>`.
- **Endpoints (public, no session):**
  - `GET /api/t/o/[token]` → always 200 with a 1×1 transparent GIF (constant bytes, `Cache-Control: no-store`); on token match: set `openedAt` if null + emit `email.opened` (dedupeKey `open:{messageSendId}` — one timeline event per message; repeat opens bump nothing). Unknown token → same GIF (no oracle).
  - `GET /api/t/c/[token]/[idx]` → look up `MessageLink` by (messageSend, idx) → 302 to the stored URL; set `firstClickedAt` if null, increment `clickCount`, emit `email.clicked` (dedupeKey `click:{messageSendId}:{idx}` — one event per link) with `meta.url`. Unknown token/idx → 302 to forsiden (never an open redirect — only stored URLs).
- **Send-integration (`lib/flows/send.ts`):** for marketing-consented sends: generate `trackingToken` (crypto 12 bytes hex), rewrite links + inject pixel AFTER the unsubscribe footer is added (footer link exempt), persist MessageLink rows, capture the transport's `messageId` from nodemailer's send result and store it. Non-marketing (transactional) flow sends: no pixel/rewrite (privacy posture), but `messageId` is still stored (reply-stop applies to all flow email).

## Svar-stopp & bounce (Graph-poller, config-gated)

- **Env:** `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_MAILBOXES` (kommaseparert liste over postbokser polleren leser — de aktive avsenderidentitetene). `isGraphConfigured()` gates everything.
- **Ren logikk (`lib/tracking/reply-match.ts`, TDD):** `classifyInboundMessage(msg: { inReplyTo: string | null; references: string[]; from: string | null; subject: string; isDsn: boolean; dsnStatus?: string }, knownMessageIds: Set<string>): { kind: 'reply'; matchedMessageId: string } | { kind: 'bounce'; hard: boolean; failedRecipient?: string } | { kind: 'ignore' }` — reply when In-Reply-To/References intersects known ids; DSN detection via content-type `multipart/report; report-type=delivery-status` + status `5.x.x` (hard) / `4.x.x` (soft); everything else ignored. TDD with real header fixtures.
- **Poller (`lib/tracking/poller.ts`):** per mailbox in `GRAPH_MAILBOXES`: client-credentials token → Graph `GET /users/{mailbox}/messages?$filter=receivedDateTime gt {cursor}&$select=internetMessageHeaders,...` (delta/cursor persisted in a `Setting`-row per mailbox); classify each; on reply: set `repliedAt`, emit `email.replied`, and EXIT the contact's active enrollment in that flow (status 'exited', reason 'svar'); on hard bounce: set `bouncedAt`, emit `email.bounced`, upsert Suppression on the failed recipient. Fire-safe per message; runs as a step in the existing `/api/cron/flows` tick (after `runFlowBatch`), no-op when unconfigured.
- **Bestilling til Patryk** (leveres som tekstfil i docs/, sendes av Andreas): Entra app-registrering med application permission `Mail.Read`, admin-consent, ApplicationAccessPolicy som scoper til de 7 avsenderpostboksene, og tenant/client-id + secret levert via vanlig hemmelig kanal.

## Flyt-betingelse «åpnet e-post»

- `condition`-kind `opened_email` (norsk etikett «Åpnet forrige e-post»): evaluates whether the most recent email-node `MessageSend` in THIS enrollment has `openedAt != null`. `StepContext` gains `lastSendOpened: boolean | null` (null = no prior send → nei-gren). graph.ts validator accepts the new kind (no value required); step.ts evaluates; editor's condition-select gains the option. Typical use: E-post 1 → Vent 3 dager → Betingelse «Åpnet forrige e-post» → ja: slutt / nei: påminnelse.

## Taksonomi & synlighet

- New bus types `email.opened`, `email.clicked`, `email.replied`, `email.bounced` (source 'server'); timeline titles («Åpnet e-post», «Klikket lenke i e-post», «Svarte på e-post», «E-post kom i retur») — opened/clicked are timeline-worthy here (low volume per contact thanks to dedupeKeys). Hendelser-fanen picks them up automatically via EVENT_TYPES.

## Vipps env-fix (del av dette delprosjektet)

`lib/payments/vipps.ts`: all env reads become mode-aware — `vippsEnv(testMode)` returning the `_TEST`-suffixed set when test mode; `isVippsConfigured(testMode)`; `createVippsPayment` gains a `testMode` param threaded from the checkout route (which already computes it for Stripe). `VIPPS_TEST_MODE` (base-URL switch) erstattes av samme testMode-parameter (apitest.vipps.no ⇔ testMode). `.env.example` oppdateres til å speile Azure-navnene inkl. `VIPPS_SUBSCRIPTION_KEY_SECONDARY(_TEST)` (dokumentert, ubrukt i kode — reserve).

## GDPR

Pixel/klikk kun i markedsførings-sends til samtykkede kontakter (dokumenteres i personvernerklæringen — redaksjonell endring dere gjør); svar-stopp/bounce er berettiget interesse (leveranse-drift). Sporingstoken er tilfeldig og ugjettbar; klikk-redirect kan aldri sende til ulagrede URL-er. Graph-polleren leser kun headere + DSN-status (ikke meldingsinnhold utover klassifisering).

## Testing

TDD: rewrite (lenker/skip-regler/pixel-plassering), reply-match (fixtures for ekte Reply/References/DSN-headere), vipps env-valg. Tynne lag (endpoints, poller, apply) via typecheck + suite; finish-task: live pixel/klikk-verifisering mot dev-server (curl token → GIF, klikk → 302 + DB-oppdatering) + browser-sjekk av opened_email i editoren.

## Migrering & utrulling

Additiv SQL (`scripts/email-tracking-migration.sql`). Nye env-vars kun for Graph (kommer når Patryk leverer). Deploy-avhengigheter for hele plattformen samlet: 4 SQL-scripts, env-nøkler (er i Azure), STRIPE_WEBHOOK_SECRET-runden, cron-flows-timer, Graph-bestillingen.
