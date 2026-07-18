# Innsikt & dashboards — Design Spec (delprosjekt 6)

*Siste delprosjekt i engasjementsplattformen. CRM-visningene og flyt-lerretet ble bygget i delprosjekt 1/3 — dette delprosjektet leverer resten av arkitektur-spec'ens §6: dashbordene og visnings-UI-et for AiSuggestion-radene fra delprosjekt 5.*

## Overview

Én samlet innsiktsside `/admin/crm/innsikt` med fire faner (Flyter / Pipeline / Besøk / KI-forslag), drevet av ett samlet admin-API `GET /api/admin/crm/innsikt` som returnerer alle aggregatene i ett kall. All aggregering skjer server-side (Prisma `groupBy`/`count`/`aggregate`); ingen rå-rader når klienten. Recharts (ny dependency) for linje-/stolpediagram. En ren, TDD'd transformasjonsmodul `lib/crm/insights.ts` gjør all tallbehandling (rater, ukebøtting, tom-data) på ferdig-aggregerte input.

**Non-goals:** eksport/rapportgenerering, per-flyt-panel inne i editoren (kan komme senere), sanntidsoppdatering (siden laster ved besøk), endring av analysemotoren fra delprosjekt 5.

## API: `GET /api/admin/crm/innsikt`

Admin-gated (`requireAdmin`). Respons:
```typescript
{
  flows: {
    perFlow: { flowId, name, status, sent, opened, clicked, replied, bounced,
               openRate, clickRate, activeEnrollments }[],   // siste 30 dager, kun dedupeKey-bærende sends
    weekly: { weekStart: string /* ISO-dato mandag */, sent: number, opened: number }[], // siste 12 uker, alle flyter samlet
    enrollmentStatus: { status: string, count: number }[],
  },
  pipeline: {
    byStage: { stageId, stageName, pipelineName, openValue: number, count: number }[],
    wonByMonth: { month: string /* YYYY-MM */, value: number, count: number }[],  // siste 6 mnd
    totals: { open: number, won: number, lost: number },   // antall deals
  },
  visits: {
    weekly: { weekStart: string, pageViews: number, courseViews: number }[],  // siste 12 uker fra AppEvent
    funnel: { viewed: number, signupStarted: number, registered: number },    // siste 30 dager
  },
  suggestions: { id, flowId, flowName, kind, title, createdAt }[],  // kun status 'open', nyeste først
}
```
Hver av de fire delene beregnes i sin egen `try/catch` — feiler én del, returneres `null` for den delen (og logges), resten leveres. Aldri 500 for hele siden på grunn av én aggregat-feil.

## Ren modul: `lib/crm/insights.ts` (TDD)

- `computeRates(sent, opened, clicked): { openRate, clickRate }` — prosent med én desimal; 0 sends ⇒ 0-rater (aldri NaN/div-by-zero).
- `bucketByWeek(rows: { at: Date, ... }[], weeks: number, now: Date): WeekBucket[]` — ISO-uke-bøtting (mandag som ukestart, UTC), fyller tomme uker med 0, deterministisk med injisert `now`.
- `bucketByMonth(rows, months, now)` — tilsvarende per måned (YYYY-MM).
- Alle rene, ingen IO, ingen Date.now().

Prisma-spørringene i API-ruta er tynne (velg minimale felter, la insights.ts transformere) og dekkes av tsc + suite, samme mønster som apply-/runner-lagene i tidligere delprosjekter.

## Side: `/admin/crm/innsikt`

Klientside (mønster fra eksisterende CRM-sider: fetch-herding, initialLoading, AbortController). Fire faner:

1. **Flyter:** tabell per flyt med tall + rater; Recharts linjediagram (sendt/åpnet per uke, 12 uker); liten statusfordeling for enrollments (active/completed/exited/failed). Tom-tilstand: «Ingen sendinger ennå.»
2. **Pipeline:** Recharts stolpediagram (åpen verdi per stadium, gruppert per pipeline-navn i etiketten), stolpediagram vunnet per måned (6 mnd), tre nøkkeltall-kort (åpne/vunne/tapte).
3. **Besøk:** linjediagram side-/kursvisninger per uke; enkel trakt (tre tall med piler: sett → påbegynt → registrert). Informasjonsnotis: «Tallene avhenger av besøkendes samtykke (getcookies) — reelle besøk kan være høyere.»
4. **KI-forslag:** liste over åpne AiSuggestion (tittel, flytnavn som lenke til `/admin/crm/flyter/{flowId}`, dato); per rad knappene «Utført» (status→applied) og «Avvis» (status→dismissed) via `PATCH /api/admin/crm/ai/suggestions/[id]` (admin-gated, Zod: `{ status: 'applied' | 'dismissed' }`, 404 for ukjent id). Optimistisk fjerning fra listen ved klikk, rollback ved feil. Tom-tilstand: «Ingen forslag ennå — analysen kjører daglig for aktive flyter.»

Navigasjon: lenke «Innsikt» i CRM-navigasjonen (samme sted som Kontakter/Pipeline/Flyter — finn eksisterende nav-komponent og følg mønsteret). Norsk copy overalt.

## Hardening fra delprosjekt 5-sluttgjennomgangen (inkludert her)

`buildGraphFromOutline` i `lib/ai/generate-flow.ts` får en egen guard: kaster/avviser ved mer enn én condition-node i outline (i dag håndhever kun `parseFlowOutline` dette — delprosjekt 6 er «fremtidig kaller»-scenarioet sluttgjennomgangen advarte om). Én linje + test i eksisterende testfil.

## Testing

TDD: `lib/crm/insights.ts` (rater inkl. 0-sends, ukebøtting med tomme uker/ISO-mandag/UTC, månedsbøtting). Honest addition: én-condition-guard-test i `tests/ai-generate-flow.test.ts`. API/side via tsc + suite + build; finish-task: live smoke mot dev-server 3001 (innsikt-API med seedet data, PATCH på en testforslag-rad, opprydding verifisert) + browser-sjekk av siden.

## Migrering & utrulling

Ingen schema-endringer (leser kun eksisterende modeller) — ingen ny SQL. Ny dependency: `recharts` (klient-side, MIT). Ingen nye env-vars.
