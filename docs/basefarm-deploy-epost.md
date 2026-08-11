# Epost-utkast til Basefarm — utrulling av engasjementsplattformen (registrering.bjerke.no)

*Utkast til gjennomgang. Send den selv når du er klar. Full detalj: `docs/deploy-runbook.md` + `docs/go-live-checklist.md` i repoet.*

---

**Til:** Patryk / Basefarm (Orange)
**Emne:** Utrulling registrering.bjerke.no — engasjementsplattform (SQL + Azure)

Hei Patryk,

Vi er klare til å rulle ut den nye engasjementsplattformen på registrering.bjerke.no. Alt utviklingsarbeid er ferdig og merget til `main`. Under er alt dere trenger å gjøre, i **nøyaktig rekkefølge**. Alle SQL-migreringene er rent additive (`CREATE`/`ADD`) og trygge uten nedetid — **men kjør SQL FØR koden deployes.**

Full detalj per steg ligger i repoet: `docs/deploy-runbook.md` (utfyllende) og `docs/go-live-checklist.md` (avkryssbar). Gi beskjed hvis dere vil ha dem tilsendt separat.

## Forutsetning (før alt)
- Build-miljøet MÅ ha `NEXTAUTH_URL=https://registrering.bjerke.no` (ikke localhost), ellers bakes localhost inn i `robots.txt`/`sitemap.xml`.
- `CRON_SECRET` og `NEXTAUTH_SECRET` satt (samme `CRON_SECRET` på App Service og Function-appen).

## Steg 1 — SQL-migreringer mot prod-Postgres (NØYAKTIG denne rekkefølgen)
Verifiser etter hver at den gikk uten feil:
1. `scripts/crm-migration.sql`
2. `scripts/event-bus-migration.sql`
3. `scripts/payments-migration.sql`
4. `scripts/flow-engine-migration.sql`  — ⚠️ inneholder den partielle unike indeksen `flow_enrollments_one_active` (ligger IKKE i Prisma-skjemaet, men MÅ med — ellers kan flyter dobbelt-sende).
5. `scripts/email-tracking-migration.sql`
6. `scripts/ai-layer-migration.sql`
7. `scripts/course-flows-migration.sql`  — ⚠️ inneholder TO partielle unike indekser (også utenfor Prisma-skjemaet, MÅ med) + to nye kolonner på `flow_enrollments`.
8. `scripts/course-lifecycle-migration.sql`  — additiv `anchor_mode`-kolonne på `flows`.

## Steg 2 — Seed én gang
Kjør (idempotent, no-op ved ny kjøring): `npx tsx scripts/seed-course-lifecycle-flow.ts`
Den oppretter «Kurs-livssyklus»-flyten som **draft** — den aktiverer Andreas manuelt i steg 8, rett etter røyktesten.

## Steg 3 — Deploy koden
Deploy `main` (siste commit) til Azure App Service som vanlig.

## Steg 4 — Azure-timere
- **cron-flows** (hvert 5. min): sett env `CRON_TARGET_URL_FLOWS=https://registrering.bjerke.no/api/cron/flows` + `CRON_SECRET`. Verifiser at én tick gir HTTP 200.
- **cron-email-triggers** (daglig 07:00): bekreft at den fortsatt kjører.

## Steg 5 — Webhooks + Vipps-validering
- Registrer Stripe-webhook mot `.../api/webhooks/stripe`; sett `STRIPE_WEBHOOK_SECRET` (+ `STRIPE_WEBHOOK_SECRET_TEST`) i Azure. *(Andreas registrerer i Stripe-dashboardet; dere setter secreten i Azure.)*
- Registrer Vipps-webhook mot `.../api/webhooks/vipps`; sett `VIPPS_WEBHOOK_SECRET`.
- ⚠️ Valider Vipps webhook-secret som rå-bytes ÉN gang mot Vipps MT (testmiljø) før go-live.
- ⚠️ Valider Vipps REFUNDED-payload mot en ekte MT-refusjon (bekreft at `transactionInfo.refundedAmount`/`.amount` finnes).
- Vipps betalings-env-vars er allerede provisjonert av dere — ikke rør dem.

## Steg 6 — Valgfritt (config-gated, ikke-blokkerende)
- **Microsoft Graph** (svar-stopp/bounce): egen bestilling kommer (`docs/bestilling-graph-tilgang.md`) — Entra-appregistrering med `Mail.Read` + `ApplicationAccessPolicy` scopet til de 7 avsenderpostboksene. Uten dette er funksjonen no-op (trygt).
- **KI-lag:** settes opp senere (config-gated). Ikke nødvendig nå.

## Steg 7 — Post-deploy røyktest
Vi verifiserer sammen: offentlige sider 200, en reell påmelding gir bekreftelses-epost med prod-lenker, admin/CRM laster, `/api/cron/flows` svarer 200.

## Steg 8 — Aktiver livssyklus-flyten
Andreas aktiverer «Kurs-livssyklus»-flyten i admin (`/admin/crm/flyter`). Fra da eier flyten nye påmeldinger; det gamle epost-systemet hopper automatisk over dem (ingen dobbelt-sending). Ingen ventetid nødvendig her — plattformen har ingen reelle brukere ennå, så vi går rett videre.

## Steg 9 — Fjern det gamle epost-systemet (samme økt)
Merge grenen `retire-legacy-emailtrigger` → `main`, deploy. ⚠️ Cron-ruta omdøpes da til `/api/cron/gdpr-retention` — hvis `CRON_TARGET_URL` er satt på Function-appen må den oppdateres til den nye URL-en (ellers stopper GDPR-cronen).

## Steg 10 — Irreversibel opprydding (samme økt, som eget steg)
Kjør `scripts/course-legacy-drop.sql` (`DROP TABLE` av de tre gamle epost-tabellene). Dette kan ikke angres, så vi kjører det som et bevisst, separat siste steg — men ingen grunn til å vente, siden det ikke finnes reell epost-historikk å ta vare på ennå.

Si ifra om noe er uklart, så tar vi en gjennomgang.

Mvh
Andreas
