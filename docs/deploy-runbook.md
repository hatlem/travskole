# Produksjonsutrulling — engasjementsplattformen (runbook)

Denne runbooken tar registrering.bjerke.no fra dagens (gamle) build til full
engasjementsplattform (delprosjekt 1–6). Alt utviklingsarbeid er ferdig og
merget til `main`; dette er kun drift/utrulling. Kjøres av Basefarm/Orange
(SQL + Azure) i samråd med Andreas.

**Viktig kontekst:** prod kjører i dag en build fra FØR plattformarbeidet
(`/feedback` og alle plattform-ruter gir 404 der). Alle migreringene under er
RENT ADDITIVE (kun `CREATE TABLE`/`ADD COLUMN`/`CREATE INDEX`/`ADD CONSTRAINT`)
og trygge å kjøre uten nedetid. Kjør SQL-en FØR den nye koden deployes.

---

## Steg 1 — SQL-migreringer (Basefarm, i NØYAKTIG denne rekkefølgen)

Kjør mot prod-Postgres, i rekkefølge (hver bygger på forrige):

1. `scripts/crm-migration.sql`
2. `scripts/event-bus-migration.sql`
3. `scripts/payments-migration.sql`
4. `scripts/flow-engine-migration.sql`  ⚠️ **inneholder den partielle unike indeksen `flow_enrollments_one_active` som IKKE finnes i schema.prisma** — den MÅ med, ellers kan samtidige enrollments dobbelt-sende.
5. `scripts/email-tracking-migration.sql`
6. `scripts/ai-layer-migration.sql`

Alle er idempotent-vennlige tilleggsmigreringer. Verifiser etter hver at den
gikk uten feil. (Prisma-skjemaet matcher summen av disse.)

## Steg 2 — Deploy koden

Deploy `main` (siste commit) til Azure App Service som vanlig. Dette bringer
også med seg de 6 bugfiksene fra testrunden 2026-07-18 (getcookies-CSP,
GA4-CSP, 2× input-validering, SEO base-url-hardening, registrerings-eksport BOM).

**Merk:** `robots.txt`/`sitemap.xml` genereres statisk ved `next build`.
Build-miljøet MÅ ha `NEXTAUTH_URL=https://registrering.bjerke.no` (ikke en
localhost-verdi), ellers bakes localhost inn i SEO-filene. Etter SEO-fiksen
(getBaseUrl nekter localhost i produksjon) er dette uansett dekket, men sørg
for at build kjører i prod-miljø med korrekt env.

## Steg 3 — Azure-timer for flyt-motoren (`cron-flows`)

Flyt-enrollments beveger seg IKKE uten denne. `function.json` ligger i repo
(`azure-functions/cron-flows/function.json`, schedule `0 */5 * * * *` = hvert
5. minutt). På Function-appen:
- Sett env `CRON_TARGET_URL_FLOWS` = `https://registrering.bjerke.no/api/cron/flows`
- Sett env `CRON_SECRET` (samme verdi som App Service bruker; ruta gjør timing-safe Bearer-sjekk)
- Bekreft at den eksisterende `cron-email-triggers`-timeren fortsatt kjører (daglig).

Verifiser: én manuell/naturlig tick skal gi `200 {processed,sent,failed,completed,poller,suggestions}`.

## Steg 4 — Stripe/Vipps webhook-secret-runden

Begge webhook-endepunktene finnes nå: `/api/webhooks/stripe` og `/api/webhooks/vipps`.
- Registrer webhook-URL i **Stripe dashboard** → Developers → Webhooks → `https://registrering.bjerke.no/api/webhooks/stripe`; sett resulterende signing secret som `STRIPE_WEBHOOK_SECRET` (+ `STRIPE_WEBHOOK_SECRET_TEST` for testmodus) i Azure.
- Registrer webhook via **Vipps webhook-API** → `https://registrering.bjerke.no/api/webhooks/vipps`; sett secret som `VIPPS_WEBHOOK_SECRET`.
- ⚠️ **Valider Vipps webhook-secret som rå-bytes ÉN gang mot Vipps MT (testmiljø)** før go-live — koden antar rå-streng-bytes i HMAC-nøkkelen; bekreft mot en faktisk Vipps-signert webhook.
- ⚠️ **Valider Vipps REFUNDED-payloaden mot en ekte MT-refusjon** (delprosjekt 7): bekreft at `transactionInfo.refundedAmount` + `transactionInfo.amount` finnes og at `body.amount.value` er refundert beløp (ikke opprinnelig total) — del/full-avgjørelsen leser `refundedAmount` vs `transactionInfo.amount`, mens vist «Delvis refundert (X kr)» bruker `body.amount.value`. Ved avvik: juster `mapVippsEvent`. Partial vs full REFUNDED får nå distinkte `eventId` (`:partial`/`:full`) så begge tidslinje-innslag bevares.
- Vipps betalings-env-vars (CLIENT_ID/SECRET/SUBSCRIPTION_KEY/MSN + `_TEST`) er ALLEREDE korrekt provisjonert av Basefarm (dual-sett) — ikke rør dem.

## Steg 5 — Microsoft Graph (svar-stopp/bounce) — VALGFRITT, config-gated

Send `docs/bestilling-graph-tilgang.md` til Patryk (Basefarm): Entra
app-registrering med application permission `Mail.Read` + admin-samtykke +
`ApplicationAccessPolicy` scopet til de 7 avsenderpostboksene. Når
`GRAPH_TENANT_ID`/`GRAPH_CLIENT_ID`/`GRAPH_CLIENT_SECRET`/`GRAPH_MAILBOXES`
er satt i Azure, aktiveres svar-stopp/bounce automatisk. Uten dem er hele
pollingen no-op (`isGraphConfigured()` → false) — trygt, ikke blokkerende.

## Steg 6 — KI-lag — VALGFRITT, config-gated

Uten `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` er alt KI usynlig/no-op og appen er
identisk med i dag. FØR aktivering med ekte kontaktdata: inngå
databehandleravtale med LLM-leverandøren (GDPR-forutsetning fra spec'en). Sett
så nøklene i Azure (`AI_PROVIDER` + provider-nøkler).

## Steg 7 — getcookies

getcookies-samtykkewidgeten lastes sentralt via bjerke.no sin delte
GTM-container (etter CSP-fiksen 2104af0). Ingen handling nødvendig ved deploy;
GTM-containeren og bjerke.no er urørt.

---

## Etter utrulling — verifikasjon (post-deploy røyktest)

Kjør disse mot prod etter deploy (dette er delen av testrunden som ikke kunne
gjøres uten prod-tilgang):
- Offentlige sider 200; `robots.txt`/`sitemap.xml` viser `registrering.bjerke.no` (ikke localhost).
- getcookies-samtykkebanner rendrer; GA4-beacon gir 204 etter samtykke (0 CSP-feil i konsoll).
- En reell påmelding → bekreftelses-e-post kommer frem med ekte lenker (ikke localhost).
- Passord-reset + magic-link-e-post → lenkene peker på prod-domenet.
- Admin-innlogging + CRM-sidene laster (kontakter/pipeline/flyter/innsikt).
- `/api/t/o/*` + `/api/t/c/*` svarer (pixel 200 gif, klikk 302) — bekrefter at email-tracking-migreringen + rutene er live.
- `/api/cron/flows` med riktig secret → 200 med `poller`+`suggestions` i responsen.

## Kjente ikke-blokkerende follow-ups (etter go-live)
- Migrere eksisterende kurs-`EmailTrigger`/cron inn i flyter (motoren er nå bevist).
- kanban-betalingsbadge (pipelines-API mangler paymentStatus), booking-side checkout-UI, `checkout.session.expired`-håndtering, delrefusjon-radstatus.
- getcookies-repoets unpushede `feat/widget-event-api`-branch (venter på eiers gjennomgang).
