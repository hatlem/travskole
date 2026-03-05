# Travskole - Tekniske Krav

## 🎯 Core Features

### 1. Brukerautentisering & Familiestruktur
- **Foreldre-konto**: E-post + passord login
- **Profil**: Navn, telefon, adresse, e-post
- **Flere barn per forelder**: 1-N relasjon
- **Barn-profil**: Navn, fødselsdato, allergier

**Database schema:**
```sql
CREATE TABLE parents (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  address TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE children (
  id SERIAL PRIMARY KEY,
  parent_id INTEGER REFERENCES parents(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  birthdate DATE,
  allergies TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 2. Kurs & Leirer
- **Oversikt**: Alle kurs og leirer på én side
- **Filter/tabs**: "Kurs" vs "Leirer"
- **Påmelding**: Velg barn fra profil → raskere påmelding neste gang
- **Samtykker**: Auto-fylles hvis gitt tidligere, kan oppdateres

**Database schema:**
```sql
CREATE TABLE courses (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  type VARCHAR(50) NOT NULL, -- 'kurs' eller 'leir'
  start_date DATE NOT NULL,
  end_date DATE,
  age_min INTEGER,
  age_max INTEGER,
  price DECIMAL(10,2),
  max_participants INTEGER,
  status VARCHAR(50) DEFAULT 'open', -- 'open', 'full', 'closed'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE registrations (
  id SERIAL PRIMARY KEY,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  child_id INTEGER REFERENCES children(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES parents(id) ON DELETE CASCADE,
  consent_activities BOOLEAN DEFAULT FALSE,
  consent_media BOOLEAN DEFAULT FALSE,
  consent_risk BOOLEAN DEFAULT FALSE,
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'confirmed', 'cancelled'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 3. Admin Panel
**Tilgang**: Admins (rolle-basert)
**Funksjoner:**
- Se alle påmeldinger (filter etter kurs, dato, status)
- Eksportere til CSV/Excel
- Endre påmeldingsstatus (pending → confirmed)
- Se deltaker-detaljer (barn, foresatt, samtykker, allergier)
- Administrere kurs (opprette, redigere, slette)
- Brukeradministrasjon (se foreldre, barn, statistikk)

**Database schema:**
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'parent', -- 'parent', 'admin'
  created_at TIMESTAMP DEFAULT NOW()
);

-- Koble users til parents
ALTER TABLE parents ADD COLUMN user_id INTEGER REFERENCES users(id);
```

### 4. E-post (SMTP)
**Når:**
- Ny påmelding → Bekreftelse til forelder
- Ny påmelding → Varsling til admin
- Kurs-påminnelse → 1 dag før start
- Statusendring → Når admin bekrefter/avslår

**SMTP-setup:**
```env
SMTP_HOST=smtp.gmail.com (eller annen provider)
SMTP_PORT=587
SMTP_USER=travskole@bjerke.no
SMTP_PASS=<app-password>
SMTP_FROM=Bjerke Travskole <travskole@bjerke.no>
```

**E-post templates:**
```
1. Bekreftelse til forelder:
   Emne: Påmelding mottatt - [Kursnavn]
   Innhold: Takk for påmelding. Barn: [Navn]. Kurs: [Navn + dato]. Vi bekrefter snart.

2. Varsling til admin:
   Emne: Ny påmelding - [Kursnavn]
   Innhold: Barn: [Navn]. Forelder: [Navn + kontakt]. Allergier: [Ja/Nei]. Link til admin.

3. Påminnelse (1 dag før):
   Emne: I morgen: [Kursnavn]
   Innhold: Påminnelse om kurs i morgen kl [tid]. Husk ridehjelm og varme klær!

4. Bekreftelse fra admin:
   Emne: Plassen er bekreftet - [Kursnavn]
   Innhold: Din plass er bekreftet! Vi sees [dato]. Husk samtykkeskjema hvis ikke sendt inn.
```

### 5. Dobbeltsulky Booking
- **Egen side/seksjon**: Enkel form (navn, e-post, telefon, ønsket dato, melding)
- **Send direkte til Andreas sin e-post** (ikke lagres i database)
- **SMTP-sending**: Samme oppsett som påmeldinger

### 6. GDPR Compliance
**Rettigheter:**
- **Rett til innsyn**: Forelder kan laste ned all sin data (JSON/PDF)
- **Rett til sletting**: "Slett min konto"-knapp
  - Sletter forelder + barn + påmeldinger (CASCADE)
  - Sender bekreftelse på e-post
- **Personvernpolicy**: Synlig på påmeldingsskjema + egen side
- **Samtykke**: Eksplisitt samtykke for hvert barn ved påmelding

**Implementasjon:**
```sql
-- Soft delete (for historikk)
ALTER TABLE parents ADD COLUMN deleted_at TIMESTAMP;
ALTER TABLE children ADD COLUMN deleted_at TIMESTAMP;

-- GDPR export endpoint
GET /api/gdpr/export → JSON med all brukerdata

-- GDPR delete endpoint
POST /api/gdpr/delete → Soft delete + e-postvarsel
```

---

## 🛠️ Tech Stack (Final)

### Frontend
- **Next.js 14+** (App Router)
- **TypeScript** (type safety)
- **Tailwind CSS** (design matching Bjerke.no)
- **React Hook Form + Zod** (form validation)
- **NextAuth.js** (autentisering)
- **TanStack Query** (data fetching)

### Backend
- **Next.js API Routes** (serverless functions)
- **Prisma ORM** (database ORM)
- **PostgreSQL** (database via Supabase)
- **Nodemailer** (SMTP e-post)
- **bcrypt** (password hashing)
- **JWT** (session tokens)

### Hosting & Infrastruktur
- **Vercel** (frontend + API hosting)
- **Supabase** (PostgreSQL database)
- **SMTP Provider** (Gmail, SendGrid, eller Postmark)
- **Domain**: travskole.bjerke.no (subdomain)

---

## 📋 User Stories

### Forelder (Første gang)
1. Besøker travskole.bjerke.no
2. Blar gjennom kurs/leirer
3. Klikker "Meld på" → redirects til registrering
4. Oppretter konto (e-post + passord)
5. Legger til barn (navn, fødselsdato, allergier)
6. Velger kurs
7. Gir samtykker
8. Sender påmelding → får bekreftelse på e-post

### Forelder (Neste gang)
1. Logger inn
2. Ser sine barn i dashboard
3. Velger barn + nytt kurs
4. Samtykker er forhåndsutfylt (kan oppdateres)
5. Sender påmelding → raskere enn første gang

### Admin
1. Logger inn på /admin
2. Ser dashbord med:
   - Nye påmeldinger (trenger bekreftelse)
   - Kommende kurs (fylte plasser)
   - Statistikk (totale påmeldinger, barn registrert)
3. Klikker på påmelding → ser detaljer
4. Bekrefter → barn får e-post
5. Eksporterer liste for kurset (CSV) → for oppmøteliste

---

## 🔐 Sikkerhet

- **HTTPS only** (SSL via Vercel)
- **Password hashing** (bcrypt, min 12 rounds)
- **CSRF protection** (NextAuth.js built-in)
- **Rate limiting** på login/registrering
- **Input sanitization** (Zod validation + DOMPurify)
- **SQL injection prevention** (Prisma ORM)
- **Session management** (JWT med expiry)

---

## 📧 SMTP Setup (Example: Gmail)

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=travskole@bjerke.no
SMTP_PASS=<app-specific-password>
```

**Sett opp app-password:**
1. Gå til Google Account → Security → 2-Step Verification
2. App passwords → Generate new
3. Kopier passordet til .env

**Alternativt: SendGrid/Postmark**
- Mer pålitelig for produksjon
- Bedre deliverability
- Enklere å spore e-poster

---

## 🚀 Deployment Checklist

### Før Launch
- [ ] Database schema deployed (Supabase)
- [ ] SMTP konfigurert og testet
- [ ] Admin-bruker opprettet
- [ ] Første kurs/leir lagt inn
- [ ] E-post templates testet
- [ ] Personvernpolicy publisert
- [ ] GDPR-funksjoner testet (export + delete)
- [ ] SSL-sertifikat aktivt (travskole.bjerke.no)
- [ ] Mobile responsiveness testet
- [ ] Forms validering testet

### Etter Launch
- [ ] Monitorere e-post delivery
- [ ] Sjekke påmeldinger daglig
- [ ] Backup database ukentlig
- [ ] Oppdatere kurs/leirer

---

## 📊 Analytics (Optional)

- **Plausible Analytics** (privacy-friendly, GDPR-compliant)
- Spor:
  - Besøkende per side
  - Påmeldingsrate (conversion)
  - Mest populære kurs

---

## ⏱️ Estimert Tid

**MVP (uten admin):** 3-4 dager
**Med admin panel:** 5-6 dager
**Full GDPR + polish:** 7-10 dager

---

_Oppdatert: 5. mars 2026_
