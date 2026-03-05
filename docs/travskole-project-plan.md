# Travskole Project Plan

## 📋 Oversikt

**Prosjekt:** Bjerke Travskole nettside  
**URL:** https://travskole.bjerke.no  
**Design-inspirasjon:** Bjerke.no (moderne, ren profil med panoramautsikt)  
**Repository:** https://github.com/hatlem/travskole

---

## 🎯 Mål

Lage en moderne, brukervennlig landingsside for Bjerke Travskole med:
- Informasjon om travskolen
- Påmelding til kurs og leirer
- Oversikt over kommende datoer
- Booking av dobbeltsulky-kjøring
- Samtykkeskjema og allergi-registrering

---

## 🏗️ Teknisk Stack (Forslag)

### Alternativ 1: Modern JAMstack (Anbefalt)
- **Frontend:** Next.js 14+ (React)
- **Styling:** Tailwind CSS (enkel å matche Bjerke.no design)
- **Backend:** Next.js API routes + Supabase/Firebase
- **Databaser:** PostgreSQL (via Supabase) eller Firestore
- **Forms:** React Hook Form + Zod validation
- **Email:** Resend eller SendGrid for varsler
- **Hosting:** Vercel (gratis tier, perfekt for Next.js)
- **Domene:** travskole.bjerke.no (subdomain på eksisterende)

### Alternativ 2: Enklere løsning
- **Frontend:** HTML/CSS/JavaScript (Vanilla eller Alpine.js)
- **Backend:** Node.js + Express eller PHP
- **Database:** SQLite eller MySQL
- **Forms:** Netlify Forms eller Formspree
- **Hosting:** Netlify eller eksisterende Bjerke.no server

**Anbefaling:** Alternativ 1 (Next.js) - moderne, skalerbar, enkel å vedlikeholde

---

## 📐 Sidestruktur

### 1. **Forside / Landing Page**
- Hero-seksjon med bilde fra travbanen
- Kort intro om travskolen
- Call-to-action: "Meld på kurs" / "Se kursoversikt"
- Kommende kurs (liste over neste 1-2 datoer)
- Kontaktinformasjon

### 2. **Kursoversikt**
- Liste over alle tilgjengelige kurs
- Filtreringsmuligheter (alder, type, dato)
- Påmeldingsknapp per kurs
- Kursbeskrivelse, varighet, pris, aldersgruppe

### 3. **Leiroversikt**
- Liste over sommerleirer / feriekurs
- Påmeldingsknapp per leir
- Detaljert informasjon (dato, varighet, aktiviteter, pris)

### 4. **Påmeldingsskjema** (modal eller egen side)
- Deltakerens navn
- Foresattes kontaktinformasjon (e-post, telefon)
- Valg av kurs/leir
- Samtykke-bokser:
  - Aktiviteter utenfor Bjerke (bading, skøyter, etc.)
  - Foto/video publisering (Facebook, Instagram, nettside)
  - Forståelse av risikosport / ulykkesforsikring
- Allergier (fritekstfelt)
- Bekreftelse av vilkår
- Submit → sendes til database + e-postvarsel

### 5. **Dobbeltsulky Booking**
- Egen side eller knapp som sender forespørsel direkte til e-post
- Enkel form: navn, e-post, telefon, ønsket dato/tid
- Sendes direkte til Andreas sin e-post

### 6. **Om Travskolen**
- Historie / bakgrunn
- Hva barna lærer
- Sikkerhet og rutiner
- Bilder fra tidligere kurs

---

## 🗄️ Database-struktur

### Tabell: `courses`
```sql
CREATE TABLE courses (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  type VARCHAR(50), -- 'kurs' eller 'leir'
  start_date DATE NOT NULL,
  end_date DATE,
  age_group VARCHAR(100),
  price DECIMAL(10,2),
  max_participants INTEGER,
  current_participants INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'open', -- 'open', 'full', 'closed'
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Tabell: `registrations`
```sql
CREATE TABLE registrations (
  id SERIAL PRIMARY KEY,
  course_id INTEGER REFERENCES courses(id),
  participant_name VARCHAR(255) NOT NULL,
  parent_email VARCHAR(255) NOT NULL,
  parent_phone VARCHAR(50) NOT NULL,
  consent_activities BOOLEAN DEFAULT FALSE,
  consent_media BOOLEAN DEFAULT FALSE,
  consent_risk BOOLEAN DEFAULT FALSE,
  allergies TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Tabell: `sulky_bookings`
```sql
CREATE TABLE sulky_bookings (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  preferred_date DATE,
  message TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 🎨 Design-retningslinjer (basert på Bjerke.no)

### Fargepalett
- Primær: Mørkeblå / marineblå (profesjonell, sportslig)
- Sekundær: Hvit / lys grå (ren, moderne)
- Aksent: Gull/orange for call-to-actions
- Bakgrunn: Hvit med subtile grå seksjoner

### Typografi
- Moderne sans-serif (f.eks. Inter, Poppins, eller Montserrat)
- Store, tydelige overskrifter
- God lesbarhet på mobil

### Bilder
- Hero-bilde: Panoramautsikt over travbanen eller barn med hester
- Kurs-bilder: Autentiske bilder fra travskolen
- Høy kvalitet, profesjonelle

### Layout
- Clean, minimalistisk
- Mye whitespace
- Store, tydelige knapper
- Responsivt design (mobil-først)

---

## 📝 Innhold som må skrives

### Tekster
- [ ] Velkommen-tekst for forsiden
- [ ] Om Travskolen (historie, formål, verdier)
- [ ] Kursbeskrivelser (for hvert kurs)
- [ ] Leirbeskrivelser
- [ ] Sikkerhetsinformasjon
- [ ] FAQ (vanlige spørsmål)
- [ ] Kontaktinformasjon

### Juridisk
- [ ] Personvernpolicy (GDPR-compliant)
- [ ] Vilkår for påmelding
- [ ] Samtykkeskjema (allerede har denne)

---

## 🚀 Implementasjonsplan

### Fase 1: Setup (Dag 1)
- [x] Opprett GitHub repository
- [ ] Setup Next.js prosjekt
- [ ] Installer dependencies (Tailwind, React Hook Form, etc.)
- [ ] Setup Supabase/Firebase database
- [ ] Konfigurer domene (travskole.bjerke.no)

### Fase 2: Design & Frontend (Dag 2-3)
- [ ] Design wireframes/mockups
- [ ] Implementer layout og navigasjon
- [ ] Bygg forside med hero og kursoversikt
- [ ] Bygg kursoversikt-side
- [ ] Bygg leiroversikt-side
- [ ] Implementer responsivt design

### Fase 3: Backend & Forms (Dag 4-5)
- [ ] Setup database-skjemaer
- [ ] Implementer påmeldingsskjema med validering
- [ ] Integrer samtykke-bokser
- [ ] Setup e-postvarsler (til admin og foresatte)
- [ ] Implementer dobbeltsulky booking-funksjon
- [ ] Admin-panel for å se påmeldinger (basic)

### Fase 4: Testing & Deploy (Dag 6)
- [ ] Teste alle skjemaer
- [ ] Teste på mobile enheter
- [ ] Performance-optimalisering
- [ ] SEO-optimalisering
- [ ] Deploy til Vercel
- [ ] Konfigurer domene

### Fase 5: Innhold & Launch (Dag 7)
- [ ] Legge inn faktiske kurs og leirer
- [ ] Laste opp bilder
- [ ] Skrive alle tekster
- [ ] Final testing
- [ ] Launch! 🎉

---

## 📧 E-postvarsler

### Ved påmelding til kurs:
**Til foresatte:**
- Bekreftelse på påmelding
- Kursinformasjon (dato, tid, sted)
- Påminnelse om å sende samtykkeskjema
- Informasjon om forsikring

**Til admin (Andreas):**
- Varsling om ny påmelding
- Deltakers info og samtykke-status
- Allergi-informasjon

### Ved dobbeltsulky booking:
**Til Andreas:**
- E-post med bookinginformasjon
- Navn, kontaktinfo, ønsket dato

---

## 🔐 Sikkerhet & GDPR

- [ ] SSL-sertifikat (HTTPS)
- [ ] Input-validering (både frontend og backend)
- [ ] Personvernpolicy synlig på skjemaer
- [ ] Data lagres kryptert
- [ ] Backup-rutiner for database
- [ ] Mulighet for sletting av persondata (GDPR-rett)

---

## 📱 Funksjonalitet

### Must-have (MVP)
- ✅ Landingsside med info
- ✅ Kursoversikt
- ✅ Påmeldingsskjema med samtykke
- ✅ E-postvarsler
- ✅ Responsivt design

### Nice-to-have (Fase 2)
- Admin-dashboard for å administrere påmeldinger
- Venteliste-funksjon ved fullt kurs
- Betalingsintegrasjon (Vipps/Stripe)
- Bildekarusell fra tidligere kurs
- Integrering med Bjerke.no sin Instagram
- Påminnelse-e-poster før kursstart

---

## 💰 Estimert Kostnad

**Gratis/billig alternativ:**
- Hosting: Vercel (gratis for hobby)
- Database: Supabase (gratis tier, godt nok for start)
- E-post: Resend (gratis opp til 3000/mnd)
- **Total: 0 kr/mnd**

**Profesjonelt oppsett:**
- Hosting: Vercel Pro (~$20/mnd)
- Database: Supabase Pro (~$25/mnd)
- E-post: SendGrid eller Postmark (~$10/mnd)
- **Total: ~$55/mnd (~550 NOK)**

---

## 🤝 Neste Steg

1. **Godkjenn prosjektplan** → Gå igjen gjennom planen og juster etter behov
2. **Bestem teknisk stack** → Next.js eller enklere løsning?
3. **Design mockups** → Skisse opp hvordan siden skal se ut
4. **Start utviklingen** → Jeg kan bruke coding-agent skill for å bygge dette

---

## 📞 Kontakt og Spørsmål

- **Domene:** Må travskole.bjerke.no settes opp hos domeneleverandør?
- **E-post:** Hvilken e-post skal varsler sendes til?
- **Bilder:** Har dere bilder fra tidligere kurs som kan brukes?
- **Innhold:** Hvem skriver tekstene til nettsiden?

---

**Prosjekt opprettet:** 5. mars 2026  
**Planlagt ferdigstillelse:** 1-2 uker (avhengig av scope)
