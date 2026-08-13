# Go-live-sjekkliste — registrering.bjerke.no

*Én avkryssbar, ordnet sekvens for å ta hele engasjementsplattformen til prod. Konsoliderer alle stegene fra `docs/deploy-runbook.md` (som har full detalj per steg) + alle ⚠️-valideringspunkter på tvers av delprosjektene. Rekkefølgen er bindende der det står.*

**Status 2026-08-13: Fase 0–3 og 7–8 er live og verifisert i prod. Fase 4 (webhooks) og 5 (valgfritt) gjenstår. Fase 9 er bevisst droppet — se der.**

**Kontekst:** prod kjører i dag en build fra FØR plattformarbeidet. Alle SQL-migreringene under er RENT ADDITIVE (kun `CREATE`/`ADD`) og trygge uten nedetid.

**Ansvarsfordeling** (avklart med Basefarm 2026-08-11, se `docs/basefarm-deploy-epost.md`): Andreas gjør kode-deploy (FTPS zipdeploy, `scripts/deploy-app.sh`/`scripts/deploy-func.sh`) og SQL-migreringer selv (repoet er ikke delt med Basefarm, og prod-DB-en er brannmurslåst mot ekstern SQL-tilgang — migreringene kjøres derfor fra app-en selv via `/api/admin/deploy-migration`, ikke via psql utenfra). Basefarm/Orange håndterer kun Azure-konfigurasjon: env vars/secrets, webhook-registrering av secrets, Function-app-innstillinger.

**Rekkefølge snudd i forhold til en tradisjonell runbook:** koden deployes FØR SQL-en kjøres, fordi migreringsruta selv er en del av det som deployes. Trygt siden plattformen ikke har reell trafikk ennå.

**Ingen gating:** plattformen har ingen reelle brukere ennå, så det er ingen prod-avhengighet å bevise paritet mot over tid. Fase 7–8 kjørte derfor rett etter røyktesten, i samme utrulling.

---

## Fase 0 — Forutsetninger (før noe annet) ✅

- [x] Build-miljøet har `NEXTAUTH_URL=https://registrering.bjerke.no` (IKKE localhost) — verifisert via `robots.txt` i prod.
- [x] `CRON_SECRET` er tilgjengelig (samme verdi til App Service og Function-appen) — bekreftet av Basefarm.
- [x] `NEXTAUTH_SECRET` er satt — bekreftet av Basefarm.
- [x] `SEED_SECRET` er satt på App Service — verifisert (migreringsruta godtok den).
- [x] DB-tilkobling bekreftet — `/api/health` viser `db: ok`.

## Fase 1 — Deploy koden (Andreas, selvbetjent) ✅

- [x] `./scripts/deploy-app.sh` — deployet, HTTP 200.
- [x] Build kjørte i prod-miljø med korrekt `NEXTAUTH_URL`.

## Fase 2 — SQL-migreringer + seed (Andreas, selvbetjent, via app-en) ✅

- [x] `POST /api/admin/deploy-migration` — alle 8 migreringer (159 statements) kjørt, verifisert idempotent-trygt via en fremtvunget retry (alt hoppes nå over på «already exists»).
- [x] `seedCourseLifecycleFlow()` kjørte — «Kurs-livssyklus»-flyten opprettet, id=1, status `draft` (senere aktivert, se Fase 7).
- [x] Tre admin-brukere bekreftet: alle fantes allerede fra juni med korrekt tilgang (Hege/Stine: `admin`, Hilde: `superadmin`) — ingen endring nødvendig. Ruta ble i etterkant utvidet til å løfte `parent`→`admin` automatisk hvis noen av dem ikke hadde hatt tilgang.

## Fase 3 — Azure-timere ✅

- [x] `./scripts/deploy-func.sh` — `cron-flows` deployet til `dnt-travskole-func`.
- [x] Basefarm har satt `CRON_TARGET_URL_FLOWS` + `CRON_SECRET` på Function-appen (bekreftet 2026-08-12/13).
- [x] `/api/cron/flows` verifisert direkte (200, korrekt respons-form).
- [x] `/api/cron/email-triggers` (nå erstattet av `/api/cron/gdpr-retention`, se Fase 8) verifisert i sin tid.

## Fase 4 — Stripe/Vipps webhook-secrets ⏳ GJENSTÅR

- [ ] Andreas registrerer Stripe-webhook → `.../api/webhooks/stripe` i Stripe-dashboardet.
- [ ] Andreas registrerer Vipps-webhook → `.../api/webhooks/vipps`.
- [ ] Basefarm setter `STRIPE_WEBHOOK_SECRET` (+ `STRIPE_WEBHOOK_SECRET_TEST`) og `VIPPS_WEBHOOK_SECRET` i Azure (verdiene sendes via sikker lenke).
- [ ] ⚠️ Valider Vipps webhook-secret som rå-bytes ÉN gang mot Vipps MT (testmiljø) før go-live.
- [ ] ⚠️ Valider Vipps REFUNDED-payload mot en ekte MT-refusjon (delprosjekt 7): bekreft `transactionInfo.refundedAmount`/`.amount` finnes + at `body.amount.value` er refundert beløp; ved avvik juster `mapVippsEvent`.
- [ ] Vipps betalings-env-vars (CLIENT_ID/SECRET/… + `_TEST`) er ALLEREDE provisjonert av Basefarm — ikke rør.

## Fase 5 — Valgfritt (config-gated, ikke-blokkerende) ⏳ GJENSTÅR

- [ ] Microsoft Graph (svar-stopp/bounce): send `docs/bestilling-graph-tilgang.md` til Patryk (han har bekreftet han er klar til å ta imot). Basefarm setter `GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET/MAILBOXES`. Uten disse er polling no-op (trygt).
- [ ] KI-lag: sett `AI_PROVIDER` + nøkler KUN etter inngått databehandleravtale med LLM-leverandøren.
- [x] getcookies: ingen handling nødvendig — lastes via bjerke.no GTM.

## Fase 6 — Post-deploy røyktest (mot prod) — delvis ✅

- [x] Offentlige sider 200; `robots.txt`/`sitemap.xml` viser `registrering.bjerke.no`.
- [x] Admin-gate (`/admin` → 307 uten sesjon).
- [ ] getcookies-samtykkebanner + GA4-beacon (ikke visuelt sjekket).
- [ ] Reell påmelding → bekreftelses-e-post (ikke testet med ekte innsending ennå).
- [ ] Passord-reset + magic-link → lenker peker på prod-domenet (3 admin-magic-links ble sendt i Fase 2, men ikke selv verifisert klikket).
- [ ] Booking-flyten ende-til-ende.

---

## Fase 7 — Aktiver livssyklus-flyten ✅

- [x] Flyten (id=1) aktivert i prod 2026-08-12/13 via `/api/admin/deploy-migration` sitt `activateFlow`-flagg (speiler admin-UI-handlingen). Adversarielt sikkerhets-gjennomgått først: ingen backfill-risiko for eksisterende registreringer (kun event-drevet på `registration.created`); ett smalt, neglisjerbart dobbelt-sende-vindu identifisert (registrering↔enrollment er ikke atomisk) — logget som lav-prioritets follow-up, ikke en blokker gitt null reell trafikk.

## Fase 8 — Deploy delprosjekt C (legacy-fjerning) ✅

- [x] `retire-legacy-emailtrigger` re-synket mot main (var 2 commits bak — inneholdt Fase 2-fiksene) og fast-forward-merget inn i `main`.
- [x] Deployet (`./scripts/deploy-app.sh`). Verifisert: gammel `/api/cron/email-triggers` → 404 (forventet), ny `/api/cron/gdpr-retention` → 200 `{anonymized:0}`. Ingen gjenværende `prisma.emailTrigger/emailTemplate/emailLog`-referanser i koden (grep-bekreftet).
- [ ] ⚠️ **Basefarm-oppfølging sendt, ikke bekreftet:** be dem oppdatere `CRON_TARGET_URL` på Function-appen fra `/api/cron/email-triggers` til `/api/cron/gdpr-retention`. Inntil da 404-er GDPR-jobben trygt (ingen krasj) — ikke-blokkerende siden det ikke finnes reell brukerdata å anonymisere ennå.

## Fase 9 — Irreversibel opprydding — DROPPET (bevisst valg, 2026-08-13)

**`scripts/course-legacy-drop.sql` kjøres IKKE.** Etter Fase 8 refererer koden ikke lenger `email_logs`/`email_triggers`/`email_templates` i det hele tatt — de ligger som helt inerte, uskadelige levninger. Å droppe dem var alltid ren opprydding, aldri et krav.

Sjekket via `/api/admin/deploy-migration?secret=<SEED_SECRET>` (GET, read-only) rett etter Fase 8:
- `email_logs`: 0 rader — ingen sendehistorikk å miste.
- `email_triggers`: 5 rader (course_id=4, alle `enabled: false` — allerede inaktive før C).
- `email_templates`: 5 rader — **ekte, håndskrevet norsk tekst for et ponnikurs**, signert «Teamet hos Bjerke Ponniskole», tydelig rikere enn dagens plassholdertekst i `lib/flows/seed-lifecycle.ts`. IKKE testjølk.

Beslutning: la tabellene ligge. Vurder heller å lese innholdet og gjenbruke det gode i den nye livssyklus-flytens node-tekster ved en senere anledning.

---

*Full detalj per steg: `docs/deploy-runbook.md`. Denne sjekklisten er sammendraget + rekkefølgen.*
