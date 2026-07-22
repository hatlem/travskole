# Dato-forankret planlegging + kurs-forankret enrollment — Design Spec (delprosjekt A)

*Første delprosjekt i migreringen av legacy kurs-`EmailTrigger` inn i flyt-motoren. Leverer motor-fundamentet: evnen til å planlegge et flyt-steg relativt til en absolutt ankerdato (kursets start/slutt) og å ankre en enrollment til et kurs/registrering. Ingen UI, ingen «ved registrering → enroll»-wiring, ingen datamigrering — de hører til delprosjekt B/C.*

## Kontekst

**Legacy-systemet som skal erstattes (over B+C):** `EmailTrigger` (kurs-scopet, dato-forankret) kjøres av `app/api/cron/email-triggers/route.ts`. Trigger-typer: `registration_confirmed` (sendes inline ved registrering, ikke via cron), `reminder_before` (−N dager fra `course.startDate`), `welcome_start` (start), `midway` (halvveis start→slutt), `after_end` (+N fra `endDate`), `custom_before/after_start/end`. Dedupe via `EmailLog @@unique([triggerId, registrationId])`. Oslo-dag + catch-up-semantikk (forfalt anker sendes én gang). Samme cron kjører også to GDPR-pass (barn-anonymisering + besøks-purge) som **ikke** er e-post-triggere og skal overleve pensjoneringen i C.

**Motorens gap:** Flyt-motorens `wait`-node er enrollment-relativ (`sleep` til `enteredAt + varighet`). Den kan ikke uttrykke «3 dager før kursets faste startdato». `FlowEnrollment` er (flyt, kontakt) med maks-én-aktiv via partiell unik indeks `flow_enrollments_one_active`. Runneren er lease-basert (`SKIP LOCKED`, `nextRunAt`-kø, 5-min Azure-timer `cron-flows`).

**Denne spec-en lukker gapet** med minimal, gjenbrukbar motor-endring: kurs-forankret enrollment + en ny `schedule`-node som gjenbruker runnerens eksisterende `sleep`-maskineri.

**Non-goals:** canvas-editor-UI for `schedule`-noden; «ved registrering → opprett enrollment»-wiring; migrering av eksisterende `EmailTrigger`/`EmailTemplate`-data; fjerning av legacy. Ingen endring i dagens markedsførings-flyt-atferd.

## 1. Schema — `FlowEnrollment` + migrering

To nye nullbare kolonner på `FlowEnrollment`:
- `courseId Int?` `@map("course_id")` — relasjon til `Course`, `onDelete: SetNull` (filtrering/visning; overlever ikke kurs-sletting men enrollment gjør).
- `registrationId Int?` `@map("registration_id")` — relasjon til `Registration`, `onDelete: Cascade` (anker + unikhet + flettefelt; slettes registreringen, slettes enrollmenten).

Tilhørende revers-relasjoner på `Course` og `Registration` (`flowEnrollments FlowEnrollment[]`).

**Ny SQL-migrering `scripts/course-flows-migration.sql`** (additiv, Basefarm-kjørt, i stil med `scripts/flow-engine-migration.sql`):
1. `ALTER TABLE flow_enrollments ADD COLUMN course_id INT NULL`, `ADD COLUMN registration_id INT NULL`, med FK-er (`ON DELETE SET NULL` / `ON DELETE CASCADE`).
2. **Erstatt** `flow_enrollments_one_active` med to partielle unike indekser:
   - `flow_enrollments_one_active` (markedsføring, uendret semantikk): `UNIQUE (flow_id, contact_id) WHERE registration_id IS NULL AND status = 'active'`.
   - `flow_enrollments_one_active_reg` (kurs): `UNIQUE (flow_id, registration_id) WHERE registration_id IS NOT NULL AND status = 'active'`.
3. Indeks for filtrering: `(course_id)`, `(registration_id)`.

Prisma-skjemaet kan ikke uttrykke partielle indekser (som i dag) — de lever kun i SQL-en. Skjemaet får kolonnene + relasjonene; `schema.prisma`-kommentaren oppdateres til å peke på begge indeksene.

## 2. Ny node-type `schedule`

`FlowNodeType` i `lib/flows/graph.ts` utvides: `'start' | 'email' | 'wait' | 'condition' | 'action' | 'end' | 'schedule'`.

**Config (JSON på `FlowNode.config`):** `{ "anchor": "course_start" | "course_end" | "course_midway", "offsetDays": number }`.

**Graf-validering** (`validateFlow`): `anchor` må være én av de tre; `offsetDays` må være et heltall (kan være negativt). Ugyldig ⇒ valideringsfeil `schedule_config` (samme mønster som dagens `wait_config`). En `schedule`-node har nøyaktig én utgående kant (som `wait`/`email`).

**Step-planlegging** (`lib/flows/step.ts`): en `schedule`-node returnerer `{ kind: 'sleep', until, nextNodeId }` — **samme plan-form som `wait`**. Kun `until`-beregningen skiller seg (seksjon 3). Runneren (`lib/flows/runner.ts`) er dermed uendret: den setter `nextRunAt = until` og gjenopptar ved neste tick.

## 3. Anker-beregning (ren funksjon)

Ny modul `lib/flows/schedule.ts` med to rene funksjoner (speiler `computeSendDate`/`osloDay` fra dagens cron, som gjenbrukes/utvinnes ved behov):

```
computeAnchorDay(anchor, offsetDays, startDate: Date | null, endDate: Date | null): string | null
  course_start  → osloDay(startDate) + offsetDays   (null hvis startDate == null)
  course_end    → osloDay(endDate) + offsetDays      (null hvis endDate == null)
  course_midway → osloDay(startDate + floor((endDate−startDate)/2 dager))  (null hvis start ELLER end == null)
  returnerer en 'YYYY-MM-DD' Oslo-kalenderdag, eller null hvis uberegnelig.

osloDayStartUtc(osloDay: 'YYYY-MM-DD'): Date
  → UTC-instant for 00:00 Europe/Oslo den kalenderdagen (DST-trygg via Intl-offset-beregning).
```

`until` = `osloDayStartUtc(computeAnchorDay(...))`. Offset-aritmetikk gjøres på Oslo-kalenderdagen (ikke på råtid), så «−3 dager» alltid lander på riktig kalenderdag uavhengig av DST — konsistent med legacy `addDays`+`osloDay`.

**Catch-up:** en anker i fortiden gir en `until` i fortiden ⇒ enrollmentens `nextRunAt` er allerede forfalt ⇒ runneren plukker den ved neste tick og sender. **Idempotens** kommer gratis fra send-nodens eksisterende `MessageSend`-dedupe (`dedupeKeyFor(enrollment, node)`) — en `schedule→email`-sekvens sender nøyaktig én gang selv om anker var forfalt. Ingen `EmailLog`-ekvivalent trengs.

**Uberegnelig anker (`null`):** step-planleggeren returnerer i stedet en rolig exit — enrollment settes `status:'exited'` med en logget grunn (f.eks. «schedule: kurs mangler dato for anker course_end»), ingen e-post, blokkerer ikke. Samme utfall hvis en `schedule`-node nås av en enrollment **uten** `registrationId`/kurs-anker (feilkonfigurert markedsførings-flyt).

## 4. Kurs-flettekontekst (live, fra `registrationId`)

Ny resolver i send-laget (`lib/flows/send.ts` eller ny `lib/flows/course-merge.ts`):

```
resolveCourseMergeContext(registrationId: number): Promise<Record<string, string> | null>
```

Live join `registration → child, parent(→user), course`. Returnerer nøyaktig legacy-flettefeltene (så migrerte `EmailTemplate`-kropper i delprosjekt B rendrer identisk):
`forelder_navn`, `barnets_navn` (fallback foreldrenavn for voksen-kurs), `kurs_navn`, `kurs_startdato`, `kurs_sluttdato` (tom streng uten sluttdato), `allergier` («Ingen» uten), `kontakt_epost` (fra `contact_email`-setting). Dato-format `nb-NO` `dd.mm.yyyy` som legacy.

Send-laget slår denne konteksten **inn i** dagens kontakt-flettefelt-map **kun når** enrollmentens `registrationId` er satt. Alt leses live ved send (ingen snapshot). `null` er en defensiv sti (kun nåbar i et race der registreringen slettes midt i et tick — normalt cascade-sletter en registrering enrollmenten): send-laget faller da tilbake til kontakt-only-flettefelt, best-effort, kaster ikke.

## 5. Enroll-primitiv + rolig exit

`lib/flows/enroll.ts` utvides:
- Enroll-funksjonen tar imot valgfrie `courseId`/`registrationId` og lagrer dem på `FlowEnrollment`.
- Ny unikhet håndheves: kode-sjekk (`hasActiveEnrollment` scopet på `registrationId` når satt, ellers `contactId` som i dag) + fallback-fangst av `P2002` fra `_reg`-indeksen (samme mønster som dagens `flow_enrollments_one_active`-fallback).
- Dagens markedsførings-enroll (uten `registrationId`) er **uendret** i oppførsel.

Rolig exit (seksjon 3) implementeres i runner/step-laget: når step-planen for en `schedule`-node ikke kan beregne `until`, settes enrollment `exited` + grunn, i stedet for `sleep`.

## 6. Testing

- **Enhet** (`lib/flows/schedule.ts`): `computeAnchorDay` for alle legacy-ekvivalente tilfeller (`reminder_before`/`welcome_start`/`midway`/`after_end`/`custom_*` via anker+offset), DST-grensetilfeller (mars/oktober), `midway`-halvering, manglende start/slutt → `null`. `osloDayStartUtc` gir riktig UTC-instant over DST.
- **Enhet** (graf): `validateFlow` godtar gyldig `schedule`-config, avviser ugyldig anker/`offsetDays`.
- **Enhet** (enroll): kurs-forankret enroll lagrer `courseId`/`registrationId`; to registreringer for samme kontakt i samme flyt får to aktive enrollments; duplikat registrering → P2002-fallback; markedsførings-enroll uendret.
- **Enhet** (merge-resolver): korrekte felter for barn-kurs vs voksen-kurs; manglende sluttdato/allergier → riktige defaults; slettet registrering → `null`.
- **Integrasjon** (runner): syntetisk flyt `start → schedule → email → end`, enrollment med `registrationId` mot et kurs med datoer satt relativt til `now`; driv runneren; verifiser `nextRunAt` = beregnet `until`, at forfalt anker sender nøyaktig én gang (catch-up + dedupe), og at kurs-flettefelt er løst i sendt e-post. Uberegnelig anker → enrollment `exited`, ingen send.

## Testing & utrulling

Rene deler (`schedule.ts`, graf-validering, merge-resolver) TDD-es med tabelltester; enroll/runner via tsc + suite + build + live smoke mot dev-DB (syntetisk kurs+registrering+flyt, verifiser radstatus/nextRunAt/send, rydd opp). **Én ny additiv SQL-migrering** (`scripts/course-flows-migration.sql` — kolonner + partielle indekser; Basefarm, i deploy-runbooken), ingen nye env-vars. Følger prod ved neste ordinære deploy. Runbooken oppdateres med migreringen. Ingen atferdsendring for eksisterende markedsførings-flyter.
