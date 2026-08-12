# Go-live-sjekkliste — registrering.bjerke.no

*Én avkryssbar, ordnet sekvens for å ta hele engasjementsplattformen til prod. Konsoliderer alle stegene fra `docs/deploy-runbook.md` (som har full detalj per steg) + alle ⚠️-valideringspunkter på tvers av delprosjektene. Rekkefølgen er bindende der det står.*

**Kontekst:** prod kjører i dag en build fra FØR plattformarbeidet. Alle SQL-migreringene under er RENT ADDITIVE (kun `CREATE`/`ADD`) og trygge uten nedetid.

**Ansvarsfordeling** (avklart med Basefarm 2026-08-11, se `docs/basefarm-deploy-epost.md`): Andreas gjør kode-deploy (FTPS zipdeploy, `scripts/deploy-app.sh`/`scripts/deploy-func.sh`) og SQL-migreringer selv (repoet er ikke delt med Basefarm, og prod-DB-en er brannmurslåst mot ekstern SQL-tilgang — migreringene kjøres derfor fra app-en selv via `/api/admin/deploy-migration`, ikke via psql utenfra). Basefarm/Orange håndterer kun Azure-konfigurasjon: env vars/secrets, webhook-registrering av secrets, Function-app-innstillinger.

**Rekkefølge snudd i forhold til en tradisjonell runbook:** koden deployes FØR SQL-en kjøres, fordi migreringsruta selv er en del av det som deployes. Trygt siden plattformen ikke har reell trafikk ennå.

**Ingen gating:** plattformen har ingen reelle brukere ennå, så det er ingen prod-avhengighet å bevise paritet mot over tid. Fase 7–9 (aktiver livssyklus-flyten + fjern legacy-e-post + irreversibel opprydding) kjøres derfor rett etter røyktesten, i samme utrulling — ikke som et separat, senere steg.

---

## Fase 0 — Forutsetninger (før noe annet)

- [ ] Build-miljøet har `NEXTAUTH_URL=https://registrering.bjerke.no` (IKKE localhost) — ellers bakes localhost inn i statisk `robots.txt`/`sitemap.xml`. (Dekket av SEO-fiksen, men bekreft.)
- [ ] `CRON_SECRET` er tilgjengelig (samme verdi til App Service og Function-appen) — **bekreftet ✅ av Basefarm**.
- [ ] `NEXTAUTH_SECRET` er satt (kreves for auth + signerte checkout-/booking-tokener) — **bekreftet ✅ av Basefarm**.
- [ ] `SEED_SECRET` er satt på App Service (kreves av Fase 2's migreringsrute).
- [ ] DB-tilkobling (`DATABASE_URL`) bekreftet — appen kobler til Postgres internt i Azure, ingen ekstern tilgang nødvendig.

## Fase 1 — Deploy koden (Andreas, selvbetjent)

- [ ] `./scripts/deploy-app.sh` — FTPS zipdeploy til `dnt-travskole-app`. Bringer med delprosjekt 1–7 + A/B + betalings-hardening + booking-checkout-UI + `/api/admin/deploy-migration`.
- [ ] Bekreft build kjørte i prod-miljø med korrekt `NEXTAUTH_URL` (Fase 0).

## Fase 2 — SQL-migreringer + seed (Andreas, selvbetjent, via app-en)

- [ ] `POST /api/admin/deploy-migration` med `{ "secret": "<SEED_SECRET>" }`. Kjører, i rekkefølge, alle 159 statements generert fra:
  1. `scripts/crm-migration.sql`
  2. `scripts/event-bus-migration.sql`
  3. `scripts/payments-migration.sql`
  4. `scripts/flow-engine-migration.sql` — ⚠️ inneholder den partielle unike indeksen `flow_enrollments_one_active` (IKKE i schema.prisma) — MÅ med, ellers dobbel-send.
  5. `scripts/email-tracking-migration.sql`
  6. `scripts/ai-layer-migration.sql`
  7. `scripts/course-flows-migration.sql` — ⚠️ inneholder TO partielle unike indekser (`flow_enrollments_one_active` reskopet WHERE registration_id IS NULL + ny `flow_enrollments_one_active_reg`) — MÅ med. + kolonner `course_id`/`registration_id` på `flow_enrollments`.
  8. `scripts/course-lifecycle-migration.sql` — additiv `anchor_mode`-kolonne på `flows`.
- [ ] Samme kall kjører deretter `seedCourseLifecycleFlow()` — oppretter «Kurs-livssyklus»-flyten som **draft**. Krever ≥1 aktiv `SenderIdentity` (finnes fra flow-engine-seeden).
- [ ] Bekreft responsen: `applied` viser alle 8 migreringer + `seed.flowId`. Bekreft at flyten er `draft` i admin (IKKE aktiver ennå — det skjer i Fase 7).

## Fase 3 — Azure-timere

- [ ] `./scripts/deploy-func.sh` (Andreas, selvbetjent) — deployer `cron-flows` (hvert 5. min) til `dnt-travskole-func`, ved siden av eksisterende `cron-email-triggers`.
- [ ] Basefarm setter `CRON_TARGET_URL_FLOWS=https://registrering.bjerke.no/api/cron/flows` + `CRON_SECRET` på Function-appen.
- [ ] Verifiser: én tick → `200 {processed,sent,failed,completed,poller,suggestions}`.
- [ ] `cron-email-triggers` (daglig 07:00): bekreft at den fortsatt kjører (den kjører kurs-e-post-triggere + GDPR-pass i dagens/A+B-kode).

## Fase 4 — Stripe/Vipps webhook-secrets

- [ ] Andreas registrerer Stripe-webhook → `.../api/webhooks/stripe` i Stripe-dashboardet.
- [ ] Andreas registrerer Vipps-webhook → `.../api/webhooks/vipps`.
- [ ] Basefarm setter `STRIPE_WEBHOOK_SECRET` (+ `STRIPE_WEBHOOK_SECRET_TEST`) og `VIPPS_WEBHOOK_SECRET` i Azure (verdiene sendes via sikker lenke).
- [ ] ⚠️ Valider Vipps webhook-secret som rå-bytes ÉN gang mot Vipps MT (testmiljø) før go-live.
- [ ] ⚠️ Valider Vipps REFUNDED-payload mot en ekte MT-refusjon (delprosjekt 7): bekreft `transactionInfo.refundedAmount`/`.amount` finnes + at `body.amount.value` er refundert beløp; ved avvik juster `mapVippsEvent`.
- [ ] Vipps betalings-env-vars (CLIENT_ID/SECRET/… + `_TEST`) er ALLEREDE provisjonert av Basefarm — ikke rør.

## Fase 5 — Valgfritt (config-gated, ikke-blokkerende)

- [ ] Microsoft Graph (svar-stopp/bounce): send `docs/bestilling-graph-tilgang.md` til Patryk; Basefarm setter `GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET/MAILBOXES`. Uten disse er polling no-op (trygt).
- [ ] KI-lag: sett `AI_PROVIDER` + nøkler KUN etter inngått databehandleravtale med LLM-leverandøren. Uten nøkler er alt KI usynlig/no-op.
- [ ] getcookies: ingen handling — lastes via bjerke.no GTM.

## Fase 6 — Post-deploy røyktest (mot prod)

- [ ] Offentlige sider 200; `robots.txt`/`sitemap.xml` viser `registrering.bjerke.no` (ikke localhost).
- [ ] getcookies-samtykkebanner rendrer; GA4-beacon 204 etter samtykke (0 CSP-feil).
- [ ] Reell påmelding → bekreftelses-e-post med ekte lenker.
- [ ] Passord-reset + magic-link → lenker peker på prod-domenet.
- [ ] Admin-innlogging + CRM-sider laster (kontakter/pipeline/flyter/innsikt).
- [ ] `/api/t/o/*` + `/api/t/c/*` svarer (pixel 200 gif, klikk 302).
- [ ] `/api/cron/flows` med riktig secret → 200 med `poller`+`suggestions`.
- [ ] **Booking:** bekreft en booking-forespørsel i admin → kunden får godkjenning-e-post (online-kurs: med «Betal her»-lenke); lenken → `/betaling/booking` viser oppsummering + betal-knapp; innlogget `/mine-bookinger` viser egne bookinger.

---

## Fase 7 — Aktiver livssyklus-flyten

- [ ] Aktiver «Kurs-livssyklus»-flyten i admin (`/admin/crm/flyter`). Fra nå eier flyten NYE påmeldinger; legacy-cronen hopper automatisk over flyt-eide registreringer (per-registrering XOR, null dobbel-send). Legacy fullfører påmeldinger fra før aktivering.
- [ ] Gå rett videre til Fase 8 — ingen ventetid, ingen brukere avhenger av legacy-systemet ennå.

## Fase 8 — Deploy delprosjekt C (legacy-fjerning), samme økt

Fjerner `EmailTrigger`/`EmailTemplate`/`EmailLog` + admin-API/UI + dato-baserte cron-sending; `registration_confirmed` blir hardkodet.

- [ ] Merge grenen **`retire-legacy-emailtrigger`** → `main`, deploy (`./scripts/deploy-app.sh` på nytt).
- [ ] ⚠️ Cron-ruta er omdøpt `/api/cron/email-triggers` → `/api/cron/gdpr-retention`. **HVIS `CRON_TARGET_URL` er satt på Function-appen, oppdater den til den nye URL-en** (ellers 404 → GDPR-cronen stopper). Er den ikke satt, brukes ny in-repo-standard automatisk.
- [ ] Verifiser: `/api/cron/gdpr-retention` med secret → 200 `{ anonymized }`; en reell påmelding gir fortsatt bekreftelse (hardkodet).

## Fase 9 — Irreversibel opprydding, samme økt

- [ ] Kjør `scripts/course-legacy-drop.sql` (`DROP TABLE email_logs/email_triggers/email_templates`) som eget, bevisst steg rett etter Fase 8. Ingen reell e-posthistorikk å arkivere (ikke live ennå). **Kan aldri angres.**

---

*Full detalj per steg: `docs/deploy-runbook.md`. Denne sjekklisten er sammendraget + rekkefølgen.*
