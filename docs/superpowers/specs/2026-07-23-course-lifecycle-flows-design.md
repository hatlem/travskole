# Kurs-livssyklus-flyter — Design Spec (delprosjekt B)

*Andre delprosjekt i migreringen av legacy kurs-`EmailTrigger` inn i flyt-motoren. Bygger på delprosjekt A (dato-forankret `schedule`-node + kurs-forankret enrollment). Kobler påmeldinger inn i én delt livssyklus-flyt, gir schedule-noden canvas-UI, og lar flyt + legacy sameksistere trygt (per-registrering-eierskap) til paritet er bevist. Delprosjekt C fjerner legacy.*

## Kontekst & valg

**Produktmodell (valgt): Model 1 — ÉN delt kurs-livssyklus-flyt.** Én global flyt betjener alle kurs; kursnavn/datoer/barn fylles inn per påmelding via live kurs-flettefelt (delprosjekt A). Alternativet (én flyt per kurs, auto-provisjonert) ble forkastet: det innfører et provisjonerings-system og underutnytter A. Per-kurs-forskjeller kan uttrykkes med betingelse-noder ved behov; kurs uten sluttdato hopper automatisk over `midway`/`etter-slutt` (schedule exiter rolig).

**`registration_confirmed` forblir inline/umiddelbar** (synkron ved innsending + admin-varsel, nøyaktig som i dag) — folk forventer øyeblikkelig kvittering. Kun de dato-baserte triggerne flyttes til flyten.

**Registrering→enroll er event-drevet.** `registration.created` fires allerede på bussen ved påmelding med `meta:{registrationId,courseId,courseName}` (finnes i taksonomien). Vi gjenbruker det.

**Non-goals:** fjerning av `EmailTrigger`/`EmailTemplate`/`EmailLog`/legacy-cronens sende-del (→ delprosjekt C); datamigrering av eksisterende maltekst (seeden bruker standard-kopi; C rydder legacy-data); endring av `registration_confirmed`-inline-stien; endring av dagens markedsførings-flyt-atferd.

## 1. Arkitektur (dataflyt)

```
Påmelding → registration.created (meta: registrationId, courseId, courseName)
          → enrollFromEvent → [flow.anchorMode==='course' + meta har ids]
          → enrollCourseRegistration(livssyklusflyt, contactId, courseId, registrationId)
          → runner: schedule-kjede (påminnelse→velkomst→halvveis→etter-slutt) via kurs-anker
Legacy-cron (dato-seksjon): hopper over registreringer som ALLEREDE har en flyt-enrollment
```

## 2. `Flow.anchorMode` + `enrollFromEvent`-utvidelse

Ny kolonne `Flow.anchorMode String @default("contact") @map("anchor_mode")` — `'contact'` (dagens flyter, uendret) | `'course'` (kurs-forankret). Additiv migrering (`scripts/course-lifecycle-migration.sql` + `db push`).

`lib/flows/enroll.ts` — `enrollFromEvent` utvides: hent `anchorMode` sammen med triggerne (join på flyt), og for hver matchet flyt:
- Hvis `flow.anchorMode === 'course'` OG `meta.registrationId` + `meta.courseId` er gyldige heltall → `enrollCourseRegistration(flowId, contactId, courseId, registrationId)`.
- Ellers → `enrollContact(flowId, contactId)` (uendret).

`enrollFromEvent` matcher fortsatt KUN aktive flyter (uendret) — dette er kjernen i parallelldrift-sikkerheten (seksjon 4). Fire-safe kontrakt uendret (kaster aldri).

## 3. Seedet livssyklus-flyt

Idempotent seed (`scripts/seed-course-lifecycle-flow.ts`, i stil med SenderIdentity-seeden; kjøres én gang, no-op hvis flyten finnes). Oppretter:
- Én `Flow` `{ name: 'Kurs-livssyklus', anchorMode: 'course', isMarketing: false, status: 'draft' }` (starter draft → aktiveres manuelt av admin når klar).
- Én `FlowTrigger` `{ eventType: 'registration.created', filter: '{}' }` (alle kurs; filter tomt).
- Lineær node-kjede i kronologisk ankerrekkefølge:
  `start → schedule(course_start,−3) → email(påminnelse) → schedule(course_start,0) → email(velkomst) → schedule(course_midway,0) → email(halvveis) → schedule(course_end,+1) → email(etter-slutt) → end`
- Én verifisert `SenderIdentity` (default avsender) på email-nodene.
- Standard norsk kopi på email-nodene (gjenbruker legacy-standardmalenes tekst; flettefelt `{{barnets_navn}}`/`{{kurs_navn}}`/`{{kurs_startdato}}` osv.).

Admin redigerer flyten som en hvilken som helst flyt (aktiver/paus/rediger noder). Catch-up (A): en påmelding gjort etter en ankerdag → den schedule-noden er forfalt → sendes umiddelbart én gang, så fortsetter kjeden — matcher legacy.

## 4. Parallelldrift-sikkerhet (per-registrering-eierskap)

**Mål:** flyt og legacy kjører samtidig i kodebasen uten at en registrering får en dato-basert e-post fra BEGGE.

**Mekanisme:** legacy-cronens dato-seksjon (`app/api/cron/email-triggers/route.ts`, registrerings-spørringen) får ETT nytt filter: `flowEnrollments: { none: {} }` — hopp over registreringer som har en flyt-enrollment (uansett status). (Relasjonen `Registration.flowEnrollments` finnes fra delprosjekt A.)

**Hvorfor det er trygt (per-registrering XOR):**
- Livssyklusflyten `draft`/`paused` → `enrollFromEvent` matcher den ikke (kun aktive) → ingen registreringer flyt-enrolles → legacy håndterer alt (nytt filter er no-op).
- Admin **aktiverer** flyten → nye påmeldinger flyt-enrolles → legacy hopper over *dem*; eksisterende påmeldinger (fra før aktivering) har ingen enrollment → legacy fullfører *dem*.
- Hver registrering eies dermed av nøyaktig ETT system. Null dobbel-send, null backfill.

**Merk (bevisst):** en `exited` flyt-enrollment (f.eks. kurs uten datoer) teller også som «eid av flyt» → legacy hopper over. Det er korrekt: legacy ville uansett ikke sendt dato-baserte e-poster for et datoløst kurs.

«Prove parity» = aktiver flyten, følg nye påmeldinger gjennom den (sporing/`MessageSend`-rader/tidslinje) mens legacy trygt fullfører de gamle. Delprosjekt C fjerner legacy-cronens sende-del + `EmailTrigger`-modellene når trygt.

## 5. Schedule-node canvas-UI (utsatt fra A)

`app/admin/crm/flyter/[id]/` (React Flow-editor):
- Legg `'schedule'` tilbake i `NODE_TYPE_ORDER` (draggbar palett) + gjenopprett `ScheduleNode`-komponenten + `nodeTypes`-registreringen (revertert i A's Task 3-fix).
- Config-panel for schedule-noden i node-inspektoren: anker-nedtrekk med de TRE ankerne (`Kursstart` = course_start / `Halvveis` = course_midway / `Kursslutt` = course_end) + et `offsetDays`-tallfelt (heltall; negativt = før ankeret, positivt = etter — f.eks. anker `Kursstart` med offset `−3` = «3 dager før kursstart»). Følger samme mønster som eksisterende node-config-paneler (wait/email/condition/action). (Merk: «før/etter» uttrykkes med offset-fortegn, ikke som egne anker-valg — det matcher datamodellens tre ankere fra A.)
- Validering finnes allerede (delprosjekt A, `validateScheduleConfig`, kode `schedule_config`).

## 6. Testing & scope-grense

- **Enhet:** `enrollFromEvent` course-anchor-gren (anchorMode course + gyldig meta → `enrollCourseRegistration`; manglende/ugyldig meta → fallback contact; contact-flyt uendret). Legacy-cron `flowEnrollments: { none: {} }`-filteret (registrering med enrollment hoppes over; uten enrollment tas med). Seed-idempotens (andre kjøring = no-op). Schedule-config-panel (anker/offset lagres/leses).
- **Integrasjon/live-smoke (tsx, selvryddende):** `registration.created` for en kurs-påmelding → flyt-enrollment opprettes (kurs-forankret); driv runneren → schedule-kjeden sender e-postene i kronologisk rekkefølge med kurs-flettefelt løst; legacy-cron-spørringen returnerer IKKE den flyt-eide registreringen. Rydd opp, verifiser.
- **Testarkitektur:** vitest-suiten forblir DB-uavhengig (mock Prisma), live E2E via tsx-smoke (samme konvensjon som delprosjekt A).
- **Migrering/env:** én ny additiv SQL (`Flow.anchor_mode`-kolonne) + en seed-kjøring; ingen nye env-vars. Runbook oppdateres (migrering + seed-steg + «aktiver livssyklusflyten når klar»).
- **B inkluderer IKKE:** fjerning av legacy (→ C); datamigrering av maltekst (→ C).
