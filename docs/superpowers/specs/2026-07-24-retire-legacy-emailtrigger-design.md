# Pensjonering av legacy-EmailTrigger — Design Spec (delprosjekt C)

*Siste delprosjekt i migreringen av kurs-e-post fra det gamle `EmailTrigger`-systemet til flyt-motoren. Delprosjekt A ga motor-fundamentet (dato-forankret `schedule`-node), B koblet påmeldinger inn i en delt livssyklus-flyt og lot flyt + legacy sameksistere trygt. C fjerner legacy-maskineriet.*

## ⚠️ Utrullings-gating (kritisk — gjentas i runbook + commits)

**C må IKKE deployes til prod før livssyklus-flyten (delprosjekt B) er AKTIVERT i prod og paritet er bevist.** Grunn: C fjerner legacy-cronens dato-baserte sending. Deployes C mens livssyklus-flyten fortsatt er `draft`, står prod uten dato-baserte kurs-e-poster fra NOEN av systemene (drop-send). Den irreversible `DROP TABLE`-migreringen kjøres et enda senere, eget steg. Bruker eier denne deploy-koordineringen (bekreftet valg 2026-07-24).

## Kontekst

Legacy-fotavtrykk som fjernes (kartlagt): modellene `EmailTemplate`/`EmailTrigger`/`EmailLog`; admin-API-ene under `app/api/admin/email-triggers/*` og `app/api/admin/email-templates/*`; admin-UI `app/admin/email-templates/*` + trigger-seksjonen i `app/admin/courses/[id]/edit/page.tsx`; den dato-baserte send-delen av `app/api/cron/email-triggers/route.ts`; `registration_confirmed`-mal-overstyret i `app/api/registrations/route.ts`; hjelperen `sendTemplatedEmail` (lib/mail.ts) som mister alle kallere.

**Skal BEHOLDES (viktige skiller):**
- `lib/email-templates.ts` — merge-tag-hjelperen (`MERGE_TAGS`, `replaceMergeTags`, `MergeTagData`), brukt av FLYTENE. Dette er IKKE `EmailTemplate`-modellen.
- `sendRegistrationConfirmation` (lib/mail.ts) — den hardkodede, waitlist-bevisste bekreftelses-e-posten. Blir nå eneste bekreftelses-sti.
- De TO GDPR-passene i cron-ruta (barn-anonymisering ved `data_retention_days > 0`; anonym-besøks-purge 180d).

**Non-goals:** rename av cron-URL-en (YAGNI — beholdes for å unngå Azure-timer-reconfig); ny redigerbar bekreftelses-mal (bevisst forkastet: bryter waitlist-forgreningen; livssyklus-editerbarhet dekkes av flyter); endring av flyt-motoren eller livssyklus-flyten.

## 1. `registration_confirmed` → alltid hardkodet

I dag: `app/api/registrations/route.ts` slår opp en `emailTrigger`(`registration_confirmed`, enabled, med template), sender via `sendTemplatedEmail` + `emailLog.create` HVIS funnet, ellers faller til `sendRegistrationConfirmation` + `sendRegistrationAdminNotification`.

**Endring:** fjern `emailTrigger.findFirst`-oppslaget, `if (trigger?.template)`-grenen (inkl. `sendTemplatedEmail`-kallet og `emailLog.create`), og behold KUN `else`-grenens oppførsel — nå ubetinget:
```ts
await Promise.all([
  sendRegistrationConfirmation(emailData),
  sendRegistrationAdminNotification(emailData),
]).catch(() => {});
```
`emailData` (inkl. `isWaitlist`) er uendret; `sendRegistrationConfirmation` håndterer allerede waitlist vs bekreftet. Ingen ny mekanisme, ingen `EmailTrigger`/`EmailTemplate`/`EmailLog`-referanse igjen i ruta.

## 2. Cron: fjern e-post-delen, behold GDPR

I `app/api/cron/email-triggers/route.ts`, fjern: `emailTrigger.findMany`-løkka + all sending (`sendTemplatedEmail`, `emailLog.create`), `computeSendDate`, `dueRegistrationsWhere` (B's parallelldrift-filter — overflødig når legacy er borte), `formatDate`/`osloDay`/`addDays` hvis de kun brukes av den fjernede delen. **Behold:** auth-sjekken (timing-safe Bearer + fail-closed) og de TO GDPR-passene uendret. URL/rute-fil beholdes (Azure-timeren peker hit). Responsen forenkles til f.eks. `{ anonymized, purged }` (uten `processed`/`sent`/`errors` fra e-post). `export osloDay`/`dueRegistrationsWhere` fjernes fra modulen (deres eneste tester oppdateres/fjernes — se §7).

## 3. Fjern admin-API + admin-UI

Slett filene:
- API: `app/api/admin/email-triggers/route.ts`, `app/api/admin/email-triggers/[id]/route.ts`, `app/api/admin/email-triggers/[id]/send/route.ts`, `app/api/admin/email-templates/route.ts`, `app/api/admin/email-templates/[id]/route.ts`, `app/api/admin/email-templates/preview/route.ts` (og tomme mapper).
- UI: `app/admin/email-templates/page.tsx`, `app/admin/email-templates/[id]/page.tsx`.
- I `app/admin/courses/[id]/edit/page.tsx`: fjern trigger-seksjonen (trigger-slots, mal-tilknytning, av/på) + tilhørende state/fetch/handlers som KUN betjener triggere. Alt annet på kurs-redigeringssiden (grunndata, betalingsmåter osv.) beholdes urørt.
- Fjern nav-/lenke-referanser til `/admin/email-templates` (og ev. til trigger-sidene) fra admin-navigasjon.

## 4. Fjern død hjelper

`sendTemplatedEmail` (lib/mail.ts): etter §1–§2 har den ingen kallere → fjernes (+ ev. private hjelpere kun den brukte). `sendRegistrationConfirmation`, `sendRegistrationAdminNotification`, og resten av lib/mail.ts beholdes. Verifiser med grep at ingen andre kallere finnes før sletting.

## 5. Schema + gated DROP-migrering

Fjern modellene `EmailTemplate`, `EmailTrigger`, `EmailLog` fra `prisma/schema.prisma`. Fjern også de tilhørende revers-relasjonene: `emailTriggers EmailTrigger[]` på `Course` (linje ~153) og `emailLogs EmailLog[]` på `Registration` (linje ~240). **`flowEnrollments FlowEnrollment[]`** på Course/Registration (fra delprosjekt A) beholdes URØRT. Dev: `prisma db push` (dropper dev-tabellene — aksepter data-loss i DEV) + `prisma generate`.

Prod: en EGEN, tydelig merket `scripts/course-legacy-drop.sql`:
```sql
-- ⚠️ IRREVERSIBELT. Kjøres SIST, av Basefarm, KUN etter at livssyklus-flyten er
-- aktivert i prod, paritet er bevist, og ev. e-posthistorikk (email_logs) er
-- arkivert/ikke lenger nødvendig. Ikke kjør sammen med kode-deployen.
DROP TABLE IF EXISTS email_logs;
DROP TABLE IF EXISTS email_triggers;
DROP TABLE IF EXISTS email_templates;
```
Rekkefølge: `email_logs` først (FK til triggers), så `email_triggers` (FK til templates+courses), så `email_templates`. Inntil dette kjøres lever prod-tabellene som inert historikk — Prisma (uten modellene) ignorerer dem, og all kode som refererte dem er fjernet.

## 6. Testing & utrulling

- **Registrering:** unit/integrasjon som bekrefter at ruta kaller `sendRegistrationConfirmation` (+ admin-varsel) og at det IKKE finnes noe `emailTrigger`-oppslag igjen (grep-nivå + at ruta kompilerer uten modellene). Behold eksisterende registrerings-tester grønne.
- **Cron:** behold/juster testene så de dekker at BEGGE GDPR-passene fortsatt kjører; fjern `tests/cron-email-triggers-where.test.ts` (B) og ev. `osloDay`-tester som testet den fjernede delen. Ingen test skal referere de fjernede eksportene.
- **Fjernede ruter:** `pnpm build` bekrefter at appen bygger uten dem; en enkel sjekk (eller live smoke) at `/admin/email-templates` og `/api/admin/email-triggers` gir 404.
- **Live smoke (tsx, selvryddende):** opprett en registrering via den faktiske sende-stien-mocken/DB → bekreft `sendRegistrationConfirmation`-sti (ingen emailTrigger). Kall cron-ruta med gyldig secret → `200` med GDPR-tellinger (uten e-post-felter). Rydd opp.
- **Testarkitektur:** vitest-suiten forblir DB-uavhengig (mock Prisma). Ingen nye env-vars. `scripts/course-legacy-drop.sql` + gating dokumenteres i runbook (eget «kjør helt til slutt»-steg).
- **Scope-grense:** ingen endring av flyt-motoren/livssyklus-flyten; cron-URL beholdes; `lib/email-templates.ts` og `sendRegistrationConfirmation` beholdes.
