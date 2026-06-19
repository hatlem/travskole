# Konsolidering: dobbeltsulky → «forespørsel»-arrangement

**Dato:** 2026-06-19
**Status:** Godkjent design (klar for implementeringsplan)
**Kontekst:** Bjerke Travskole påmeldingsplattform (Next.js 16, Prisma + PostgreSQL, Azure/Basefarm)

## Bakgrunn og mål

I dag er dobbeltsulky-booking et eget delsystem ved siden av arrangementer: egen
`BookingRequest`-tabell, eget endepunkt `/api/dobbeltsulky` (uten rate limiting),
egen offentlig side `/arrangementer/dobbeltsulky`, egen admin-side
`/admin/dobbeltsulky` og egne `Setting`-nøkler. Publikum ser det allerede som et
arrangement-kort, men backend er en parallell kodevei.

**Mål:** Gjøre dobbeltsulky til *bare et arrangement* med en ny registreringsmodus
(«forespørsel»/avtal tid), slik at det egne delsystemet forsvinner. Dette samler én
kodevei, lukker rate-limit-hullet (audit), og lar plattformen senere tilby flere
«avtal tid»-tilbud (privattimer, stallbesøk) uten ny bespoke kode.

**Suksesskriterier:**
- Dobbeltsulky fungerer som før (forespørsel med kontaktinfo + e-post), men som et arrangement.
- `/api/dobbeltsulky`, `/arrangementer/dobbeltsulky`, `/admin/dobbeltsulky` og dobbeltsulky-`Setting`-nøklene er fjernet.
- Admin kan opprette nye forespørsel-arrangementer uten utvikler.
- Forespørsels-innsending er rate-limited og fanger samtykker.

## Beslutninger (avklart med bruker)

1. **To registreringsmodi** på arrangement: `standard` (dagens påmelding) og `request` (forespørsel).
2. **Aldri anonymt:** forespørsel samler *alltid* kontaktinfo (navn/e-post/telefon). Per arrangement velger admin om innlogging også kreves (`requestRequiresLogin`).
3. **Samtykker er admin-valgte** per forespørsel-arrangement (risiko/forsikring, media, aktivitet, vilkår). Risiko + vilkår er på som standard (kjøring på eget ansvar).
4. **`startDate` gjøres nullbar** (renest modell — et «avtal tid»-arrangement har ingen fast dato). Krever gjennomgang av spørringer som antar ikke-null dato.
5. **Tilnærming 1** (av tre vurderte): behold to små, veldefinerte modeller — `Registration` = påmelding/plass, `BookingRequest` = forespørsel/lead — i stedet for å slå alt sammen til `Registration` (uthuler invarianter) eller bare tråkle dagens `BookingRequest` inn i UI-et (konsoliderer ikke).

## Datamodell

### `Course` (arrangement) — nye felt
- `registrationMode String @default("standard")` — `"standard"` | `"request"`.
- `requestRequiresLogin Boolean @default(false)` — kun relevant ved `request`.
- `requestConsentRisk Boolean @default(true)` — vis risiko/forsikrings-samtykke.
- `requestConsentTerms Boolean @default(true)` — vis vilkårs-samtykke.
- `requestConsentMedia Boolean @default(false)` — vis media-samtykke.
- `requestConsentActivities Boolean @default(false)` — vis aktivitets-samtykke.
- `startDate DateTime?` — endres fra påkrevd til **nullbar**.

### `BookingRequest` — nye felt
- `courseId Int?` (FK til `Course`, indeksert) — knytter forespørselen til arrangementet. Nullbar for å tåle eventuelle historiske rader, men settes alltid for nye.
- `userId Int?` (FK til `User`, nullbar) — settes når `requestRequiresLogin` og bruker er innlogget.
- `consentRisk`, `consentTerms`, `consentMedia`, `consentActivities` — `Boolean @default(false)`, lagrer hva som faktisk ble samtykket.
- Beholder: `name`, `email`, `phone`, `participants`, `preferredDate`, `message`, `status`.

Begrunnelse for to modeller: en forespørsel uten innlogging kan ikke være en
`Registration` (krever `parentId`). Å gjøre `Registration` sine relasjoner nullbare
ville svekke påmeldingsmodellens invarianter. `BookingRequest` forblir den lette
lead-entiteten, nå koblet til arrangementet.

## Offentlig flyt

- **Lister/forside:** request-arrangementer vises som vanlige `CourseCard` med «Avtal tid»-badge (+ «For barn/voksne»-badge — lukker audit-funn om manglende målgruppe på kort). Uten dato sorteres de etter `createdAt`, etter daterte arrangementer.
- **Detaljside:** `standard` → dagens påmeldingsknapp/-flyt; `request` → «Send forespørsel»-skjema.
- **Forespørsels-skjema:** alltid navn/e-post/telefon + antall + ønsket dato (valgfri) + melding (valgfri) + de samtykkene arrangementet har skrudd på. Når `requestRequiresLogin`: krev innlogging først (gjenbruk eksisterende auth-flyt; forhåndsfyll kontaktinfo fra konto). Ellers vis kontaktinfo-felt direkte.
- **Etter innsending:** bekreftelsesside + e-post (gjenbruk `sendBookingConfirmation`/`sendBookingAdminNotification`, gjort arrangement-bevisste slik at arrangementsnavn vises). GTM: ny `foresporsel_sendt`-dataLayer-event for konsistent konverteringssporing.

## Admin

- **Opprett/rediger arrangement** (`/admin/courses/new` + `[id]/edit`): nytt felt **«Registreringsmodus»** (Påmelding | Forespørsel). Når Forespørsel velges: vis «Krev innlogging»-bryter + samtykke-avhuking; skjul `maxParticipants`/kapasitet og gjør `startDate` valgfri i skjemaet.
- **Forespørsler:** dagens `/admin/dobbeltsulky` erstattes av en generell **«Forespørsler»-side** som lister alle `BookingRequest` med tilhørende arrangement, filtrerbar på arrangement, med status (ny/bekreftet/avlyst) som i dag.

## Konsolidert endepunkt + opprydding

- **Nytt `/api/bookings`** (arrangement-bevisst): zod-validering, **rate limiting** (lukker audit-hullet), samtykke-lagring, valgfri auth (avvis/redirect ved `requireLogin` uten sesjon), 404/400 hvis arrangementet ikke finnes eller ikke er `request`-modus. Erstatter `/api/dobbeltsulky`.
- **Fjernes:** `/api/dobbeltsulky`, `Setting`-nøklene `dobbeltsulky_enabled`/`dobbeltsulky_description`/`dobbeltsulky_points` + deres admin-UI, `/arrangementer/dobbeltsulky`, `/admin/dobbeltsulky`, og dobbeltsulky-spesifikk kode i `app/arrangementer/page.tsx` / `app/api/settings/public/route.ts` / `lib/settings*.ts` / `lib/strings.ts`.
- **`startDate`-gjennomgang:** oppdater kode som antar ikke-null `startDate` til å tåle null: forside (`app/page.tsx`), arrangementsliste (`app/arrangementer/page.tsx`), `app/sitemap.ts`, `CourseCard`-sortering, og `@@index([status, startDate])`. Daterte arrangementer sorteres som før; udaterte (request) sorteres etter `createdAt`.

## Migrering

- **Skjema:** én Prisma-migrasjon med alle nye `Course`- og `BookingRequest`-felt + `startDate` nullbar.
- **Data:** engangsskript som (a) oppretter dobbeltsulky-arrangementet fra dagens `dobbeltsulky_*`-innstillinger (`Course`, `registrationMode="request"`, `requestRequiresLogin=false`, risiko+vilkår på, beskrivelse/punkter inn i `description`), og (b) setter `courseId` på eksisterende `BookingRequest`-rader til det nye arrangementet.
- **Brannmur:** PostgreSQL er stengt for vår IP. Migrasjon + dataskript kjøres i **ett** avtalt Basefarm-vindu. Dette er et naturlig tidspunkt å gå fra `prisma db push` til en versjonert `prisma migrate`-migrasjon i repoet (audit-item).

## Feilhåndtering

- Skjemaet viser faktisk server-feilmelding (ikke generisk `alert()`) — lukker audit-funn.
- Rate limiting på `/api/bookings`.
- `requireLogin` uten sesjon → redirect til innlogging med retur-URL.
- Ugyldig/avslått arrangement (ikke request-modus, finnes ikke) → tydelig 400/404.

## Testing

- vitest: enhetstester for modus-forgrening (standard vs request) og samtykke-gating for request (hvilke samtykker kreves gitt arrangementets flagg).
- `tsc --noEmit` + testsuite grønt før deploy.
- Manuell verifisering av begge forespørsels-varianter (uten/med innlogging) i staging/lokalt.

## Utenfor scope (YAGNI)

- Ingen endring i standard påmeldingsflyt utover `startDate`-nullbarhet og badge-visning.
- Ingen generell «samtykke-konfig» for standard-arrangementer (kun request-modus får per-arrangement samtykkevalg nå).
- Ingen ny dashboard-historikk for innloggede forespørsler utover at `userId` lagres (kan bygges senere).

## Risiko / åpne punkter

- `startDate`-nullbarhet berører flere spørringer; krever nøye gjennomgang og test for å unngå sorterings-/visningsregresjon.
- Deploy av skjemaendringen avhenger av et Basefarm-brannmurvindu (ikke selvbetjent).
- E-postmalene for booking må gjøres arrangement-bevisste uten å brekke eksisterende dobbeltsulky-tekst.
