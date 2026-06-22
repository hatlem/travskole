# Behandlingsprotokoll (GDPR art. 30) — registrering.bjerke.no

> Utkast til intern protokoll over behandlingsaktiviteter. Gjennomgås og vedtas av behandlingsansvarlig. Databehandleravtaler (DPA) må inngås med hver databehandler nedenfor.

**Sist oppdatert:** 2026-06-22

## Behandlingsansvarlig
Bjerke Travbane AS — påmeldingsløsningen for kurs, leirer og arrangementer (travskole/aktivitetsstall).
Kontakt: registrering@bjerke.no

## Formål med behandlingen
- Administrere påmeldinger til kurs/leirer/arrangementer (inkl. ponniskole) og forespørsler (f.eks. dobbeltsulky-kjøring).
- Kommunikasjon med deltakere/foresatte (bekreftelser, påminnelser, praktisk info).
- Sikkerhet og drift (innlogging, misbruksbeskyttelse).

## Kategorier av registrerte
- Foresatte / voksne deltakere (kontoinnehavere).
- Barn (deltakere som meldes på av foresatt).

## Kategorier av personopplysninger
| Kategori | Felt | Merknad |
|---|---|---|
| Foresatt/voksen | navn, e-post, telefon, (adresse) | Adresse valgfri/admin-styrt |
| Barn | navn, fødselsdato, **allergier** | Allergier = helseopplysning (art. 9 — særlig kategori) |
| Samtykker | aktivitet, media, risiko/forsikring, vilkår + **tidspunkt og tekstversjon (hash)** | Lagres som bevis (art. 7) |
| Konto/sikkerhet | passord (bcrypt-hash), innloggingshendelser | Sikkerhetslogg |
| Forespørsler | navn, e-post, telefon, antall, ønsket dato, melding | «Avtal tid»-arrangementer |

## Behandlingsgrunnlag
- **Avtale** (art. 6 nr. 1 b): gjennomføre påmeldingen/arrangementet.
- **Samtykke** (art. 6 nr. 1 a, og art. 9 nr. 2 a for helse/allergi og media): aktivitets-, media-, risiko-/forsikrings- og vilkårssamtykker innhentes og logges ved påmelding.
- **Berettiget interesse** (art. 6 nr. 1 f): sikkerhetslogging og misbruksbeskyttelse.

## Databehandlere / mottakere (DPA påkrevd)
| Databehandler | Tjeneste | Plassering | DPA |
|---|---|---|---|
| Basefarm Orange | Hosting (App Service) + database (PostgreSQL) | Azure (EU) | Må inngås/bekreftes |
| Microsoft (Azure Communication Services) | Utgående e-post (SMTP) | Azure (EU) | Må inngås/bekreftes |
| Google (Analytics / GA4) | Webanalyse — **kun ved samtykke** via Cookiebot/Consent Mode | EU/USA (SCC/DPF) | Bekreft overføringsgrunnlag |

## Lagringstid (retensjon)
- **Persondata beholdes så lenge kundeforholdet er aktivt.** Familier skal kunne logge inn år etter år og gjenbruke informasjonen ved ny påmelding. Det kjøres **ingen** automatisk tidsbasert sletting som standard (`data_retention_days = 0`).
- **Sletting skjer på forespørsel** (rett til sletting, se under): konto + tilknyttede persondata slettes/anonymiseres når den registrerte ber om det.
- (Valgfritt) En tidsbasert anonymisering av barns data kan slås på senere ved å sette `data_retention_days` til et positivt antall dager — ikke aktivt i dag.
- Sikkerhetslogger bør ha en kortere, tidsbegrenset oppbevaring.

## De registrertes rettigheter
- **Innsyn / retting:** foresatt ser og redigerer egne opplysninger og barn via «Min side» (dashboard).
- **Sletting:** på forespørsel til registrering@bjerke.no (intern rutine: bekreft identitet → slett/anonymiser konto + barn). Soft-delete (`deletedAt`) skjuler data umiddelbart fra admin-visninger.
- **Dataportabilitet:** kan dekkes ved eksport av egne data (delvis tilgjengelig via dashboard; full eksport kan bygges ved behov).
- Svarfrist: innen 1 måned (art. 12 nr. 3).

## Tekniske og organisatoriske tiltak
- TLS/`sslmode=require` mot database; secrets i Azure App Settings (ikke i kode/repo).
- Passord hashes med bcrypt; engangs reset-tokens (sha256, utløper).
- Rollebasert tilgang (admin/superadmin); admin-ruter krever autentisering.
- Inndatavalidering (Zod), HTML-sanitering (DOMPurify), rate limiting på offentlige endepunkter.
- Cookie-samtykke (Cookiebot) + Google Consent Mode — analyse laster ikke før samtykke.
- Soft-delete + filtrering av slettede persondata i admin.
- Sikkerhetslogging til stdout (Azure log stream).

## Avvik / å følge opp
- Inngå/bekrefte DPA-er med Basefarm, Microsoft og Google + overføringsgrunnlag for GA4.
- Sette en konkret oppbevaringstid for sikkerhetslogger.
- Vurdere full dataeksport (portabilitet) som selvbetjening.
