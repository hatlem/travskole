# Adminveiledning – Bjerke Ponniskole

## Innlogging

Gå til **https://registrering.bjerke.no/auth/login** og logg inn med superadmin-kontoen `bjerke@bjerke.no` (passord overlevert separat).

Etter innlogging havner du på Admin-dashbordet. Menyen til venstre inneholder: **Dashboard, Kurs, Påmeldinger, Brukere, Forespørsler, Aktivitetslogg, Sider, Innstillinger** og (kun for superadmin) **E-postmaler** og **Tekster**.

---

## Opprette et arrangement

Gå til **Admin → Kurs → Nytt** (knappen øverst til høyre på kurs-siden).

### Felter du fyller ut

| Felt | Beskrivelse |
|------|-------------|
| **Kursnavn** | Vises på nettsiden og i påmeldingsbekreftelser. Obligatorisk. |
| **Type** | Velg blant arrangementstypene som er konfigurert (f.eks. Kurs, Leir, Arrangement). |
| **Hvem er arrangementet for?** | **Barn** – foresatt melder på barnet. **Voksne** – deltaker melder på seg selv. |
| **Beskrivelse** | Friteksst (maks 2000 tegn) som vises på arrangementssiden. |
| **Status** | Åpen / Fullt / Stengt. |
| **Startdato / Sluttdato** | Startdato er obligatorisk (unntatt ved Forespørsel-modus). |
| **Alder fra / til** | Valgfri aldersgrense som vises på kortet. |
| **Pris** | Vises på nettsiden (i kr). |
| **Min / Maks deltakere** | Maks setter kapasiteten; kurset vises som «Fullt» når det er nådd. |
| **Bilde** | Last opp et bilde som vises øverst på arrangementssiden. |

### Registreringsmodus

Velg modus i feltet **Registreringsmodus**:

- **Påmelding (fast dato/plasser)** – standard flyt: deltaker melder på direkte, dato er obligatorisk, plasser telles ned.
- **Forespørsel (avtal tid)** – brukes til arrangementer der tidspunktet avtales etterpå (f.eks. dobbeltsulky). Deltakeren sender en forespørsel; du bekrefter eller avviser manuelt under **Admin → Forespørsler**. Startdato er valgfri.

Når **Forespørsel** er valgt, dukker det opp ekstra valg:

- **Krev innlogging** – deltakeren må være logget inn for å sende forespørsel.
- **Samtykker som vises**: kryss av hvilke samtykkepunkter som skal vises i skjemaet: Risiko/forsikring, Vilkår, Bilder/video, Aktiviteter utenfor Bjerke.

Klikk **Opprett kurs** når alle felter er fylt ut.

---

## E-postmaler og automatiske triggere

### Hva er en trigger?

En trigger kobler en e-postmal til et tidspunkt, for eksempel «send velkomstmail når noen melder seg på» eller «send påminnelse 3 dager før kursstart». Triggere settes opp per arrangement.

### Koble en mal til et arrangement

1. Gå til **Admin → Kurs** og klikk **Rediger** på det aktuelle kurset.
2. Velg fanen **E-poster** øverst på redigeringssiden.
3. Du ser fem standard triggere (opprettes automatisk første gang du åpner fanen):

| Trigger | Beskrivelse |
|---------|-------------|
| Påmelding bekreftet | Sendes umiddelbart når noen melder seg på. |
| Påminnelse før kursstart | Sendes et bestemt antall dager før startdato (standard: 3 dager). |
| Velkommen – kursstart | Sendes på startdatoen. |
| Midtveis i kurset | Sendes midt i kurset. |
| Etter kursslutt | Sendes etter kurset er avsluttet (standard: 1 dag etter). |

4. For hver trigger: velg en **mal** fra nedtrekkslisten og slå **på/av**-bryteren til «på» for å aktivere den. Endringer lagres automatisk.
5. De fem standardmalene finnes allerede under **Admin → E-postmaler** (kun synlig for superadmin).

Du kan også legge til egendefinerte triggere med knappen **+ Legg til trigger**.

---

## Samtykketekster og påmeldingsskjema

Gå til **Admin → Innstillinger**.

- **Samtykketekster** – rediger teksten som vises ved de ulike samtykkepunktene i påmeldingsskjemaet (risiko, bilder/video, vilkår, aktiviteter). Vanlig admin kan redigere disse.
- **Påmeldingsskjema** – styr om adresse er obligatorisk og om deltakerne må godta vilkår. Vanlig admin kan redigere disse.
- Øvrige innstillinger (sitenavn, forsideinnhold, arrangementstyper osv.) krever superadmin.

Klikk **Lagre alle endringer** øverst eller nederst på siden når du er ferdig.

---

## Juridiske sider (vilkår og personvern)

Gå til **Admin → Sider**.

Her redigerer du innholdet på:

- **/vilkar** – Vilkår og betingelser
- **/personvern** – Personvernerklæring

Bruk den innebygde tekstredigereren og klikk **Lagre** for den aktuelle siden. Endringer vises umiddelbart på nettstedet.

---

## Se påmeldinger

Gå til **Admin → Påmeldinger** for å se alle vanlige påmeldinger (der registreringsmodus er «Påmelding»). Her kan du filtrere og søke.

---

## Se og behandle forespørsler

Gå til **Admin → Forespørsler** for å se innkomne forespørsler (arrangementer med registreringsmodus «Forespørsel», for eksempel dobbeltsulky).

- Hver forespørsel viser navn, e-post, telefon, antall deltakere og ønsket dato.
- Klikk **Bekreft** eller **Avvis** direkte på kortet.
- Du kan også velge flere forespørsler og bruke **Bekreft valgte** / **Avvis valgte** for bulkbehandling.

**Merk:** Dobbeltsulky er satt opp som et vanlig Forespørsel-arrangement. Det finnes ingen egen meny for dette – alt håndteres under **Forespørsler**.
