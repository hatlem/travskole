# Bjerke Travskole

Påmeldingssystem for kurs og leirer ved Bjerke Travskole. Bygget med Next.js, Prisma og NextAuth.

## Teknologi

- **Next.js 16** — React 19, App Router
- **Prisma** — ORM (SQLite dev / PostgreSQL prod)
- **NextAuth** — Autentisering (magic link + passord)
- **Tailwind CSS 4** — Styling
- **TypeScript 5** — Typesikkerhet
- **Node.js 24** LTS (Krypton)

## Kom i gang

```bash
# Installer avhengigheter
npm install

# Sett opp database
npx prisma migrate dev

# Start dev-server
npm run dev
```

## Miljøvariabler

Kopier `.env.example` til `.env` og fyll inn:

```env
DATABASE_URL="file:./dev.db"
NEXTAUTH_SECRET="din-hemmelige-nøkkel"
NEXTAUTH_URL="http://localhost:3000"

# Magic link (e-post)
EMAIL_SERVER_HOST=smtp.example.com
EMAIL_SERVER_PORT=587
EMAIL_SERVER_USER=bruker
EMAIL_SERVER_PASSWORD=passord
EMAIL_FROM=noreply@travskole.no
```

## Prosjektstruktur

```
app/                  # Next.js App Router
  auth/               # Innlogging og registrering
  courses/            # Kurs- og leirsider
  dashboard/          # Brukerside (krever innlogging)
  api/auth/           # NextAuth API-ruter
components/           # Gjenbrukbare komponenter
lib/                  # Hjelpefunksjoner (auth, logger, etc.)
prisma/               # Database-skjema og migrasjoner
public/               # Statiske filer og logo
```

## Deploy

Hostet på Railway med PostgreSQL. Push til `main` for å deploye.
