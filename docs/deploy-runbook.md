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
7. `scripts/course-flows-migration.sql`  ⚠️ **inneholder TO partielle unike indekser** (`flow_enrollments_one_active` reskopet til `WHERE registration_id IS NULL`, + ny `flow_enrollments_one_active_reg` på `(flow_id, registration_id) WHERE registration_id IS NOT NULL`) som IKKE finnes i schema.prisma — de MÅ med. Additiv: to nye nullbare kolonner (`course_id`/`registration_id`) på `flow_enrollments` + FK-er (delprosjekt A — dato-forankret kurs-flyt-planlegging).
8. `scripts/course-lifecycle-migration.sql`  (additiv — `anchor_mode`-kolonne på `flows`, default `'contact'`; delprosjekt B — kurs-livssyklus-flyter).

Alle er idempotent-vennlige tilleggsmigreringer. Verifiser etter hver at
migreringen gikk uten feil (Prisma-skjemaet matcher summen av dem).

## Steg 1b — Seed kurs-livssyklus-flyten (delprosjekt B)

Etter migreringene, kjør seeden ÉN gang (idempotent — no-op hvis flyten finnes):
`npx tsx scripts/seed-course-lifecycle-flow.ts`

Den oppretter «Kurs-livssyklus»-flyten som **draft** (schedule→e-post-kjede: påminnelse −3d,
velkomst, halvveis, etter-slutt +1d). Krever minst én aktiv `SenderIdentity` (finnes fra
flow-engine-seeden). **Aktivér flyten i admin (`/admin/crm/flyter`)** for å la den overta
dato-baserte kurs-e-poster. Fra aktivering eier flyten NYE påmeldinger (`registration.created`
→ kurs-forankret enrollment) og legacy-cronen hopper automatisk over dem
(`flowEnrollments: { none: {} }` — per-registrering-eierskap, null dobbel-send). Legacy
fullfører påmeldinger fra før aktivering. `registration_confirmed` sendes fortsatt inline
(uendret).

**Ingen ventetid nødvendig før neste steg** — plattformen har ingen reelle brukere ennå, så
det er ingen prod-avhengighet å bevise paritet mot over tid. Aktivering + legacy-fjerning
(neste steg) gjøres i samme utrulling.

## Steg 1c — Delprosjekt C (legacy-fjerning), samme økt

**Delprosjekt C** (fjerner `EmailTrigger`/`EmailTemplate`/`EmailLog` + admin-API/UI + den
dato-baserte sende-delen av cron-en; `registration_confirmed` blir alltid hardkodet) ligger
på grenen **`retire-legacy-emailtrigger`**. Merges inn og deployes rett etter at
livssyklus-flyten er aktivert (Steg 1b) — ingen separat gate, ingen ventetid.

Merge `retire-legacy-emailtrigger` til `main` og deploy. Den grenen har sitt
eget runbook-tillegg med detaljene, inkludert:
- Cron-ruta er omdøpt til `/api/cron/gdpr-retention` (kjører nå KUN GDPR-passene). **Oppdater
  Function-appens `CRON_TARGET_URL` til den nye URL-en HVIS den er satt** (ellers bruker
  Azure-funksjonen den nye in-repo-standarden automatisk ved deploy).
- **Aller sist i samme utrulling, irreversibelt:** `scripts/course-legacy-drop.sql`
  (`DROP TABLE` av de tre e-post-tabellene). Ingen reell e-posthistorikk å arkivere
  ennå (plattformen er ikke live), så ingen grunn til å vente — men kjøres som eget,
  bevisst steg siden det er en `DROP TABLE` uten angrefunksjon.

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

**FERDIG siden opprinnelig liste** (ikke lenger follow-ups): kurs-`EmailTrigger`→flyter-migreringen (delprosjekt A+B merget; C klar på gren `retire-legacy-emailtrigger`, gated — se Fase 8–10 i go-live-sjekklisten); kanban-betalingsbadge + `checkout.session.expired` + delrefusjon-radstatus (delprosjekt 7); booking-side checkout-UI (merget); Graph-DSN-parsing-hardening (merget).

**Gjenstår (ikke-blokkerende):**
- SMS/push-kanaler i flyt-motoren (krever leverandør-valg + env/kostnad — ikke startet).
- Multi-mottaker-DSN: `parseDsnFields` parer Status/Final-Recipient over hele DSN-kroppen, ikke per RFC 3464 per-mottaker-blokk (lav risiko; sjelden i praksis).
- getcookies-repoets unpushede `feat/widget-event-api`-branch (venter på eiers gjennomgang).
