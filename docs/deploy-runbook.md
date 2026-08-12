# Produksjonsutrulling — engasjementsplattformen (runbook)

Denne runbooken tar registrering.bjerke.no fra dagens (gamle) build til full
engasjementsplattform (delprosjekt 1–6). Alt utviklingsarbeid er ferdig og
merget til `main`; dette er kun drift/utrulling. Kode-deploy (FTPS zipdeploy)
og SQL-migreringer kjøres av Andreas selv (repoet er ikke delt med Basefarm);
Basefarm/Orange håndterer kun Azure-konfigurasjon (env vars/secrets, webhooks,
Function-app-innstillinger) — se `docs/basefarm-deploy-epost.md` for den
avklarte ansvarsfordelingen.

**Viktig kontekst:** prod kjører i dag en build fra FØR plattformarbeidet
(`/feedback` og alle plattform-ruter gir 404 der). Alle migreringene under er
RENT ADDITIVE (kun `CREATE TABLE`/`ADD COLUMN`/`CREATE INDEX`/`ADD CONSTRAINT`)
og trygge å kjøre uten nedetid. Rekkefølgen er nå snudd i forhold til en
tradisjonell runbook: **koden deployes FØRST**, deretter kjøres SQL-en — fordi
migreringsruta selv er en del av det som deployes (se Steg 2). Trygt siden
plattformen ikke har reell trafikk ennå. Rekkefølgen under er samme som i
`docs/go-live-checklist.md` (Fase 0–9) — denne filen har full detalj per steg.

---

## Steg 1 — Deploy koden (Andreas, selvbetjent, FTPS zipdeploy)

Deploy `main` (siste commit) til Azure App Service: `./scripts/deploy-app.sh`
(bygger, pakker, verifiserer artefaktet, POSTer til Kudu zipdeploy — se
skriptets kommentarer for `AZURE_DEPLOY_USER`/`AZURE_DEPLOY_PASS`). Dette
bringer også med seg de 6 bugfiksene fra testrunden 2026-07-18
(getcookies-CSP, GA4-CSP, 2× input-validering, SEO base-url-hardening,
registrerings-eksport BOM), pluss `/api/admin/deploy-migration` (Steg 2).

**Merk:** `robots.txt`/`sitemap.xml` genereres statisk ved `next build`.
Build-miljøet MÅ ha `NEXTAUTH_URL=https://registrering.bjerke.no` (ikke en
localhost-verdi), ellers bakes localhost inn i SEO-filene. Etter SEO-fiksen
(getBaseUrl nekter localhost i produksjon) er dette uansett dekket, men sørg
for at build kjører i prod-miljø med korrekt env.

## Steg 2 — SQL-migreringer + seed (Andreas, selvbetjent, ETTER kode-deploy)

Prod-DB-en er brannmurslåst mot ekstern SQL-tilgang, så migreringene kjøres
IKKE via psql/prisma utenfra og IKKE av Basefarm — de kjøres fra app-en selv
via `POST /api/admin/deploy-migration` (`{ "secret": "<SEED_SECRET>" }`, samme
mønster som den tidligere `/api/migrate`-ruta). Ett kall kjører, i rekkefølge,
alle 159 statements generert fra disse 8 filene, og deretter
`seedCourseLifecycleFlow()` (oppretter «Kurs-livssyklus»-flyten som **draft**
— aktiveres manuelt i admin når klar, se Steg 8 / `docs/go-live-checklist.md`
Fase 7). Kildene ligger fortsatt i `scripts/*.sql` som
dokumentasjon/historikk — selve kjøringen skjer fra
`lib/deploy/generated-migrations.ts`:

1. `scripts/crm-migration.sql`
2. `scripts/event-bus-migration.sql`
3. `scripts/payments-migration.sql`
4. `scripts/flow-engine-migration.sql`  ⚠️ **inneholder den partielle unike indeksen `flow_enrollments_one_active` som IKKE finnes i schema.prisma** — den MÅ med, ellers kan samtidige enrollments dobbelt-sende.
5. `scripts/email-tracking-migration.sql`
6. `scripts/ai-layer-migration.sql`
7. `scripts/course-flows-migration.sql`  ⚠️ **inneholder TO partielle unike indekser** (`flow_enrollments_one_active` reskopet til `WHERE registration_id IS NULL`, + ny `flow_enrollments_one_active_reg` på `(flow_id, registration_id) WHERE registration_id IS NOT NULL`) som IKKE finnes i schema.prisma — de MÅ med. Additiv: to nye nullbare kolonner (`course_id`/`registration_id`) på `flow_enrollments` + FK-er (delprosjekt A — dato-forankret kurs-flyt-planlegging).
8. `scripts/course-lifecycle-migration.sql`  (additiv — `anchor_mode`-kolonne på `flows`, default `'contact'`; delprosjekt B — kurs-livssyklus-flyter).

Statement-ene er for det meste ikke idempotente (`CREATE TABLE`/`CREATE INDEX`,
ment å kjøres nøyaktig én gang) — et eventuelt gjentatt kall feiler forventet
på "already exists", ikke skadelig. Responsen viser `applied: [{ migration,
statements }]` per fil + seed-resultatet, så en delvis feil er lett å se
nøyaktig hvor stoppet.

Samme kall oppretter deretter tre admin-brukere for Bjerke Travbane (rolle
`admin`, idempotent — skippes hvis e-posten allerede finnes) og sender hver
en magic-link-e-post (samme mekanisme som `/api/admin/users`, 15 min
gyldighet): `hege.karin.arverud@bjerke.no`, `stine.rasmussen@bjerke.no`,
`hilde.apneseth@bjerke.no`. Responsen viser `admins: [{ email, created }]`.

## Steg 3 — Azure-timer for flyt-motoren (`cron-flows`)

Flyt-enrollments beveger seg IKKE uten denne. Andreas deployer selv
(`./scripts/deploy-func.sh` — samme FTPS/OneDeploy-mekanisme som web-appen,
til `dnt-travskole-func`), som legger til `cron-flows` (schedule
`0 */5 * * * *` = hvert 5. minutt) ved siden av den eksisterende
`cron-email-triggers`. Basefarm setter kun de to app settings-ene på
Function-appen:
- `CRON_TARGET_URL_FLOWS` = `https://registrering.bjerke.no/api/cron/flows`
- `CRON_SECRET` (samme verdi som App Service bruker; ruta gjør timing-safe Bearer-sjekk)

Bekreft at den eksisterende `cron-email-triggers`-timeren fortsatt kjører (daglig).
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

---

## Steg 8 — Aktiver livssyklus-flyten

Aktiver «Kurs-livssyklus»-flyten i admin (`/admin/crm/flyter`). Fra nå eier
flyten NYE påmeldinger; legacy-cronen hopper automatisk over flyt-eide
registreringer (per-registrering XOR, null dobbel-send). Legacy fullfører
påmeldinger fra før aktivering. Ingen ventetid nødvendig før Steg 9 —
plattformen har ingen reelle brukere ennå, så det er ingen prod-avhengighet å
bevise paritet mot over tid.

## Steg 9 — Delprosjekt C (legacy-fjerning), samme økt

**Delprosjekt C** (fjerner `EmailTrigger`/`EmailTemplate`/`EmailLog` + admin-API/UI + den
dato-baserte sende-delen av cron-en; `registration_confirmed` blir alltid hardkodet) ligger
på grenen **`retire-legacy-emailtrigger`**. Merges inn og deployes rett etter at
livssyklus-flyten er aktivert (Steg 8) — ingen separat gate, ingen ventetid.

Merge `retire-legacy-emailtrigger` til `main` og deploy (`./scripts/deploy-app.sh` på nytt).
Den grenen har sitt eget runbook-tillegg med detaljene, inkludert:
- Cron-ruta er omdøpt til `/api/cron/gdpr-retention` (kjører nå KUN GDPR-passene). **Oppdater
  Function-appens `CRON_TARGET_URL` til den nye URL-en HVIS den er satt** (ellers bruker
  Azure-funksjonen den nye in-repo-standarden automatisk ved deploy).
- Verifiser: `/api/cron/gdpr-retention` med secret → 200 `{ anonymized }`; en reell
  påmelding gir fortsatt bekreftelse (hardkodet).

## Steg 10 — Irreversibel opprydding, samme økt

Kjør `scripts/course-legacy-drop.sql` (`DROP TABLE` av de tre e-post-tabellene) som
eget, bevisst steg rett etter Steg 9. Ingen reell e-posthistorikk å arkivere ennå
(plattformen er ikke live), så ingen grunn til å vente — men kjøres separat siden det
er en `DROP TABLE` uten angrefunksjon. **Kan aldri angres.**

---

## Kjente ikke-blokkerende follow-ups (etter go-live)

**FERDIG siden opprinnelig liste** (ikke lenger follow-ups): kurs-`EmailTrigger`→flyter-migreringen (delprosjekt A+B merget; C klar på gren `retire-legacy-emailtrigger`, kjøres i samme utrulling — se Steg 9); kanban-betalingsbadge + `checkout.session.expired` + delrefusjon-radstatus (delprosjekt 7); booking-side checkout-UI (merget); Graph-DSN-parsing-hardening (merget); selvbetjent go-live-migreringsrute (`/api/admin/deploy-migration`, merget).

**Gjenstår (ikke-blokkerende):**
- SMS/push-kanaler i flyt-motoren (krever leverandør-valg + env/kostnad — ikke startet).
- Multi-mottaker-DSN: `parseDsnFields` parer Status/Final-Recipient over hele DSN-kroppen, ikke per RFC 3464 per-mottaker-blokk (lav risiko; sjelden i praksis).
- getcookies-repoets unpushede `feat/widget-event-api`-branch (venter på eiers gjennomgang).
