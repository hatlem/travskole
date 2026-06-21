# Forespørsel-arrangement (dobbeltsulky-konsolidering) — Implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gjøre dobbeltsulky til et vanlig arrangement med en ny «forespørsel»-registreringsmodus, og fjerne det egne dobbeltsulky-delsystemet.

**Architecture:** `Course` får `registrationMode` (`standard`|`request`) + per-arrangement innloggings- og samtykkevalg. Forespørsler lagres i en generalisert `BookingRequest` knyttet til `Course`. Standard påmelding (`Registration`) er uendret bortsett fra at `startDate` blir nullbar og kort viser målgruppe. Ett nytt rate-limited endepunkt `/api/bookings` erstatter `/api/dobbeltsulky`.

**Tech Stack:** Next.js 16 (App Router, server components + client forms), Prisma + PostgreSQL, Zod, vitest. Plain React state i admin-skjemaer (ikke react-hook-form). pnpm.

**Viktige begrensninger:**
- Skjemaendring deployes til prod med `prisma db push` i et **Basefarm-brannmurvindu** (ikke selvbetjent). Lokalt: `prisma db push` mot dev-DB + `prisma generate`.
- `pnpm test`/`pnpm install` feiler med `ERR_PNPM_IGNORED_BUILDS` (kjent kvirk). Kjør tester med `./node_modules/.bin/vitest run`. Typecheck: `./node_modules/.bin/tsc --noEmit`.
- Jobb på branch `feat/foresporsel-arrangement` (allerede opprettet).

---

## Filstruktur

**Nye filer:**
- `lib/booking.ts` — ren samtykke-/valideringslogikk for forespørsler (testbar).
- `lib/course-card.ts` — ren `toCourseCardProps()` + sortering (null-safe `startDate`, målgruppe), DRY mellom forside og arrangementsliste.
- `app/api/bookings/route.ts` — arrangement-bevisst, rate-limited forespørsels-endepunkt.
- `app/arrangementer/[type]/[year]/[slug]/pamelding/request-form.tsx` — klient-skjema for forespørsel.
- `app/admin/foresporsler/page.tsx` — generell admin-liste over forespørsler (erstatter `admin/dobbeltsulky`).
- `scripts/migrate-dobbeltsulky.ts` — engangs datamigrering.
- `tests/booking.test.ts`, `tests/course-card.test.ts` — enhetstester.

**Endrede filer:**
- `prisma/schema.prisma` — Course + BookingRequest + User-relasjon, `startDate` nullbar.
- `lib/mail.ts` — booking-e-poster blir arrangement-bevisste.
- `components/CourseCard.tsx` — `audience` + badges.
- `app/page.tsx`, `app/arrangementer/page.tsx` — bruk `toCourseCardProps`, fjern dobbeltsulky-CTA.
- `app/arrangementer/[type]/[year]/[slug]/pamelding/page.tsx` — forgren standard vs request.
- `app/admin/courses/new/page.tsx`, `app/admin/courses/[id]/edit/page.tsx` — modus-felt.
- `app/api/admin/courses/route.ts`, `app/api/admin/courses/[id]/route.ts` — godta nye felt, valgfri `startDate` ved request.
- `app/api/admin/bookings/route.ts`, `app/api/admin/bookings/[id]/route.ts` — inkluder course, rett statusverdier.
- `app/sitemap.ts` — null-safe `startDate`.
- `lib/settings.ts`, `app/api/settings/public/route.ts` — fjern dobbeltsulky-nøkler.

**Slettede filer:**
- `app/api/dobbeltsulky/route.ts`, `app/arrangementer/dobbeltsulky/page.tsx`, `app/admin/dobbeltsulky/page.tsx`.

---

## Task 1: Prisma-skjema — nye felt + nullbar startDate

**Files:**
- Modify: `prisma/schema.prisma` (Course ~113–138, BookingRequest ~150–163, User ~61–74)

- [ ] **Step 1: Legg til Course-felt + relasjon, gjør startDate nullbar**

I `model Course`, endre `startDate`-linjen og legg til feltene før relasjonsblokken:

```prisma
  // ENDRE fra: startDate  DateTime  @map("start_date")
  startDate       DateTime? @map("start_date")
  // ... eksisterende felt ...
  registrationMode        String  @default("standard") @map("registration_mode") // 'standard' | 'request'
  requestRequiresLogin    Boolean @default(false) @map("request_requires_login")
  requestConsentRisk      Boolean @default(true)  @map("request_consent_risk")
  requestConsentTerms     Boolean @default(true)  @map("request_consent_terms")
  requestConsentMedia     Boolean @default(false) @map("request_consent_media")
  requestConsentActivities Boolean @default(false) @map("request_consent_activities")

  registrations  Registration[]
  emailTriggers  EmailTrigger[]
  bookingRequests BookingRequest[]
```

- [ ] **Step 2: Utvid BookingRequest**

```prisma
model BookingRequest {
  id            Int       @id @default(autoincrement())
  courseId      Int?      @map("course_id")
  userId        Int?      @map("user_id")
  name          String
  email         String
  phone         String
  participants  Int       @default(1)
  preferredDate DateTime? @map("preferred_date")
  message       String?
  consentRisk       Boolean @default(false) @map("consent_risk")
  consentTerms      Boolean @default(false) @map("consent_terms")
  consentMedia      Boolean @default(false) @map("consent_media")
  consentActivities Boolean @default(false) @map("consent_activities")
  status        String    @default("new") // 'new', 'confirmed', 'cancelled'
  createdAt     DateTime  @default(now()) @map("created_at")

  course Course? @relation(fields: [courseId], references: [id], onDelete: SetNull)
  user   User?   @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([status])
  @@index([courseId])
  @@map("booking_requests")
}
```

- [ ] **Step 3: Legg back-relasjon på User**

I `model User`, legg til i relasjonsblokken (etter `parent Parent?`):

```prisma
  bookingRequests BookingRequest[]
```

- [ ] **Step 4: Push skjema lokalt + generer klient**

Run: `./node_modules/.bin/prisma db push && ./node_modules/.bin/prisma generate`
Expected: «Your database is now in sync» + «Generated Prisma Client». (Mot lokal dev-DB. Prod gjøres i brannmurvindu, Task 12.)

- [ ] **Step 5: Verifiser typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: exit 0 (ingen feil — eksisterende kode som leser `course.startDate` kan nå se `Date | null`; fiks evt. typefeil her ved å bruke optional chaining der `tsc` klager — disse adresseres konkret i Task 3 og 10).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): request mode on Course + booking fields, nullable startDate"
```

---

## Task 2: lib/booking.ts — samtykkelogikk (TDD)

Regel: et aktivert samtykke er **påkrevd** unntatt `media` (valgfritt — registreres, men blokkerer ikke). Speiler standard-flytens semantikk.

**Files:**
- Create: `lib/booking.ts`
- Test: `tests/booking.test.ts`

- [ ] **Step 1: Skriv feilende test**

```typescript
// tests/booking.test.ts
import { describe, it, expect } from 'vitest';
import { requiredRequestConsents, bookingConsentError } from '@/lib/booking';

const course = (o: Partial<Parameters<typeof requiredRequestConsents>[0]> = {}) => ({
  requestConsentRisk: true,
  requestConsentTerms: true,
  requestConsentMedia: false,
  requestConsentActivities: false,
  ...o,
});
const submit = (o: Record<string, boolean> = {}) => ({
  consentRisk: false, consentTerms: false, consentMedia: false, consentActivities: false, ...o,
});

describe('requiredRequestConsents', () => {
  it('maps course flags to required map', () => {
    expect(requiredRequestConsents(course({ requestConsentMedia: true }))).toEqual({
      risk: true, terms: true, media: true, activities: false,
    });
  });
});

describe('bookingConsentError', () => {
  it('blocks when required risk consent missing', () => {
    expect(bookingConsentError(course(), submit({ consentTerms: true }))).toMatch(/forsikring/i);
  });
  it('blocks when required terms consent missing', () => {
    expect(bookingConsentError(course(), submit({ consentRisk: true }))).toMatch(/vilkår/i);
  });
  it('passes when all required consents given', () => {
    expect(bookingConsentError(course(), submit({ consentRisk: true, consentTerms: true }))).toBeNull();
  });
  it('media is optional even when enabled', () => {
    expect(bookingConsentError(
      course({ requestConsentMedia: true }),
      submit({ consentRisk: true, consentTerms: true }),
    )).toBeNull();
  });
  it('blocks when required activities consent missing', () => {
    expect(bookingConsentError(
      course({ requestConsentActivities: true }),
      submit({ consentRisk: true, consentTerms: true }),
    )).toMatch(/aktivitet/i);
  });
});
```

- [ ] **Step 2: Kjør testen — skal feile**

Run: `./node_modules/.bin/vitest run tests/booking.test.ts`
Expected: FAIL — «Failed to resolve import '@/lib/booking'».

- [ ] **Step 3: Implementer lib/booking.ts**

```typescript
// lib/booking.ts
export interface RequestConsentConfig {
  requestConsentRisk: boolean;
  requestConsentTerms: boolean;
  requestConsentMedia: boolean;
  requestConsentActivities: boolean;
}

export interface SubmittedConsents {
  consentRisk: boolean;
  consentTerms: boolean;
  consentMedia: boolean;
  consentActivities: boolean;
}

export interface RequiredConsents {
  risk: boolean;
  terms: boolean;
  media: boolean;
  activities: boolean;
}

export function requiredRequestConsents(c: RequestConsentConfig): RequiredConsents {
  return {
    risk: c.requestConsentRisk,
    terms: c.requestConsentTerms,
    media: c.requestConsentMedia,
    activities: c.requestConsentActivities,
  };
}

// Aktiverte samtykker er påkrevd, unntatt media (valgfritt). Returnerer
// feilmelding hvis et påkrevd samtykke mangler, ellers null.
export function bookingConsentError(c: RequestConsentConfig, s: SubmittedConsents): string | null {
  const req = requiredRequestConsents(c);
  if (req.risk && !s.consentRisk) return 'Du må bekrefte at du har lest og forstått forsikringsvilkårene';
  if (req.terms && !s.consentTerms) return 'Du må godta vilkårene for å sende forespørsel';
  if (req.activities && !s.consentActivities) return 'Du må samtykke til aktiviteter for å sende forespørsel';
  return null;
}
```

- [ ] **Step 4: Kjør testen — skal passere**

Run: `./node_modules/.bin/vitest run tests/booking.test.ts`
Expected: PASS (6 tester).

- [ ] **Step 5: Commit**

```bash
git add lib/booking.ts tests/booking.test.ts
git commit -m "feat(booking): consent rules for request-mode arrangements"
```

---

## Task 3: lib/course-card.ts — DRY kortmapping (TDD)

Trekk ut den dupliserte mappingen fra `app/page.tsx` og `app/arrangementer/page.tsx`, gjør den null-safe på `startDate`, og ta med `audience` + `registrationMode`.

**Files:**
- Create: `lib/course-card.ts`
- Test: `tests/course-card.test.ts`
- Modify: `components/CourseCard.tsx`, `app/page.tsx`, `app/arrangementer/page.tsx`

- [ ] **Step 1: Skriv feilende test**

```typescript
// tests/course-card.test.ts
import { describe, it, expect } from 'vitest';
import { toCourseCardProps, compareForListing } from '@/lib/course-card';

const base = {
  id: 1, name: 'Test', slug: 'test', description: null, type: 'kurs',
  audience: 'barn', startDate: new Date('2026-08-01'), endDate: null,
  ageMin: null, ageMax: null, price: null, maxParticipants: null,
  status: 'open', imageUrl: null, registrationMode: 'standard',
  createdAt: new Date('2026-06-01'),
};

describe('toCourseCardProps', () => {
  it('maps dated standard course', () => {
    const p = toCourseCardProps(base as never);
    expect(p.id).toBe('1');
    expect(p.start_date).toBe('2026-08-01');
    expect(p.audience).toBe('barn');
    expect(p.registration_mode).toBe('standard');
  });
  it('handles null startDate (request arrangement)', () => {
    const p = toCourseCardProps({ ...base, startDate: null, registrationMode: 'request' } as never);
    expect(p.start_date).toBeUndefined();
    expect(p.registration_mode).toBe('request');
  });
});

describe('compareForListing', () => {
  it('dated before undated, dated ascending by date, undated by createdAt', () => {
    const datedEarly = { ...base, id: 1, startDate: new Date('2026-08-01') };
    const datedLate = { ...base, id: 2, startDate: new Date('2026-09-01') };
    const undated = { ...base, id: 3, startDate: null, createdAt: new Date('2026-06-02') };
    const sorted = [undated, datedLate, datedEarly].sort(compareForListing).map((c) => c.id);
    expect(sorted).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Kjør testen — skal feile**

Run: `./node_modules/.bin/vitest run tests/course-card.test.ts`
Expected: FAIL — import resolve error.

- [ ] **Step 3: Implementer lib/course-card.ts**

```typescript
// lib/course-card.ts
import { generateSlug } from '@/lib/slug';
import type { Course } from '@prisma/client';

export interface CourseCardProps {
  id: string;
  name: string;
  slug: string;
  description: string;
  type: string;
  audience: string;
  registration_mode: string;
  start_date?: string;
  end_date?: string;
  age_min?: number;
  age_max?: number;
  price: number;
  max_participants: number;
  status: 'open' | 'full' | 'closed';
  image_url?: string | null;
}

export function toCourseCardProps(c: Course): CourseCardProps {
  return {
    id: String(c.id),
    name: c.name,
    slug: c.slug || generateSlug(c.name),
    description: c.description ?? '',
    type: c.type,
    audience: c.audience,
    registration_mode: c.registrationMode,
    start_date: c.startDate ? c.startDate.toISOString().split('T')[0] : undefined,
    end_date: c.endDate ? c.endDate.toISOString().split('T')[0] : undefined,
    age_min: c.ageMin ?? undefined,
    age_max: c.ageMax ?? undefined,
    price: c.price ?? 0,
    max_participants: c.maxParticipants ?? 0,
    status: c.status as 'open' | 'full' | 'closed',
    image_url: c.imageUrl ?? null,
  };
}

// Daterte arrangementer først (stigende dato), deretter udaterte (request)
// sortert på createdAt stigende.
export function compareForListing(a: Course, b: Course): number {
  if (a.startDate && b.startDate) return a.startDate.getTime() - b.startDate.getTime();
  if (a.startDate) return -1;
  if (b.startDate) return 1;
  return a.createdAt.getTime() - b.createdAt.getTime();
}
```

> Merk: bekreft at `generateSlug` eksporteres fra `lib/slug` (brukt i `app/page.tsx` og `app/sitemap.ts`). Hvis stien avviker, bruk samme import som disse filene.

- [ ] **Step 4: Kjør testen — skal passere**

Run: `./node_modules/.bin/vitest run tests/course-card.test.ts`
Expected: PASS.

- [ ] **Step 5: Utvid CourseCard med audience + badges**

I `components/CourseCard.tsx`: legg til i `Course`-interfacet (etter `type: string;`):

```typescript
  audience?: string;
  registration_mode?: string;
```

Gjør `start_date` valgfri i interfacet: `start_date?: string;`. Der datoen rendres, vis kun når satt (`{course.start_date && (...)}`). Legg en badge øverst i kortet ved siden av type-badgen:

```tsx
{course.registration_mode === 'request' && (
  <span className="inline-block px-2 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800">Avtal tid</span>
)}
{course.audience === 'voksen'
  ? <span className="inline-block px-2 py-0.5 text-xs font-medium rounded bg-slate-100 text-slate-700">For voksne</span>
  : <span className="inline-block px-2 py-0.5 text-xs font-medium rounded bg-emerald-100 text-emerald-800">For barn</span>}
```

- [ ] **Step 6: Bruk helperen i page.tsx og arrangementer/page.tsx**

I `app/page.tsx`: erstatt `.map((c) => ({ ...inline... }))` (linjer ~20–34) med:

```typescript
import { toCourseCardProps, compareForListing } from '@/lib/course-card';
// ...
const dbCourses = await prisma.course.findMany({ where: { status: 'open' } });
return dbCourses.sort(compareForListing).slice(0, 3).map(toCourseCardProps);
```

I `app/arrangementer/page.tsx`: erstatt fetch + inline-map (linjer ~31–55) med:

```typescript
import { toCourseCardProps, compareForListing } from '@/lib/course-card';
// ...
const dbCourses = await prisma.course.findMany();
const courses = dbCourses.sort(compareForListing).map(toCourseCardProps);
```

(Behold filtrering på status der den finnes i originalen; flytt `take`/`orderBy` ut av prisma-spørringen siden sortering nå skjer i `compareForListing`.)

- [ ] **Step 7: Verifiser typecheck + tester**

Run: `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vitest run`
Expected: exit 0, alle tester grønne.

- [ ] **Step 8: Commit**

```bash
git add lib/course-card.ts tests/course-card.test.ts components/CourseCard.tsx app/page.tsx app/arrangementer/page.tsx
git commit -m "refactor(listing): DRY course-card mapping, audience + avtal-tid badges, null-safe startDate"
```

---

## Task 4: lib/mail.ts — arrangement-bevisste booking-e-poster

**Files:**
- Modify: `lib/mail.ts` (BookingEmail ~166–173, sendBookingConfirmation ~175–195, sendBookingAdminNotification ~219–237)

- [ ] **Step 1: Legg courseName på BookingEmail**

```typescript
interface BookingEmail {
  courseName: string;
  name: string;
  email: string;
  phone: string;
  participants: number;
  preferredDate?: string | null;
  message?: string | null;
}
```

- [ ] **Step 2: Bruk courseName i bekreftelse**

I `sendBookingConfirmation`, legg en rad i tabellen øverst:

```typescript
`<tr><td style="padding:4px 12px 4px 0;color:#666">Arrangement:</td><td><strong>${escapeHtml(data.courseName)}</strong></td></tr>`
```

- [ ] **Step 3: Bruk courseName i admin-varsel**

I `sendBookingAdminNotification`, endre emne + legg arrangementsrad:

```typescript
// emne:
`Ny forespørsel — ${data.courseName} — ${data.name}`,
// første tabellrad:
`<tr><td style="padding:4px 12px 4px 0;color:#666">Arrangement:</td><td><strong>${escapeHtml(data.courseName)}</strong></td></tr>`
```

- [ ] **Step 4: Verifiser typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: vil feile i `app/api/dobbeltsulky/route.ts` fordi den ikke sender `courseName`. Det er forventet — den filen slettes i Task 9. For nå: midlertidig legg `courseName: 'Dobbeltsulky'` i `emailData` i `app/api/dobbeltsulky/route.ts` slik at `tsc` er grønn mellom commits.

- [ ] **Step 5: Commit**

```bash
git add lib/mail.ts app/api/dobbeltsulky/route.ts
git commit -m "feat(mail): include arrangement name in booking emails"
```

---

## Task 5: app/api/bookings/route.ts — nytt rate-limited endepunkt

**Files:**
- Create: `app/api/bookings/route.ts`

- [ ] **Step 1: Implementer endepunktet**

```typescript
// app/api/bookings/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, registrationLimiter, getClientIp } from '@/lib/rate-limiter';
import { getServerSession } from '@/lib/auth';
import { bookingConsentError } from '@/lib/booking';
import { sendBookingConfirmation, sendBookingAdminNotification } from '@/lib/mail';
import logger from '@/lib/logger';

const bookingSchema = z.object({
  courseId: z.coerce.number().int().positive(),
  name: z.string().min(1, 'Navn er påkrevd').max(200),
  email: z.string().email('Ugyldig e-postadresse'),
  phone: z.string().min(8, 'Ugyldig telefonnummer').max(20),
  participants: z.coerce.number().int().min(1).max(20).default(1),
  preferredDate: z.string().nullable().optional(),
  message: z.string().max(2000).nullable().optional(),
  consentRisk: z.boolean().default(false),
  consentTerms: z.boolean().default(false),
  consentMedia: z.boolean().default(false),
  consentActivities: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  const rl = await checkRateLimit(registrationLimiter, `booking:${getClientIp(request.headers)}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: rl.error ?? 'For mange forsøk. Prøv igjen senere.' }, { status: 429 });
  }

  const body = await request.json();
  const parsed = bookingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;

  const course = await prisma.course.findUnique({ where: { id: data.courseId } });
  if (!course || course.registrationMode !== 'request' || course.status === 'closed') {
    return NextResponse.json({ error: 'Forespørsel er ikke tilgjengelig for dette arrangementet' }, { status: 400 });
  }

  let userId: number | null = null;
  if (course.requestRequiresLogin) {
    const session = await getServerSession();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Du må være innlogget for å sende forespørsel.' }, { status: 401 });
    }
    const user = await prisma.user.findUnique({
      where: { email: session.user.email.toLowerCase() },
      select: { id: true },
    });
    userId = user?.id ?? null;
  }

  const consentErr = bookingConsentError(course, data);
  if (consentErr) {
    return NextResponse.json({ error: consentErr }, { status: 400 });
  }

  try {
    const booking = await prisma.bookingRequest.create({
      data: {
        courseId: course.id,
        userId,
        name: data.name,
        email: data.email,
        phone: data.phone,
        participants: data.participants,
        preferredDate: data.preferredDate ? new Date(data.preferredDate) : null,
        message: data.message || null,
        consentRisk: data.consentRisk,
        consentTerms: data.consentTerms,
        consentMedia: data.consentMedia,
        consentActivities: data.consentActivities,
      },
    });

    const emailData = {
      courseName: course.name,
      name: data.name,
      email: data.email,
      phone: data.phone,
      participants: booking.participants,
      preferredDate: data.preferredDate ?? null,
      message: data.message ?? null,
    };
    await Promise.all([
      sendBookingConfirmation(emailData),
      sendBookingAdminNotification(emailData),
    ]).catch((err) => logger.error('Booking email error (booking saved)', { error: err }));

    return NextResponse.json({ booking }, { status: 201 });
  } catch (error) {
    logger.error('Booking error', { error });
    return NextResponse.json({ error: 'Noe gikk galt' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verifiser typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/api/bookings/route.ts
git commit -m "feat(api): course-aware, rate-limited /api/bookings for request mode"
```

---

## Task 6: Forespørsels-skjema + forgrening i pamelding/page.tsx

**Files:**
- Create: `app/arrangementer/[type]/[year]/[slug]/pamelding/request-form.tsx`
- Modify: `app/arrangementer/[type]/[year]/[slug]/pamelding/page.tsx`

- [ ] **Step 1: Lag RequestForm-komponenten**

```tsx
// app/arrangementer/[type]/[year]/[slug]/pamelding/request-form.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSettings } from '@/components/SettingsProvider';

interface RequestFormProps {
  courseId: number;
  courseName: string;
  courseType: string;
  requireLogin: boolean;
  consents: { risk: boolean; terms: boolean; media: boolean; activities: boolean };
}

export default function RequestForm({ courseId, courseName, courseType, requireLogin, consents }: RequestFormProps) {
  const router = useRouter();
  const settings = useSettings();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({
    name: '', email: '', phone: '', participants: 1, preferredDate: '', message: '',
    consentRisk: false, consentTerms: false, consentMedia: false, consentActivities: false,
  });

  if (done) {
    return (
      <div className="max-w-xl mx-auto p-6 text-center">
        <h1 className="text-2xl font-bold mb-2">Forespørsel sendt!</h1>
        <p className="text-gray-600">Vi har mottatt forespørselen din om {courseName} og tar kontakt for å avtale tid.</p>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, ...form, preferredDate: form.preferredDate || null }),
      });
      if (res.status === 401) {
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Noe gikk galt');
      }
      if (typeof window !== 'undefined') {
        const w = window as unknown as { dataLayer?: Record<string, unknown>[] };
        w.dataLayer = w.dataLayer || [];
        w.dataLayer.push({ event: 'foresporsel_sendt', course_name: courseName, course_type: courseType });
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt');
    } finally {
      setSubmitting(false);
    }
  }

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <form onSubmit={submit} className="max-w-xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">Send forespørsel — {courseName}</h1>
      <p className="text-gray-600">Fyll ut skjemaet så tar vi kontakt for å avtale tid.</p>
      {requireLogin && <p className="text-sm text-amber-700">Dette arrangementet krever innlogging.</p>}

      {error && <div role="alert" className="bg-red-50 text-red-700 border border-red-200 rounded p-3 text-sm">{error}</div>}

      <div>
        <label htmlFor="name" className="block text-sm font-medium">Navn</label>
        <input id="name" required value={form.name} onChange={(e) => set('name', e.target.value)} className="mt-1 w-full border rounded px-3 py-2" />
      </div>
      <div>
        <label htmlFor="email" className="block text-sm font-medium">E-post</label>
        <input id="email" type="email" required value={form.email} onChange={(e) => set('email', e.target.value)} className="mt-1 w-full border rounded px-3 py-2" />
      </div>
      <div>
        <label htmlFor="phone" className="block text-sm font-medium">Telefon</label>
        <input id="phone" required value={form.phone} onChange={(e) => set('phone', e.target.value)} className="mt-1 w-full border rounded px-3 py-2" />
      </div>
      <div>
        <label htmlFor="participants" className="block text-sm font-medium">Antall deltakere</label>
        <input id="participants" type="number" min={1} max={20} value={form.participants} onChange={(e) => set('participants', Number(e.target.value))} className="mt-1 w-full border rounded px-3 py-2" />
      </div>
      <div>
        <label htmlFor="preferredDate" className="block text-sm font-medium">Ønsket dato (valgfri)</label>
        <input id="preferredDate" type="date" value={form.preferredDate} onChange={(e) => set('preferredDate', e.target.value)} className="mt-1 w-full border rounded px-3 py-2" />
      </div>
      <div>
        <label htmlFor="message" className="block text-sm font-medium">Melding (valgfri)</label>
        <textarea id="message" value={form.message} onChange={(e) => set('message', e.target.value)} className="mt-1 w-full border rounded px-3 py-2" />
      </div>

      {consents.risk && (
        <label className="flex gap-2 text-sm">
          <input type="checkbox" checked={form.consentRisk} onChange={(e) => set('consentRisk', e.target.checked)} />
          <span>{settings.consent_risk_text_adult || settings.consent_risk_text}</span>
        </label>
      )}
      {consents.terms && (
        <label className="flex gap-2 text-sm">
          <input type="checkbox" checked={form.consentTerms} onChange={(e) => set('consentTerms', e.target.checked)} />
          <span>{settings.consent_terms_text}</span>
        </label>
      )}
      {consents.media && (
        <label className="flex gap-2 text-sm">
          <input type="checkbox" checked={form.consentMedia} onChange={(e) => set('consentMedia', e.target.checked)} />
          <span>{settings.consent_media_text_adult || settings.consent_media_text}</span>
        </label>
      )}
      {consents.activities && (
        <label className="flex gap-2 text-sm">
          <input type="checkbox" checked={form.consentActivities} onChange={(e) => set('consentActivities', e.target.checked)} />
          <span>{settings.consent_activities_text}</span>
        </label>
      )}

      <button type="submit" disabled={submitting} className="bg-bjerke-blue text-white px-6 py-2 rounded disabled:opacity-50">
        {submitting ? 'Sender...' : 'Send forespørsel'}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Forgren i page.tsx**

I `app/arrangementer/[type]/[year]/[slug]/pamelding/page.tsx`, etter `if (!course) notFound();`, returner RequestForm når request-modus:

```tsx
import RequestForm from './request-form';
// ...
  if (course.registrationMode === 'request') {
    return (
      <RequestForm
        courseId={course.id}
        courseName={course.name}
        courseType={type}
        requireLogin={course.requestRequiresLogin}
        consents={{
          risk: course.requestConsentRisk,
          terms: course.requestConsentTerms,
          media: course.requestConsentMedia,
          activities: course.requestConsentActivities,
        }}
      />
    );
  }

  return (
    <PameldingForm courseRef={{ type, year, slug }} courseName={course.name} isAdult={course.audience === 'voksen'} />
  );
```

- [ ] **Step 3: Verifiser typecheck + tester**

Run: `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vitest run`
Expected: exit 0, grønt.

- [ ] **Step 4: Commit**

```bash
git add "app/arrangementer/[type]/[year]/[slug]/pamelding/request-form.tsx" "app/arrangementer/[type]/[year]/[slug]/pamelding/page.tsx"
git commit -m "feat(public): request form for request-mode arrangements"
```

---

## Task 7: Admin — modus-felt i kursskjema + API

**Files:**
- Modify: `app/admin/courses/new/page.tsx`, `app/admin/courses/[id]/edit/page.tsx`, `app/api/admin/courses/route.ts`, `app/api/admin/courses/[id]/route.ts`

- [ ] **Step 1: API — godta nye felt + valgfri startDate ved request**

I `app/api/admin/courses/route.ts` (POST) og `[id]/route.ts` (PUT): legg feltene i destructuring (linje ~36 / ~50):

```typescript
const {
  name, description, type, audience, startDate, endDate, ageMin, ageMax,
  price, minParticipants, maxParticipants, status, slug, imageUrl,
  registrationMode, requestRequiresLogin,
  requestConsentRisk, requestConsentTerms, requestConsentMedia, requestConsentActivities,
} = body;

const mode = registrationMode === 'request' ? 'request' : 'standard';
```

Endre påkrevd-validering (linje ~38) til å ikke kreve `startDate` ved request:

```typescript
if (!name || !type || !status || (mode === 'standard' && !startDate)) {
  return NextResponse.json({ error: 'Mangler påkrevde felt' }, { status: 400 });
}
```

I prisma `create`/`update`-data, legg til:

```typescript
  startDate: startDate ? new Date(startDate) : null,
  registrationMode: mode,
  requestRequiresLogin: !!requestRequiresLogin,
  requestConsentRisk: requestConsentRisk !== false,
  requestConsentTerms: requestConsentTerms !== false,
  requestConsentMedia: !!requestConsentMedia,
  requestConsentActivities: !!requestConsentActivities,
```

(Behold eksisterende `audience`-normalisering. `startDate` settes nå null-safe i begge handlere.)

- [ ] **Step 2: new/page.tsx — state + felt**

Legg state (ved linje ~40):

```typescript
const [registrationMode, setRegistrationMode] = useState('standard');
const [requestRequiresLogin, setRequestRequiresLogin] = useState(false);
const [reqConsentRisk, setReqConsentRisk] = useState(true);
const [reqConsentTerms, setReqConsentTerms] = useState(true);
const [reqConsentMedia, setReqConsentMedia] = useState(false);
const [reqConsentActivities, setReqConsentActivities] = useState(false);
```

Legg i `data`-objektet (linje ~73):

```typescript
  registrationMode,
  requestRequiresLogin,
  requestConsentRisk: reqConsentRisk,
  requestConsentTerms: reqConsentTerms,
  requestConsentMedia: reqConsentMedia,
  requestConsentActivities: reqConsentActivities,
```

Legg UI rett etter audience-select:

```tsx
<div>
  <label htmlFor="registrationMode" className="block text-sm font-medium">Registreringsmodus</label>
  <select id="registrationMode" value={registrationMode} onChange={(e) => setRegistrationMode(e.target.value)} className="mt-1 w-full border rounded px-3 py-2">
    <option value="standard">Påmelding (fast dato/plasser)</option>
    <option value="request">Forespørsel (avtal tid)</option>
  </select>
</div>
{registrationMode === 'request' && (
  <div className="space-y-2 border-l-2 border-amber-200 pl-3">
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={requestRequiresLogin} onChange={(e) => setRequestRequiresLogin(e.target.checked)} /> Krev innlogging</label>
    <p className="text-sm font-medium">Samtykker som vises:</p>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={reqConsentRisk} onChange={(e) => setReqConsentRisk(e.target.checked)} /> Risiko/forsikring</label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={reqConsentTerms} onChange={(e) => setReqConsentTerms(e.target.checked)} /> Vilkår</label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={reqConsentMedia} onChange={(e) => setReqConsentMedia(e.target.checked)} /> Bilder/video</label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={reqConsentActivities} onChange={(e) => setReqConsentActivities(e.target.checked)} /> Aktiviteter</label>
  </div>
)}
```

Gjør dato-feltet ikke-påkrevd i UI når request (fjern `required` fra startDate-input når `registrationMode === 'request'`).

- [ ] **Step 3: edit/page.tsx — samme felt + populering**

Gjenta Step 2 i `[id]/edit/page.tsx`. I `CourseData`-interfacet (linje ~23) legg til: `registrationMode?: string; requestRequiresLogin?: boolean; requestConsentRisk?: boolean; requestConsentTerms?: boolean; requestConsentMedia?: boolean; requestConsentActivities?: boolean;`. I fetch-populeringen (linje ~160) sett state fra `c.*` med defaults (`c.registrationMode || 'standard'`, `c.requestConsentRisk ?? true`, osv.).

- [ ] **Step 4: Verifiser typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/admin/courses app/api/admin/courses
git commit -m "feat(admin): registration mode + request consents on course form/API"
```

---

## Task 8: Admin — generell forespørsler-side + booking-API rydding

**Files:**
- Create: `app/admin/foresporsler/page.tsx` (kopier struktur fra `app/admin/dobbeltsulky/page.tsx`)
- Modify: `app/api/admin/bookings/route.ts`, `app/api/admin/bookings/[id]/route.ts`, `app/admin/AdminShell.tsx`

- [ ] **Step 1: Booking-liste-API inkluderer arrangement**

I `app/api/admin/bookings/route.ts`, endre spørringen:

```typescript
const bookings = await prisma.bookingRequest.findMany({
  orderBy: { createdAt: 'desc' },
  include: { course: { select: { name: true } } },
});
```

- [ ] **Step 2: Rett status-mismatch**

I `app/api/admin/bookings/[id]/route.ts` linje ~18, endre til UI-verdiene:

```typescript
const VALID_STATUSES = ['new', 'confirmed', 'cancelled'];
```

- [ ] **Step 3: Lag forespørsler-siden**

Kopier `app/admin/dobbeltsulky/page.tsx` til `app/admin/foresporsler/page.tsx`. Endre: fjern `dobbeltsulky_enabled`-sjekken og settings-fetch (linjer ~36–46) — list alltid forespørsler. Legg en kolonne «Arrangement» som viser `booking.course?.name ?? '—'`. Behold status-oppdatering (`new`/`confirmed`/`cancelled`). Oppdater Booking-interfacet med `course?: { name: string } | null`.

- [ ] **Step 4: Oppdater admin-navigasjon**

I `app/admin/AdminShell.tsx`, i `navItems`, endre dobbeltsulky-oppføringen til Forespørsler:

```typescript
{ href: '/admin/foresporsler', label: 'Forespørsler', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
```

Oppdater også breadcrumb-`labelMap` (legg `foresporsler: 'Forespørsler'`, fjern `dobbeltsulky`).

- [ ] **Step 5: Verifiser typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add app/admin/foresporsler app/api/admin/bookings app/admin/AdminShell.tsx
git commit -m "feat(admin): generic forespørsler list with arrangement, fix booking status values"
```

---

## Task 9: Fjern dobbeltsulky-spesifikk kode

**Files:**
- Delete: `app/api/dobbeltsulky/route.ts`, `app/arrangementer/dobbeltsulky/page.tsx`, `app/admin/dobbeltsulky/page.tsx`
- Modify: `app/arrangementer/page.tsx`, `lib/settings.ts`, `app/api/settings/public/route.ts`

- [ ] **Step 1: Slett bespoke-filene**

```bash
git rm "app/api/dobbeltsulky/route.ts" "app/arrangementer/dobbeltsulky/page.tsx" "app/admin/dobbeltsulky/page.tsx"
```

- [ ] **Step 2: Fjern dobbeltsulky-CTA fra arrangementsliste**

I `app/arrangementer/page.tsx`, fjern `isDobbeltsulkyEnabled`-funksjonen (linjer ~20–29), kallet i `Promise.all` (linje ~58–60), og hele `{dobbeltsulkyEnabled && (...)}`-blokken (linjer ~79–96).

- [ ] **Step 3: Fjern dobbeltsulky-innstillinger**

I `lib/settings.ts`, slett linjene `dobbeltsulky_enabled`/`dobbeltsulky_description`/`dobbeltsulky_points` (62–64). I `app/api/settings/public/route.ts`, fjern de tre `dobbeltsulky_*`-nøklene fra `PUBLIC_KEYS`.

- [ ] **Step 4: Verifiser ingen gjenværende referanser**

Run: `grep -rn "dobbeltsulky_enabled\|/api/dobbeltsulky\|arrangementer/dobbeltsulky\|admin/dobbeltsulky" app lib`
Expected: ingen treff (sulky.*-strings i `lib/strings.ts` kan bli stående — de er ufarlige og kan gjenbrukes/ryddes senere).

- [ ] **Step 5: Verifiser typecheck + tester**

Run: `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vitest run`
Expected: exit 0, grønt.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove bespoke dobbeltsulky subsystem (replaced by request mode)"
```

---

## Task 10: Sitemap — null-safe startDate

**Files:**
- Modify: `app/sitemap.ts` (~26–40)

- [ ] **Step 1: Hopp over udaterte arrangementer i sitemap**

Request-arrangementer (uten dato) har ingen `/{year}/`-URL. Filtrer dem ut:

```typescript
const courses = await prisma.course.findMany({
  where: { status: { in: ['open', 'full'] }, startDate: { not: null } },
  select: { name: true, slug: true, type: true, startDate: true, updatedAt: true },
});

const coursePages: MetadataRoute.Sitemap = courses.map((course) => {
  const slug = course.slug || generateSlug(course.name);
  const year = course.startDate!.getFullYear();
  return {
    url: `${baseUrl}/arrangementer/${course.type}/${year}/${slug}`,
    lastModified: course.updatedAt,
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  };
});
```

- [ ] **Step 2: Verifiser typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/sitemap.ts
git commit -m "fix(sitemap): skip request arrangements without startDate"
```

---

## Task 11: Datamigreringsskript

**Files:**
- Create: `scripts/migrate-dobbeltsulky.ts`

- [ ] **Step 1: Skriv migreringsskriptet**

```typescript
// scripts/migrate-dobbeltsulky.ts
// Kjør i Basefarm-brannmurvindu ETTER 'prisma db push':
//   ./node_modules/.bin/tsx scripts/migrate-dobbeltsulky.ts
import { prisma } from '../lib/prisma';

async function main() {
  const desc = await prisma.setting.findUnique({ where: { key: 'dobbeltsulky_description' } });

  // Idempotent: bruk en fast slug for å unngå duplikat ved ny kjøring.
  const existing = await prisma.course.findFirst({ where: { type: 'arrangement', slug: 'dobbeltsulky' } });
  const course = existing ?? await prisma.course.create({
    data: {
      name: 'Dobbeltsulky-kjøring',
      slug: 'dobbeltsulky',
      type: 'arrangement',
      audience: 'voksen',
      description: desc?.value ?? 'Dobbeltsulky-kjøring sammen med erfaren instruktør. Tid avtales individuelt.',
      startDate: null,
      status: 'open',
      registrationMode: 'request',
      requestRequiresLogin: false,
      requestConsentRisk: true,
      requestConsentTerms: true,
      requestConsentMedia: false,
      requestConsentActivities: false,
    },
  });

  // Knytt eksisterende forespørsler (uten course) til dette arrangementet.
  const linked = await prisma.bookingRequest.updateMany({
    where: { courseId: null },
    data: { courseId: course.id },
  });

  // Rydd gamle dobbeltsulky-innstillinger.
  await prisma.setting.deleteMany({
    where: { key: { in: ['dobbeltsulky_enabled', 'dobbeltsulky_description', 'dobbeltsulky_points'] } },
  });

  console.log(`Dobbeltsulky-arrangement: #${course.id}; koblet ${linked.count} forespørsler; ryddet innstillinger.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

> Bekreft at `tsx` er tilgjengelig (`./node_modules/.bin/tsx --version`); hvis ikke, kjør via `pnpm dlx tsx` eller legg til som devDependency.

- [ ] **Step 2: Verifiser typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-dobbeltsulky.ts
git commit -m "chore: data migration script for dobbeltsulky → request arrangement"
```

---

## Task 12: Sluttverifisering + deploy-notat

- [ ] **Step 1: Full verifisering**

Run: `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vitest run`
Expected: exit 0, alle tester grønne.

- [ ] **Step 2: Manuell røyktest lokalt**

Mot lokal dev-DB: opprett et request-arrangement i admin (begge varianter: uten/med innlogging, ulike samtykker), send en forespørsel offentlig, bekreft at den dukker opp under `/admin/foresporsler` med arrangementsnavn, og at server-feilmelding vises ved manglende påkrevd samtykke.

- [ ] **Step 3: Push branch + åpne PR**

```bash
git push origin feat/foresporsel-arrangement
gh pr create --base main --title "Forespørsel-arrangement (dobbeltsulky-konsolidering)" --body "Implementerer docs/superpowers/specs/2026-06-19-foresporsel-arrangement-konsolidering-design.md"
```

- [ ] **Step 4: Prod-deploy (krever Basefarm-vindu)**

Avtal brannmurvindu. Deretter, fra prod-tilkobling:
1. `./node_modules/.bin/prisma db push` (mot prod) — legger til nye kolonner + gjør `start_date` nullbar.
2. `./node_modules/.bin/tsx scripts/migrate-dobbeltsulky.ts` (mot prod) — oppretter arrangementet, kobler forespørsler, rydder innstillinger.
3. Deploy app via `scripts/deploy-app.sh`.
4. Røyktest på registrering.bjerke.no: dobbeltsulky-arrangementet vises med «Avtal tid»-badge; forespørsel virker; admin ser den.

> Vurder samtidig å legge migrasjonen inn som versjonert `prisma migrate` i repoet (audit-item) i stedet for `db push`.

---

## Self-Review (utført)

**Spec-dekning:** Alle spec-seksjoner har en task — datamodell (T1), samtykkelogikk (T2), kort/badge + null-startDate (T3, T10), e-post (T4), endepunkt + rate limit (T5), offentlig flyt + feilvisning (T6), admin modus + forespørsler (T7, T8), opprydding (T9), migrering + brannmur (T11, T12). ✓

**Placeholder-skann:** Ingen TBD/«handle edge cases»; alle kode-steg har faktisk kode. ✓

**Type-konsistens:** `bookingConsentError(config, submitted)`, `toCourseCardProps(course)`, `registrationMode`/`requestRequiresLogin`/`requestConsent*` brukt likt i schema (T1), API (T5, T7), form (T6) og migrering (T11). `BookingEmail.courseName` lagt til i T4 og brukt i T5. ✓

**Kjente avhengigheter mellom tasks:** T4 etterlater en midlertidig `courseName: 'Dobbeltsulky'` i `/api/dobbeltsulky` for å holde `tsc` grønn til filen slettes i T9 — bevisst og dokumentert.
