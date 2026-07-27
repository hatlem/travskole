# Go-live-sjekkliste — registrering.bjerke.no

*Én avkryssbar, ordnet sekvens for å ta hele engasjementsplattformen til prod. Konsoliderer alle stegene fra `docs/deploy-runbook.md` (som har full detalj per steg) + alle ⚠️-valideringspunkter på tvers av delprosjektene. Kjøres av Basefarm/Orange i samråd med Andreas. Rekkefølgen er bindende der det står.*

**Kontekst:** prod kjører i dag en build fra FØR plattformarbeidet. Alle SQL-migreringene under er RENT ADDITIVE (kun `CREATE`/`ADD`) og trygge uten nedetid. **Kjør SQL FØR koden deployes.**

**Hva som allerede er deploy-klart uten særskilte steg** (følger med en ordinær `main`-deploy): delprosjekt 1–7 + migrerings-A/B + betalings-hardening + **booking-side checkout-UI** (ingen migrering/env). Det eneste med egen gating er **delprosjekt C** (Fase 8–10).

---

## Fase 0 — Forutsetninger (før noe annet)

- [ ] Build-miljøet har `NEXTAUTH_URL=https://registrering.bjerke.no` (IKKE localhost) — ellers bakes localhost inn i statisk `robots.txt`/`sitemap.xml`. (Dekket av SEO-fiksen, men bekreft.)
- [ ] `CRON_SECRET` er tilgjengelig (samme verdi til App Service og Function-appen).
- [ ] `NEXTAUTH_SECRET` er satt (kreves for auth + signerte checkout-/booking-tokener).
- [ ] DB-tilkobling (pooled `DATABASE_URL` + `DIRECT_URL`) bekreftet.

## Fase 1 — SQL-migreringer (Basefarm, i NØYAKTIG denne rekkefølgen)

Kjør mot prod-Postgres. Verifiser etter hver at den gikk uten feil.

- [ ] 1. `scripts/crm-migration.sql`
- [ ] 2. `scripts/event-bus-migration.sql`
- [ ] 3. `scripts/payments-migration.sql`
- [ ] 4. `scripts/flow-engine-migration.sql` — ⚠️ inneholder den partielle unike indeksen `flow_enrollments_one_active` (IKKE i schema.prisma) — MÅ med, ellers dobbel-send.
- [ ] 5. `scripts/email-tracking-migration.sql`
- [ ] 6. `scripts/ai-layer-migration.sql`
- [ ] 7. `scripts/course-flows-migration.sql` — ⚠️ inneholder TO partielle unike indekser (`flow_enrollments_one_active` reskopet WHERE registration_id IS NULL + ny `flow_enrollments_one_active_reg`) — MÅ med. + kolonner `course_id`/`registration_id` på `flow_enrollments`.
- [ ] 8. `scripts/course-lifecycle-migration.sql` — additiv `anchor_mode`-kolonne på `flows`.

## Fase 2 — Seed kurs-livssyklus-flyten (delprosjekt B)

- [ ] Kjør ÉN gang (idempotent): `npx tsx scripts/seed-course-lifecycle-flow.ts`. Oppretter «Kurs-livssyklus»-flyten som **draft**. Krever ≥1 aktiv `SenderIdentity` (finnes fra flow-engine-seeden).
- [ ] Bekreft at flyten er `draft` (IKKE aktiver ennå — det skjer i Fase 8).

## Fase 3 — Deploy koden

- [ ] Deploy `main` (siste commit) til Azure App Service. Bringer med delprosjekt 1–7 + A/B + betalings-hardening + booking-checkout-UI.
- [ ] Bekreft build kjørte i prod-miljø med korrekt `NEXTAUTH_URL` (Fase 0).

## Fase 4 — Azure-timere

- [ ] `cron-flows` (hvert 5. min): sett `CRON_TARGET_URL_FLOWS=https://registrering.bjerke.no/api/cron/flows` + `CRON_SECRET`. Verifiser: én tick → `200 {processed,sent,failed,completed,poller,suggestions}`.
- [ ] `cron-email-triggers` (daglig 07:00): bekreft at den fortsatt kjører (den kjører kurs-e-post-triggere + GDPR-pass i dagens/A+B-kode).

## Fase 5 — Stripe/Vipps webhook-secrets

- [ ] Registrer Stripe-webhook → `.../api/webhooks/stripe`; sett `STRIPE_WEBHOOK_SECRET` (+ `STRIPE_WEBHOOK_SECRET_TEST`) i Azure.
- [ ] Registrer Vipps-webhook → `.../api/webhooks/vipps`; sett `VIPPS_WEBHOOK_SECRET`.
- [ ] ⚠️ Valider Vipps webhook-secret som rå-bytes ÉN gang mot Vipps MT (testmiljø) før go-live.
- [ ] ⚠️ Valider Vipps REFUNDED-payload mot en ekte MT-refusjon (delprosjekt 7): bekreft `transactionInfo.refundedAmount`/`.amount` finnes + at `body.amount.value` er refundert beløp; ved avvik juster `mapVippsEvent`.
- [ ] Vipps betalings-env-vars (CLIENT_ID/SECRET/… + `_TEST`) er ALLEREDE provisjonert av Basefarm — ikke rør.

## Fase 6 — Valgfritt (config-gated, ikke-blokkerende)

- [ ] Microsoft Graph (svar-stopp/bounce): send `docs/bestilling-graph-tilgang.md` til Patryk; sett `GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET/MAILBOXES`. Uten disse er polling no-op (trygt).
- [ ] KI-lag: sett `AI_PROVIDER` + nøkler KUN etter inngått databehandleravtale med LLM-leverandøren. Uten nøkler er alt KI usynlig/no-op.
- [ ] getcookies: ingen handling — lastes via bjerke.no GTM.

## Fase 7 — Post-deploy røyktest (mot prod)

- [ ] Offentlige sider 200; `robots.txt`/`sitemap.xml` viser `registrering.bjerke.no` (ikke localhost).
- [ ] getcookies-samtykkebanner rendrer; GA4-beacon 204 etter samtykke (0 CSP-feil).
- [ ] Reell påmelding → bekreftelses-e-post med ekte lenker.
- [ ] Passord-reset + magic-link → lenker peker på prod-domenet.
- [ ] Admin-innlogging + CRM-sider laster (kontakter/pipeline/flyter/innsikt).
- [ ] `/api/t/o/*` + `/api/t/c/*` svarer (pixel 200 gif, klikk 302).
- [ ] `/api/cron/flows` med riktig secret → 200 med `poller`+`suggestions`.
- [ ] **Booking:** bekreft en booking-forespørsel i admin → kunden får godkjenning-e-post (online-kurs: med «Betal her»-lenke); lenken → `/betaling/booking` viser oppsummering + betal-knapp; innlogget `/mine-bookinger` viser egne bookinger.

---

## Fase 8 — ⚠️ GATE: aktiver livssyklus-flyten + bevis paritet

- [ ] Aktiver «Kurs-livssyklus»-flyten i admin (`/admin/crm/flyter`). Fra nå eier flyten NYE påmeldinger; legacy-cronen hopper automatisk over flyt-eide registreringer (per-registrering XOR, null dobbel-send).
- [ ] **Bevis paritet:** følg nye påmeldinger gjennom flyten (sporing/`MessageSend`/tidslinje) og bekreft at riktige dato-baserte e-poster sendes. Legacy fullfører påmeldinger fra før aktivering.
- [ ] IKKE gå videre til Fase 9 før paritet er bekreftet.

## Fase 9 — ⚠️ GATED: deploy delprosjekt C (legacy-fjerning)

Utføres KUN etter Fase 8. Fjerner `EmailTrigger`/`EmailTemplate`/`EmailLog` + admin-API/UI + dato-baserte cron-sending; `registration_confirmed` blir hardkodet.

- [ ] Merge grenen **`retire-legacy-emailtrigger`** → `main`, deploy.
- [ ] ⚠️ Cron-ruta er omdøpt `/api/cron/email-triggers` → `/api/cron/gdpr-retention`. **HVIS `CRON_TARGET_URL` er satt på Function-appen, oppdater den til den nye URL-en** (ellers 404 → GDPR-cronen stopper). Er den ikke satt, brukes ny in-repo-standard automatisk.
- [ ] Verifiser: `/api/cron/gdpr-retention` med secret → 200 `{ anonymized }`; en reell påmelding gir fortsatt bekreftelse (hardkodet).

## Fase 10 — ⚠️ ALLER SIST: irreversibel opprydding

- [ ] Kjør `scripts/course-legacy-drop.sql` (`DROP TABLE email_logs/email_triggers/email_templates`) — SEPARAT fra kode-deployen, KUN når livssyklus-flyten er stabil, paritet bevist, OG e-posthistorikken (`email_logs`) er arkivert/ikke lenger nødvendig. **Kan aldri angres.**

---

*Full detalj per steg: `docs/deploy-runbook.md`. Denne sjekklisten er sammendraget + rekkefølgen.*
