# Pensjonering av legacy-EmailTrigger — Implementasjonsplan (delprosjekt C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fjern legacy-kurs-e-post-maskineriet (`EmailTrigger`/`EmailTemplate`/`EmailLog` + tilhørende API/UI/cron-del) etter at flyt-motoren (A+B) har overtatt; behold GDPR-passene og en hardkodet, waitlist-bevisst påmeldingsbekreftelse.

**Architecture:** Ren fjerning. `registration_confirmed` blir alltid `sendRegistrationConfirmation` (finnes). Cron beholder auth + de to GDPR-passene, mister e-post-delen. Modellene fjernes fra schema; prod-tabellene droppes av et eget, gated, irreversibelt SQL-steg SENERE.

**Tech Stack:** Next.js 16, Prisma 5/Postgres, Vitest, TypeScript strict, pnpm.

## ⚠️ Utrullings-gating (kritisk)

**Denne grenen må IKKE deployes til prod før livssyklus-flyten (delprosjekt B) er AKTIVERT i prod og paritet er bevist.** Ellers står prod uten dato-baserte kurs-e-poster (drop-send). `scripts/course-legacy-drop.sql` (irreversibel `DROP TABLE`) kjøres et enda senere, eget steg. Bruker eier deploy-koordineringen (bekreftet 2026-07-24). Gjenta dette i merge-/PR-teksten.

## Global Constraints

- **Retirement-prosjekt:** oppgavene er FJERNINGER. Verifikasjon per task er `tsc --noEmit` + `pnpm build` + scoped `eslint` + **grep-fravær** (den fjernede symbolet finnes ikke lenger) + full suite grønn — IKKE failing-test-first (sletting støtter ikke rød→grønn). Behavioral bekreftelse i den avsluttende live-smoke (Task 8).
- BEHOLD (må ikke fjernes): `lib/email-templates.ts` (merge-tag-hjelper brukt av flyter — IKKE `EmailTemplate`-modellen); `sendRegistrationConfirmation` + `sendRegistrationAdminNotification` (lib/mail.ts); de to GDPR-passene i cron (barn-anonymisering + anonym-besøks-purge); `sendMail`/`getSiteName`/`wrapEmailHtml`/`replaceMergeTags` (brukes av andre sendere/flyter).
- Ingen nye env-vars. Cron-URL beholdes (Azure-timer). Ingen endring av flyt-motoren/livssyklus-flyten.
- Rekkefølge er bindende: alle KODE-referanser til modellene fjernes (Task 1–6) FØR modellene fjernes fra schema (Task 7), så tsc/build holder seg grønt hele veien.

---

### Task 1: `registration_confirmed` → alltid hardkodet — `app/api/registrations/route.ts`

**Files:** Modify: `app/api/registrations/route.ts`

- [ ] **Step 1: Erstatt EmailTrigger-oppslaget + if/else med ubetinget hardkodet sending.**

Les fila. Finn blokken som starter med `// Check for template-based registration_confirmed trigger` (`const trigger = await prisma.emailTrigger.findFirst({...})`) og hele `if (trigger?.template) { ... } else { ... }`-strukturen (ca. linje 401–448). Erstatt HELE den blokken (fra `// Check for template-based...` t.o.m. `}`-en som lukker `else`-grenen) med:
```ts
    // Påmeldingsbekreftelse (hardkodet, waitlist-bevisst) + admin-varsel.
    // Redigerbare livssyklus-e-poster håndteres nå av kurs-livssyklus-flyten.
    await Promise.all([
      sendRegistrationConfirmation(emailData),
      sendRegistrationAdminNotification(emailData),
    ]).catch(() => {});
```
`emailData` (bygget rett over, inkl. `isWaitlist`) er uendret. Fjern nå eventuelle imports i fila som KUN ble brukt av den fjernede blokken: `sendTemplatedEmail` (hvis importert her). La `sendRegistrationConfirmation`/`sendRegistrationAdminNotification`-importene stå (de brukes fortsatt). `getSetting` beholdes hvis det brukes andre steder i fila (sjekk — det brukes til `contact_email` i den fjernede blokken; grep for andre `getSetting`-bruk i fila før du fjerner importen).

- [ ] **Step 2: Verifiser.** `grep -n "emailTrigger\|emailLog\|sendTemplatedEmail" app/api/registrations/route.ts` → INGEN treff. `pnpm exec tsc --noEmit` rent. `pnpm exec eslint app/api/registrations/route.ts` rent (bekreft ingen ubrukt-import-feil). Full suite `pnpm test` grønn (eksisterende registrerings-tester).

- [ ] **Step 3: Commit**
```bash
git add app/api/registrations/route.ts
git commit -m "refactor(reg): always hardcoded confirmation, drop EmailTrigger override"
```

---

### Task 2: Cron — fjern e-post-delen, behold GDPR — `app/api/cron/email-triggers/route.ts`

**Files:** Modify: `app/api/cron/email-triggers/route.ts`; Delete: `tests/cron-email-triggers-where.test.ts`

- [ ] **Step 1: Fjern where-testen (den testet B's parallelldrift-filter som nå forsvinner).**
```bash
git rm tests/cron-email-triggers-where.test.ts
```

- [ ] **Step 2: Skriv om ruta til KUN auth + de to GDPR-passene.**

Les hele fila. Fjern: `formatDate`, `osloDay`, `addDays`, `computeSendDate`, `dueRegistrationsWhere`, hele `emailTrigger.findMany`-løkka + all e-postsending (`sendTemplatedEmail`, `emailLog.create`), og imports som kun de brukte (`sendTemplatedEmail`, `MergeTagData`). BEHOLD `shouldAnonymizeChild`, `getSetting`, `prisma`, `logger`, `timingSafeEqual`. Resultatet skal være (behold de to GDPR-blokkene VERBATIM fra dagens fil — kun rammen rundt endres):
```ts
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/prisma';
import { getSetting } from '@/lib/settings';
import { shouldAnonymizeChild } from '@/lib/retention';
import logger from '@/lib/logger';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization') ?? '';
  const cronSecret = process.env.CRON_SECRET;
  // SECURITY: fail closed + constant-time comparison
  const expected = cronSecret ? `Bearer ${cronSecret}` : null;
  const authorized =
    expected !== null &&
    authHeader.length === expected.length &&
    timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected));
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    let anonymized = 0;
    let errors = 0;

    // ── GDPR retention pass (AV som standard) ───────────────────────────
    // [KOPIER VERBATIM dagens retention-blokk: les data_retention_days,
    //  hvis > 0 iterer child.findMany + shouldAnonymizeChild + child.update
    //  (name '[slettet]', birthdate null, allergies null, deletedAt) → anonymized++/errors++]

    // ── GDPR anonymous visitor purge ────────────────────────────────────
    // [KOPIER VERBATIM dagens 180-dagers visitor-purge-blokk]

    return NextResponse.json(
      { anonymized },
      { status: errors > 0 ? 500 : 200 },
    );
  } catch (error) {
    logger.error('Cron GDPR-pass feilet', { error });
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 });
  }
}
```
(De to `// [KOPIER VERBATIM ...]`-blokkene erstattes med den EKSAKTE koden fra dagens fil, linjene for retention-passet og visitor-purge — uendret logikk, samme `anonymized`/`errors`-tellere. Fjern `processed`/`sent`-tellerne fra responsen siden e-post er borte.)

- [ ] **Step 3: Verifiser.** `grep -n "emailTrigger\|emailLog\|sendTemplatedEmail\|computeSendDate\|dueRegistrationsWhere\|osloDay" app/api/cron/email-triggers/route.ts` → INGEN treff. `grep -n "shouldAnonymizeChild\|visitor.deleteMany\|appEvent.deleteMany" app/api/cron/email-triggers/route.ts` → GDPR-passene finnes fortsatt. `pnpm exec tsc --noEmit` rent; `pnpm exec eslint app/api/cron/email-triggers/route.ts` rent; full suite grønn.

- [ ] **Step 4: Commit**
```bash
git add app/api/cron/email-triggers/route.ts tests/cron-email-triggers-where.test.ts
git commit -m "refactor(cron): drop email-trigger sending, keep GDPR passes"
```

---

### Task 3: Fjern email-templates admin-UI + nav-lenke

**Files:** Delete: `app/admin/email-templates/page.tsx`, `app/admin/email-templates/[id]/page.tsx`; Modify: `app/admin/AdminShell.tsx`

- [ ] **Step 1: Slett UI-sidene.**
```bash
git rm "app/admin/email-templates/page.tsx" "app/admin/email-templates/[id]/page.tsx"
```
(Fjern også en ev. `app/admin/email-templates/new`-side hvis den finnes: `ls app/admin/email-templates/`.)

- [ ] **Step 2: Fjern nav-lenken i `AdminShell.tsx`.** Fjern linje ~55 (`'email-templates': 'E-postmaler',` i tittel-mappen) og linje ~96 (`{ href: '/admin/email-templates', label: 'E-postmaler', icon: EMAIL_ICON },` i nav-listen). Hvis `EMAIL_ICON` nå blir ubrukt, fjern også dens definisjon/import (grep for andre bruk først).

- [ ] **Step 3: Verifiser.** `ls app/admin/email-templates 2>/dev/null` → borte. `grep -rn "email-templates" app/admin` → ingen kode-treff (kun ev. i lib/email-templates.ts-import, som er en ANNEN sti — bekreft det ikke er nav). `pnpm exec tsc --noEmit` rent; `pnpm build` bygger uten sidene.

- [ ] **Step 4: Commit**
```bash
git add -A app/admin/email-templates app/admin/AdminShell.tsx
git commit -m "chore(admin): remove email-templates UI + nav link"
```

---

### Task 4: Fjern trigger-seksjonen i kurs-redigering — `app/admin/courses/[id]/edit/page.tsx`

**Files:** Modify: `app/admin/courses/[id]/edit/page.tsx` (1143 linjer; kirurgisk fjerning)

**Interfaces:** Consumes: intet. Denne siden beholder ALL annen kurs-redigering (grunndata, betalingsmåter, sletting osv.).

- [ ] **Step 1: Kartlegg trigger-koden.** Les fila. Trigger-relatert kode omfatter (linjenr. ca., verifiser i fila): interface `EmailTemplate` (~49) + `EmailTrigger` (~55); `DEFAULT_TRIGGER_SLOTS` (~74) + `TRIGGER_TYPE_LABELS` + `getTriggerLabel`/`isFixedTrigger`; trigger-state (`triggers`, `templates`, `triggersLoading`, `triggersError`, `sendingTriggerId`, `sendResult`, `newTriggerType`, `newTriggerTemplate`, `newTriggerOffset`, `addingTrigger`, `showDeleteTriggerModal`, `deleteTriggerTargetId` — ~128–143); `fetchTriggers` (~201) + dens `useEffect`-kall; alle trigger-handlers (`addTrigger`, `toggleTrigger`, `updateTriggerTemplate`, `sendTriggerNow`, `deleteTrigger` o.l. — grep `Trigger`); JSX-seksjonen som rendrer trigger-listen + «legg til trigger»-skjema + slett-trigger-modal.

- [ ] **Step 2: Fjern all trigger-kode.** Slett de kartlagte delene. Etter fjerning:
  - Ingen referanse til `EmailTrigger`/`EmailTemplate`/`/api/admin/email-triggers`/`/api/admin/email-templates` igjen i fila.
  - Alt annet på siden (kurs-form-state, lagring, betalingsmåter, sletting av kurs) er URØRT og fungerer.
  - Fjern ubrukte imports som ble stående igjen.

- [ ] **Step 3: Verifiser.** `grep -n "trigger\|Trigger\|email-templates\|EmailTemplate" "app/admin/courses/[id]/edit/page.tsx"` → INGEN treff (case-insensitivt: `grep -in`). `pnpm exec tsc --noEmit` rent; `pnpm exec eslint "app/admin/courses/[id]/edit/page.tsx"` rent (ingen ubrukt state/var/import); `pnpm build` OK.

- [ ] **Step 4: Commit**
```bash
git add "app/admin/courses/[id]/edit/page.tsx"
git commit -m "chore(admin): remove email-trigger section from course edit"
```

---

### Task 5: Slett email-triggers + email-templates admin-API

**Files:** Delete: `app/api/admin/email-triggers/route.ts`, `app/api/admin/email-triggers/[id]/route.ts`, `app/api/admin/email-triggers/[id]/send/route.ts`, `app/api/admin/email-templates/route.ts`, `app/api/admin/email-templates/[id]/route.ts`, `app/api/admin/email-templates/preview/route.ts`

- [ ] **Step 1: Slett API-rutene** (nå ubrukt — UI-en og alle kallere er fjernet i Task 1–4).
```bash
git rm "app/api/admin/email-triggers/route.ts" \
       "app/api/admin/email-triggers/[id]/route.ts" \
       "app/api/admin/email-triggers/[id]/send/route.ts" \
       "app/api/admin/email-templates/route.ts" \
       "app/api/admin/email-templates/[id]/route.ts" \
       "app/api/admin/email-templates/preview/route.ts"
```
Fjern tomme mapper hvis igjen (`ls app/api/admin/email-triggers app/api/admin/email-templates`).

- [ ] **Step 2: Verifiser ingen gjenværende referanser til rutene** (modellene lever fortsatt i schema — det er OK, Task 7 fjerner dem):
`grep -rn "/api/admin/email-triggers\|/api/admin/email-templates" app` → INGEN treff. `pnpm exec tsc --noEmit` rent; `pnpm build` OK.

- [ ] **Step 3: Commit**
```bash
git add -A app/api/admin/email-triggers app/api/admin/email-templates
git commit -m "chore(api): remove email-triggers + email-templates admin routes"
```

---

### Task 6: Fjern død `sendTemplatedEmail` — `lib/mail.ts`

**Files:** Modify: `lib/mail.ts`

- [ ] **Step 1: Bekreft at `sendTemplatedEmail` ikke har flere kallere** (etter Task 1/2/5):
`grep -rn "sendTemplatedEmail" app lib scripts` → treff KUN i `lib/mail.ts` (definisjonen). Hvis noe annet dukker opp, STOPP og rapporter.

- [ ] **Step 2: Slett funksjonen `export async function sendTemplatedEmail(...)` (~linje 327 t.o.m. dens `}`).** Behold ALT annet i fila (`sendMail`, `getSiteName`, `wrapEmailHtml`, `replaceMergeTags`-import, alle andre sendere). Fjern `MergeTagData`-importen KUN hvis den ikke lenger brukes i fila (grep i fila først — den kan brukes av andre signaturer).

- [ ] **Step 3: Verifiser.** `grep -rn "sendTemplatedEmail" app lib scripts` → INGEN treff. `pnpm exec tsc --noEmit` rent; `pnpm exec eslint lib/mail.ts` rent; full suite grønn.

- [ ] **Step 4: Commit**
```bash
git add lib/mail.ts
git commit -m "chore(mail): remove dead sendTemplatedEmail"
```

---

### Task 7: Fjern modellene fra schema + gated DROP-migrering

**Files:** Modify: `prisma/schema.prisma`; Create: `scripts/course-legacy-drop.sql`

**Interfaces:** Forutsetter at INGEN kode refererer `EmailTemplate`/`EmailTrigger`/`EmailLog` lenger (Task 1–6).

- [ ] **Step 1: Bekreft null kode-referanser** (utenfor schema): `grep -rn "EmailTrigger\|emailTrigger\|EmailTemplate\|emailTemplate\|EmailLog\|emailLog" app lib scripts` → INGEN treff. Hvis noe gjenstår, STOPP (en tidligere task er ufullstendig).

- [ ] **Step 2: Fjern modellene + revers-relasjonene i `prisma/schema.prisma`.** Slett `model EmailTemplate {...}`, `model EmailTrigger {...}`, `model EmailLog {...}`. Fjern `emailTriggers EmailTrigger[]` fra `model Course` (~linje 153) og `emailLogs EmailLog[]` fra `model Registration` (~linje 240). **BEHOLD** `flowEnrollments FlowEnrollment[]` på begge (fra delprosjekt A).

- [ ] **Step 3: Sync dev-klient.** `pnpm prisma db push` — den vil melde at `email_templates`/`email_triggers`/`email_logs` slettes; **aksepter data-loss i DEV** (`--accept-data-loss` hvis den krever flagg). Så `pnpm prisma generate`.

- [ ] **Step 4: Skriv den gated prod-DROP-SQL-en `scripts/course-legacy-drop.sql`:**
```sql
-- ⚠️ IRREVERSIBELT — delprosjekt C. Kjøres SIST, av Basefarm, og KUN NÅR:
--   (1) kurs-livssyklus-flyten (delprosjekt B) er aktivert i prod,
--   (2) paritet er bevist, og
--   (3) e-posthistorikken (email_logs) er arkivert eller ikke lenger nødvendig.
-- IKKE kjør sammen med kode-deployen. Rekkefølge følger FK-avhengighetene.
DROP TABLE IF EXISTS email_logs;
DROP TABLE IF EXISTS email_triggers;
DROP TABLE IF EXISTS email_templates;
```

- [ ] **Step 5: Verifiser.** `pnpm exec tsc --noEmit` rent (Prisma-klienten har ikke lenger modellene → all gjenværende kode kompilerer); full suite grønn; `pnpm build` OK.

- [ ] **Step 6: Commit**
```bash
git add prisma/schema.prisma scripts/course-legacy-drop.sql
git commit -m "chore(schema): remove EmailTrigger/EmailTemplate/EmailLog models + gated drop SQL"
```

---

### Task 8: Finish — full verifikasjon + live smoke + runbook

**Files:** Modify: `docs/deploy-runbook.md`

- [ ] **Step 1: Full verifikasjon.** `pnpm exec tsc --noEmit` (rent), `pnpm test` (rapporter eksakt antall), `pnpm build` (OK). Global grep-fravær: `grep -rn "EmailTrigger\|emailTrigger\|EmailTemplate\|emailTemplate\|EmailLog\|emailLog\|sendTemplatedEmail" app lib scripts prisma` → INGEN treff (bortsett fra ev. i denne planen/spec-dokumentene, som er docs).

- [ ] **Step 2: Live smoke (tsx, selvryddende).** Skriv `scripts/smoke-retire-legacy.ts` (IKKE commit) som:
  1. Bekrefter at Prisma-klienten IKKE har `emailTrigger`/`emailTemplate`/`emailLog`-modellene (f.eks. `('emailTrigger' in prisma) === false`) — beviser modell-fjerning.
  2. Kaller cron-ruta sin GET-handler (eller via `fetch` mot dev-server hvis oppe) med gyldig `CRON_SECRET` → `200` med `{ anonymized }` (ingen e-post-felter), og bekrefter at et syntetisk barn med `data_retention_days`-oppsett anonymiseres HVIS satt (eller bare at ruta svarer 200 uten å røre e-post). Rydd opp ev. fixtures.
  3. (Registrering-bekreftelse dekkes av at `sendRegistrationConfirmation` fortsatt kalles — verifiser via en enkel enhets-lignende sjekk eller bekreft grep at ruta kun har den stien.)
  Rapporter PASS/FAIL, rydd opp.

Run: `npx tsx scripts/smoke-retire-legacy.ts` (alle PASS), `rm scripts/smoke-retire-legacy.ts`.

- [ ] **Step 3: Oppdater runbooken.** I `docs/deploy-runbook.md`:
  - Legg til et tydelig **⚠️ gating-avsnitt**: «Delprosjekt C (legacy-fjerning) må deployes ETTER at kurs-livssyklus-flyten er aktivert i prod og paritet er bevist. `scripts/course-legacy-drop.sql` er IRREVERSIBEL og kjøres som ALLER SISTE steg, separat fra kode-deployen, kun når e-posthistorikken ikke lenger trengs.»
  - Noter at cron-ruta `cron-email-triggers` nå KUN kjører GDPR-passene (URL uendret; Azure-timer uendret).

- [ ] **Step 4: Commit**
```bash
git add docs/deploy-runbook.md
git commit -m "docs: retire-legacy gating + drop-SQL in runbook"
```

---

## Self-Review

**Spec-dekning:** §1 registration_confirmed hardkodet → Task 1; §2 cron strip + GDPR behold → Task 2; §3 admin-API+UI fjernet → Task 3 (email-templates UI+nav) + Task 4 (kurs-redigering trigger) + Task 5 (API-ruter); §4 død sendTemplatedEmail → Task 6; §5 schema + gated DROP → Task 7; §6 testing+runbook+smoke → Task 8 (+ per-task grep/build); ⚠️ gating → plan-header + Task 7/8 + runbook. Alle spec-seksjoner dekket.

**Placeholder-scan:** De to `// [KOPIER VERBATIM ...]`-markørene i Task 2 er BEVISSTE instruksjoner om å kopiere eksisterende, uendret kode (retention/purge-blokkene) fra den faktiske fila — ikke manglende innhold; implementeren har fila foran seg. Alle andre steg har konkret kode/kommando. Ingen TBD/TODO.

**Type-konsistens:** Rekkefølgen (kode-refs fjernet Task 1–6 FØR modellene Task 7) holder tsc grønt hele veien. `sendRegistrationConfirmation`/`sendRegistrationAdminNotification` (Task 1) er uendrede eksisterende signaturer. Cron beholder `shouldAnonymizeChild`/`getSetting` (Task 2). `flowEnrollments`-relasjonen (A) beholdes eksplisitt (Task 7). Ingen ny type introdusert.
