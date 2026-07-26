# Booking-side checkout-UI — Implementasjonsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La kunden betale for en bekreftet booking-forespørsel — via en betalingsavhengig godkjenning-e-post med signert betal-lenke (offentlig side) OG en innlogget «Mine bookinger»-side — uten noen backend-endring (checkout-API + token støtter allerede booking).

**Architecture:** Admin-bekreftelse (`PUT /api/admin/bookings/[id]`, overgang inn i `confirmed`) utløser en ren beslutning (`decideBookingApprovalEmail`) → enten en betal-e-post (signert 14-dagers `kind:'booking'`-token → offentlig `/betaling/booking?token=`) eller en plain godkjenning-e-post. Begge betalingsinngangene (offentlig token-side + innlogget `/mine-bookinger`) bruker en delt `BookingCheckout`-klientkomponent som kaller det eksisterende `POST /api/payments/checkout`.

**Tech Stack:** Next.js 16 (App Router), Prisma/Postgres, Vitest, TypeScript strict, pnpm, Tailwind.

## Global Constraints

- INGEN endring av `POST /api/payments/checkout`, `lib/payments/checkout-token.ts`, schema, eller env. (Alt støtter allerede booking: `CheckoutTokenKind` har `'booking'`; checkout-ruta har booking-sti med beløp `course.price × participants` og eierskap via sesjon-e-postmatch ELLER token.)
- Checkout-suksessrespons er `{ url }` — klienten redirecter til `data.url`. Checkout-ruta setter selv `paymentStatus:'pending'` + `paymentRef` (P2002 → 409 «Betaling er allerede startet»).
- Bekreftelse-e-post sendes KUN ved overgang *inn i* `confirmed` (forrige status ≠ `confirmed`). Fire-safe (`.catch(() => {})`) — e-postfeil velter aldri statusendringen.
- Betal-e-post/betal-knapp KUN når online betaling gjelder: `paymentMethods` har `stripe`|`vipps`, `amountKr != null && > 0`, `paymentStatus ∈ {none, pending}`. Ellers plain e-post / ingen knapp.
- `BOOKING_CHECKOUT_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000` (14 dager).
- Mine-bookinger-eierskap = SAMME som checkout-API: case-insensitiv e-postmatch (`mode:'insensitive'`) ELLER `userId`-match.
- UI-sider har ingen RTL i repoet → verifiseres med tsc + eslint + `pnpm build`. Logikk (`decide…`, `bookingOwnershipWhere`) TDD-es. Live E2E via tsx-smoke. Vitest-suiten forblir DB-uavhengig (mock prisma).

---

### Task 1: Ren beslutning + TTL — `lib/bookings/approval-email.ts`

**Files:**
- Create: `lib/bookings/approval-email.ts`
- Test: `tests/booking-approval-email.test.ts`

**Interfaces:**
- Produces: `BOOKING_CHECKOUT_TOKEN_TTL_MS: number`; `decideBookingApprovalEmail(input): 'pay' | 'plain' | 'none'`.

- [ ] **Step 1: Failende tester** (`tests/booking-approval-email.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { decideBookingApprovalEmail, BOOKING_CHECKOUT_TOKEN_TTL_MS } from '@/lib/bookings/approval-email';

const base = { prevStatus: 'new', newStatus: 'confirmed', paymentMethods: ['stripe', 'faktura'], amountKr: 500, paymentStatus: 'none' };

describe('decideBookingApprovalEmail', () => {
  it('overgang inn i confirmed + online + beløp + ubetalt → pay', () => {
    expect(decideBookingApprovalEmail(base)).toBe('pay');
    expect(decideBookingApprovalEmail({ ...base, paymentMethods: ['vipps'] })).toBe('pay');
  });
  it('kun faktura → plain', () => {
    expect(decideBookingApprovalEmail({ ...base, paymentMethods: ['faktura'] })).toBe('plain');
  });
  it('ikke overgang inn i confirmed → none', () => {
    expect(decideBookingApprovalEmail({ ...base, prevStatus: 'confirmed' })).toBe('none');
    expect(decideBookingApprovalEmail({ ...base, newStatus: 'cancelled' })).toBe('none');
    expect(decideBookingApprovalEmail({ ...base, newStatus: 'new' })).toBe('none');
  });
  it('manglende/0 beløp → plain', () => {
    expect(decideBookingApprovalEmail({ ...base, amountKr: null })).toBe('plain');
    expect(decideBookingApprovalEmail({ ...base, amountKr: 0 })).toBe('plain');
  });
  it('allerede betalt/refundert → plain (ingen betal-lenke)', () => {
    expect(decideBookingApprovalEmail({ ...base, paymentStatus: 'paid' })).toBe('plain');
  });
  it('TTL er 14 dager', () => {
    expect(BOOKING_CHECKOUT_TOKEN_TTL_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Kjør — FEILER.** `pnpm exec vitest run tests/booking-approval-email.test.ts`

- [ ] **Step 3: Implementer**

```ts
/**
 * Ren beslutning for hvilken godkjenning-e-post en booking skal få når admin
 * bekrefter den. Ingen IO — testbar. Se spec 2026-07-26-booking-checkout-ui.
 */
export const BOOKING_CHECKOUT_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 dager

export type BookingApprovalEmailDecision = 'pay' | 'plain' | 'none';

export function decideBookingApprovalEmail(input: {
  prevStatus: string;
  newStatus: string;
  paymentMethods: string[];
  amountKr: number | null;
  paymentStatus: string;
}): BookingApprovalEmailDecision {
  // Kun ved overgang INN I confirmed (unngår re-send ved gjentatte lagringer).
  if (input.newStatus !== 'confirmed' || input.prevStatus === 'confirmed') return 'none';
  const onlineAllowed = input.paymentMethods.includes('stripe') || input.paymentMethods.includes('vipps');
  const payable = input.amountKr != null && input.amountKr > 0;
  const unpaid = input.paymentStatus === 'none' || input.paymentStatus === 'pending';
  return onlineAllowed && payable && unpaid ? 'pay' : 'plain';
}
```

- [ ] **Step 4: Kjør — PASS**; full suite + tsc.
- [ ] **Step 5: Commit** `git add lib/bookings/approval-email.ts tests/booking-approval-email.test.ts && git commit -m "feat(booking): pure approval-email decision + token TTL"`

---

### Task 2: Godkjenning-e-poster — `lib/mail.ts`

**Files:** Modify: `lib/mail.ts`

**Interfaces:**
- Produces: `sendBookingApprovedPayEmail(data: BookingEmail & { amountKr: number; payUrl: string }): Promise<void>`; `sendBookingApprovedEmail(data: BookingEmail): Promise<void>`. (`BookingEmail` finnes: `{ courseName, name, email, phone, participants, preferredDate?, message? }`.)

- [ ] **Step 1: Les `lib/mail.ts`** — spesielt `sendBookingConfirmation` (mønster: `getSettings()`, `sendMail(to, subject, html)`, `escapeHtml`). Følg samme stil.

- [ ] **Step 2: Legg til funksjonene** (etter `sendBookingConfirmation`):

```ts
export async function sendBookingApprovedPayEmail(
  data: BookingEmail & { amountKr: number; payUrl: string },
) {
  const settings = await getSettings();
  const adminEmail = settings.contact_email;
  const siteName = settings.site_name;
  await sendMail(
    data.email,
    `Booking godkjent — fullfør betaling for ${data.courseName}`,
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Hei ${escapeHtml(data.name)}!</h2>
      <p>Bookingen din for <strong>${escapeHtml(data.courseName)}</strong> er godkjent. Fullfør betalingen for å sikre plassen.</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Deltakere:</td><td>${data.participants}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Beløp:</td><td><strong>${data.amountKr.toLocaleString('nb-NO')} kr</strong></td></tr>
        ${data.preferredDate ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Ønsket dato:</td><td>${escapeHtml(new Date(data.preferredDate).toLocaleDateString('nb-NO'))}</td></tr>` : ''}
      </table>
      <p style="margin:24px 0">
        <a href="${escapeHtml(data.payUrl)}" style="background:#1d4ed8;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Betal nå</a>
      </p>
      <p style="color:#666;font-size:13px">Lenken er gyldig i 14 dager. Er du innlogget, kan du også betale under «Mine bookinger».</p>
      <p>Spørsmål? Ta kontakt på <a href="mailto:${escapeHtml(adminEmail)}">${escapeHtml(adminEmail)}</a></p>
      <p style="color:#666;margin-top:24px">Med vennlig hilsen,<br>${escapeHtml(siteName)}</p>
    </div>`,
  );
}

export async function sendBookingApprovedEmail(data: BookingEmail) {
  const settings = await getSettings();
  const adminEmail = settings.contact_email;
  const siteName = settings.site_name;
  await sendMail(
    data.email,
    `Booking godkjent — ${data.courseName}`,
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Hei ${escapeHtml(data.name)}!</h2>
      <p>Bookingen din for <strong>${escapeHtml(data.courseName)}</strong> er godkjent. Vi tar kontakt om det praktiske; eventuell faktura sendes separat.</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Deltakere:</td><td>${data.participants}</td></tr>
        ${data.preferredDate ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Ønsket dato:</td><td>${escapeHtml(new Date(data.preferredDate).toLocaleDateString('nb-NO'))}</td></tr>` : ''}
      </table>
      <p>Spørsmål? Ta kontakt på <a href="mailto:${escapeHtml(adminEmail)}">${escapeHtml(adminEmail)}</a></p>
      <p style="color:#666;margin-top:24px">Med vennlig hilsen,<br>${escapeHtml(siteName)}</p>
    </div>`,
  );
}
```
(Hvis `getSettings`/`escapeHtml`/`sendMail` ikke allerede er i skop i fila — de er det, brukt av `sendBookingConfirmation` — gjenbruk dem.)

- [ ] **Step 3: Verifiser** `pnpm exec tsc --noEmit` rent; `pnpm exec eslint lib/mail.ts` rent; full suite grønn (uendret).
- [ ] **Step 4: Commit** `git add lib/mail.ts && git commit -m "feat(mail): booking approved (pay / plain) emails"`

---

### Task 3: Bekreftelse-trigger — `app/api/admin/bookings/[id]/route.ts`

**Files:**
- Modify: `app/api/admin/bookings/[id]/route.ts`
- Test: `tests/admin-booking-approval-trigger.test.ts`

**Interfaces:**
- Consumes: `decideBookingApprovalEmail`, `BOOKING_CHECKOUT_TOKEN_TTL_MS` (Task 1); `sendBookingApprovedPayEmail`, `sendBookingApprovedEmail` (Task 2); `signCheckoutToken` (`@/lib/payments/checkout-token`); `parsePaymentMethods` (`@/lib/payments`); `getBaseUrl` (`@/lib/site`).

- [ ] **Step 1: Les hele `app/api/admin/bookings/[id]/route.ts`.** Nåværende `PUT` gjør `bookingRequest.update` direkte. Du må lese FORRIGE status før update.

- [ ] **Step 2: Failende test** (`tests/admin-booking-approval-trigger.test.ts`, mock prisma + mail + token)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prisma = vi.hoisted(() => ({
  bookingRequest: { findUnique: vi.fn(), update: vi.fn() },
  course: { findUnique: vi.fn() },
  contact: { findUnique: vi.fn(async () => null) },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn(async () => ({ user: { email: 'admin@x.no' } })) }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/crm/bridge', () => ({ syncBookingToCrm: vi.fn(async () => {}) }));
vi.mock('@/lib/events/bus', () => ({ emitEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/crm/normalize', () => ({ normalizeEmail: (e: string) => e.toLowerCase() }));
vi.mock('@/lib/site', () => ({ getBaseUrl: () => 'https://x.no' }));
const mail = vi.hoisted(() => ({ sendBookingApprovedPayEmail: vi.fn(async () => {}), sendBookingApprovedEmail: vi.fn(async () => {}) }));
vi.mock('@/lib/mail', () => mail);

import { PUT } from '@/app/api/admin/bookings/[id]/route';

const req = (body: unknown) => new Request('http://x', { method: 'PUT', body: JSON.stringify(body) }) as unknown as Parameters<typeof PUT>[0];
const ctx = { params: Promise.resolve({ id: '5' }) };

beforeEach(() => {
  vi.clearAllMocks();
  prisma.bookingRequest.update.mockResolvedValue({ id: 5, email: 'k@x.no', name: 'Kari', courseId: 9, participants: 2, preferredDate: null, phone: '0', paymentStatus: 'none', status: 'confirmed' });
});

describe('PUT booking: approval-e-post-trigger', () => {
  it('new→confirmed på online-kurs → betal-e-post med token-lenke', async () => {
    prisma.bookingRequest.findUnique.mockResolvedValue({ status: 'new' });
    prisma.course.findUnique.mockResolvedValue({ name: 'Ponni', price: 500, paymentMethods: 'stripe,faktura' });
    await PUT(req({ status: 'confirmed' }), ctx);
    expect(mail.sendBookingApprovedPayEmail).toHaveBeenCalledTimes(1);
    const arg = mail.sendBookingApprovedPayEmail.mock.calls[0][0];
    expect(arg.amountKr).toBe(1000); // 500 × 2
    expect(arg.payUrl).toContain('/betaling/booking?token=');
    expect(mail.sendBookingApprovedEmail).not.toHaveBeenCalled();
  });
  it('new→confirmed på faktura-kurs → plain e-post', async () => {
    prisma.bookingRequest.findUnique.mockResolvedValue({ status: 'new' });
    prisma.course.findUnique.mockResolvedValue({ name: 'Ponni', price: 500, paymentMethods: 'faktura' });
    await PUT(req({ status: 'confirmed' }), ctx);
    expect(mail.sendBookingApprovedEmail).toHaveBeenCalledTimes(1);
    expect(mail.sendBookingApprovedPayEmail).not.toHaveBeenCalled();
  });
  it('confirmed→confirmed → ingen e-post', async () => {
    prisma.bookingRequest.findUnique.mockResolvedValue({ status: 'confirmed' });
    prisma.course.findUnique.mockResolvedValue({ name: 'Ponni', price: 500, paymentMethods: 'stripe' });
    await PUT(req({ status: 'confirmed' }), ctx);
    expect(mail.sendBookingApprovedPayEmail).not.toHaveBeenCalled();
    expect(mail.sendBookingApprovedEmail).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Kjør — FEILER.**

- [ ] **Step 4: Implementer.** Legg til imports:
```ts
import { decideBookingApprovalEmail, BOOKING_CHECKOUT_TOKEN_TTL_MS } from '@/lib/bookings/approval-email';
import { sendBookingApprovedPayEmail, sendBookingApprovedEmail } from '@/lib/mail';
import { signCheckoutToken } from '@/lib/payments/checkout-token';
import { parsePaymentMethods } from '@/lib/payments';
import { getBaseUrl } from '@/lib/site';
```
I `PUT`, FØR `bookingRequest.update`, les forrige status:
```ts
  const existing = await prisma.bookingRequest.findUnique({ where: { id: Number(id) }, select: { status: true } });
  const prevStatus = existing?.status ?? '';
```
Behold den eksisterende `update` (den returnerer `booking`) og de eksisterende `logActivity`/`syncBookingToCrm`/`emitEvent`-kallene UENDRET. Legg til ETTER dem (før `return`):
```ts
  // Godkjenning-e-post (fire-safe): kun ved overgang inn i confirmed.
  (async () => {
    const course = booking.courseId
      ? await prisma.course.findUnique({ where: { id: booking.courseId }, select: { name: true, price: true, paymentMethods: true } })
      : null;
    const amountKr = course?.price != null ? course.price * booking.participants : null;
    const decision = decideBookingApprovalEmail({
      prevStatus,
      newStatus: booking.status,
      paymentMethods: parsePaymentMethods(course?.paymentMethods ?? ''),
      amountKr,
      paymentStatus: booking.paymentStatus,
    });
    if (decision === 'none') return;
    const emailData = {
      courseName: course?.name ?? 'Booking',
      name: booking.name, email: booking.email, phone: booking.phone,
      participants: booking.participants, preferredDate: booking.preferredDate, message: booking.message ?? null,
    };
    if (decision === 'pay' && amountKr != null) {
      const token = signCheckoutToken({ kind: 'booking', id: booking.id, expMs: Date.now() + BOOKING_CHECKOUT_TOKEN_TTL_MS });
      const payUrl = `${getBaseUrl()}/betaling/booking?token=${encodeURIComponent(token)}`;
      await sendBookingApprovedPayEmail({ ...emailData, amountKr, payUrl });
    } else {
      await sendBookingApprovedEmail(emailData);
    }
  })().catch(() => {});
```
(NB: `booking.message` finnes på raden; hvis `update`-selecten ikke returnerer alle feltene, sørg for at `update` returnerer `message`/`phone`/`preferredDate`/`participants`/`paymentStatus` — standard `update` uten `select` returnerer alle skalarer, så det er dekket.)

- [ ] **Step 5: Kjør — PASS**; full suite + tsc + `pnpm exec eslint "app/api/admin/bookings/[id]/route.ts"`.
- [ ] **Step 6: Commit** `git add "app/api/admin/bookings/[id]/route.ts" tests/admin-booking-approval-trigger.test.ts && git commit -m "feat(booking): send approval email + pay-link on confirm"`

---

### Task 4: Eierskaps-hjelper — `lib/bookings/ownership.ts`

**Files:**
- Create: `lib/bookings/ownership.ts`
- Test: `tests/booking-ownership.test.ts`

**Interfaces:**
- Produces: `bookingOwnershipWhere(sessionEmail: string, sessionUserId: number | null)` → Prisma `where`-fragment for `bookingRequest`.

- [ ] **Step 1: Failende test**

```ts
import { describe, it, expect } from 'vitest';
import { bookingOwnershipWhere } from '@/lib/bookings/ownership';

describe('bookingOwnershipWhere', () => {
  it('e-post (case-insensitiv) + userId', () => {
    expect(bookingOwnershipWhere('k@x.no', 7)).toEqual({
      OR: [{ email: { equals: 'k@x.no', mode: 'insensitive' } }, { userId: 7 }],
    });
  });
  it('kun e-post når userId null', () => {
    expect(bookingOwnershipWhere('k@x.no', null)).toEqual({
      OR: [{ email: { equals: 'k@x.no', mode: 'insensitive' } }],
    });
  });
});
```

- [ ] **Step 2: Kjør — FEILER. Step 3: Implementer**

```ts
import type { Prisma } from '@prisma/client';

/** Eierskaps-where for en brukers bookinger — samme regel som checkout-API-et:
 *  case-insensitiv e-postmatch ELLER userId-match. E-postene er verifiserte. */
export function bookingOwnershipWhere(sessionEmail: string, sessionUserId: number | null): Prisma.BookingRequestWhereInput {
  return {
    OR: [
      { email: { equals: sessionEmail, mode: 'insensitive' } },
      ...(sessionUserId != null ? [{ userId: sessionUserId }] : []),
    ],
  };
}
```

- [ ] **Step 4: Kjør — PASS**; full suite + tsc.
- [ ] **Step 5: Commit** `git add lib/bookings/ownership.ts tests/booking-ownership.test.ts && git commit -m "feat(booking): ownership where-helper (email/userId)"`

---

### Task 5: Delt `BookingCheckout`-komponent — `components/BookingCheckout.tsx`

**Files:** Create: `components/BookingCheckout.tsx`

**Interfaces:**
- Produces: `<BookingCheckout bookingRequestId={n} providers={['stripe'|'vipps']} token?={string} />`.

- [ ] **Step 1: Implementer** (`'use client'`). Én knapp per provider; kaller checkout-API-et; redirect til `data.url`.

```tsx
'use client';

import { useState } from 'react';

const PROVIDER_LABEL: Record<string, string> = { stripe: 'Betal med kort', vipps: 'Betal med Vipps' };

export function BookingCheckout({
  bookingRequestId,
  providers,
  token,
}: {
  bookingRequestId: number;
  providers: ('stripe' | 'vipps')[];
  token?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pay(provider: 'stripe' | 'vipps') {
    setBusy(provider);
    setError(null);
    try {
      const res = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingRequestId, provider, ...(token ? { token } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        setError(data.error || 'Kunne ikke starte betaling. Prøv igjen.');
        setBusy(null);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError('Kunne ikke starte betaling. Prøv igjen.');
      setBusy(null);
    }
  }

  if (providers.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {providers.map((p) => (
          <button
            key={p}
            onClick={() => pay(p)}
            disabled={busy !== null}
            className="bg-bjerke-blue text-white px-4 py-2 rounded-lg font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy === p ? 'Starter …' : PROVIDER_LABEL[p]}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Verifiser** tsc + `pnpm exec eslint components/BookingCheckout.tsx` + `pnpm build`.
- [ ] **Step 3: Commit** `git add components/BookingCheckout.tsx && git commit -m "feat(booking): shared BookingCheckout client component"`

---

### Task 6: Offentlig betalingsside — `app/betaling/booking/page.tsx`

**Files:** Create: `app/betaling/booking/page.tsx`

**Interfaces:**
- Consumes: `verifyCheckoutToken` (`@/lib/payments/checkout-token`), `BookingCheckout` (Task 5), `parsePaymentMethods` (`@/lib/payments`), `prisma`.

- [ ] **Step 1: Implementer** (Server Component, `force-dynamic`).

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { verifyCheckoutToken } from '@/lib/payments/checkout-token';
import { parsePaymentMethods } from '@/lib/payments';
import { BookingCheckout } from '@/components/BookingCheckout';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Betal booking', description: 'Fullfør betaling for din booking' };

function Box({ title, message, tone }: { title: string; message: string; tone: 'green' | 'gray' }) {
  const c = tone === 'green' ? 'border-green-200 bg-green-50 text-green-900' : 'border-gray-200 bg-gray-50 text-gray-800';
  return (
    <div className={`rounded-lg border ${c} p-8`}>
      <h2 className="text-xl font-bold mb-2">{title}</h2>
      <p className="mb-6">{message}</p>
      <Link href="/mine-bookinger" className="inline-block px-4 py-2 bg-bjerke-blue text-white rounded-lg font-medium hover:opacity-90">Mine bookinger</Link>
    </div>
  );
}

export default async function BookingBetalPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const payload = token ? verifyCheckoutToken(token) : null;

  let content: React.ReactNode;
  if (!payload || payload.kind !== 'booking') {
    content = <Box tone="gray" title="Lenken er ugyldig eller utløpt" message="Vi kunne ikke bekrefte betalingslenken. Logg inn på Mine bookinger for å betale, eller kontakt oss." />;
  } else {
    const booking = await prisma.bookingRequest.findUnique({
      where: { id: payload.id },
      include: { course: { select: { name: true, price: true, paymentMethods: true } } },
    });
    if (!booking || !booking.course) {
      content = <Box tone="gray" title="Fant ikke bookingen" message="Vi fant ikke bookingen. Kontakt oss hvis dette er feil." />;
    } else if (booking.paymentStatus === 'paid') {
      content = <Box tone="green" title="Betalingen er allerede mottatt — takk!" message="Bookingen din er betalt og bekreftet." />;
    } else if (booking.status === 'cancelled') {
      content = <Box tone="gray" title="Bookingen er kansellert" message="Denne bookingen er kansellert, og kan ikke betales." />;
    } else {
      const amountKr = booking.course.price != null ? booking.course.price * booking.participants : null;
      const providers = parsePaymentMethods(booking.course.paymentMethods).filter((m): m is 'stripe' | 'vipps' => m === 'stripe' || m === 'vipps');
      content = (
        <div className="rounded-lg border border-gray-200 bg-white p-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Fullfør betaling</h2>
          <table className="mb-6 text-sm"><tbody>
            <tr><td className="pr-6 py-1 text-gray-500">Arrangement</td><td className="font-medium">{booking.course.name}</td></tr>
            <tr><td className="pr-6 py-1 text-gray-500">Deltakere</td><td>{booking.participants}</td></tr>
            {amountKr != null && <tr><td className="pr-6 py-1 text-gray-500">Beløp</td><td className="font-semibold">{amountKr.toLocaleString('nb-NO')} kr</td></tr>}
          </tbody></table>
          {providers.length > 0 && amountKr != null
            ? <BookingCheckout bookingRequestId={booking.id} providers={providers} token={token} />
            : <p className="text-sm text-gray-600">Dette arrangementet har ingen online betaling. Vi tar kontakt om det praktiske.</p>}
        </div>
      );
    }
  }

  return (
    <main className="bg-white">
      <section className="bg-bjerke-blue text-white py-14"><div className="max-w-3xl mx-auto px-6"><h1 className="text-3xl sm:text-4xl font-bold">Betal booking</h1></div></section>
      <section className="py-12 px-6"><div className="max-w-3xl mx-auto">{content}</div></section>
    </main>
  );
}
```

- [ ] **Step 2: Verifiser** tsc + eslint + `pnpm build` (ruta `/betaling/booking` bygges).
- [ ] **Step 3: Commit** `git add app/betaling/booking/page.tsx && git commit -m "feat(booking): public token-based checkout page"`

---

### Task 7: «Mine bookinger» + dashboard-lenke — `app/mine-bookinger/page.tsx`

**Files:**
- Create: `app/mine-bookinger/page.tsx`
- Modify: `app/dashboard/page.tsx` (legg til lenke)

**Interfaces:**
- Consumes: `getServerSession` (`@/lib/auth`), `bookingOwnershipWhere` (Task 4), `normalizeEmail` (`@/lib/crm/normalize`), `parsePaymentMethods`, `BookingCheckout` (Task 5), `paymentStatusBadge` (`@/lib/payments/badge`).

- [ ] **Step 1: Implementer siden** (Server Component, `force-dynamic`). Les hvordan andre sider bruker `getServerSession` (f.eks. `app/dashboard/page.tsx`) for eksakt import/retur (session.user.email/id). Redirect uinnlogget til `/login?callbackUrl=/mine-bookinger`.

```tsx
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { normalizeEmail } from '@/lib/crm/normalize';
import { bookingOwnershipWhere } from '@/lib/bookings/ownership';
import { parsePaymentMethods } from '@/lib/payments';
import { paymentStatusBadge } from '@/lib/payments/badge';
import { BookingCheckout } from '@/components/BookingCheckout';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Mine bookinger' };

const STATUS_LABEL: Record<string, string> = { new: 'Til behandling', confirmed: 'Bekreftet', cancelled: 'Kansellert' };

export default async function MineBookingerPage() {
  const session = await getServerSession();
  if (!session?.user?.email) redirect('/login?callbackUrl=/mine-bookinger');
  const email = normalizeEmail(session.user.email)!;
  const userId = typeof session.user.id === 'number' ? session.user.id : (session.user.id ? Number(session.user.id) : null);

  const bookings = await prisma.bookingRequest.findMany({
    where: bookingOwnershipWhere(email, Number.isFinite(userId) ? (userId as number) : null),
    include: { course: { select: { name: true, price: true, paymentMethods: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <main className="max-w-3xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Mine bookinger</h1>
      {bookings.length === 0 ? (
        <p className="text-gray-600">Du har ingen bookinger ennå.</p>
      ) : (
        <ul className="space-y-4">
          {bookings.map((b) => {
            const amountKr = b.course?.price != null ? b.course.price * b.participants : null;
            const providers = parsePaymentMethods(b.course?.paymentMethods ?? '').filter((m): m is 'stripe' | 'vipps' => m === 'stripe' || m === 'vipps');
            const badge = paymentStatusBadge(b.paymentStatus);
            const canPay = b.status === 'confirmed' && providers.length > 0 && amountKr != null && (b.paymentStatus === 'none' || b.paymentStatus === 'pending');
            return (
              <li key={b.id} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{b.course?.name ?? 'Booking'}</p>
                    <p className="text-sm text-gray-500">{b.participants} deltaker(e){amountKr != null ? ` · ${amountKr.toLocaleString('nb-NO')} kr` : ''} · {STATUS_LABEL[b.status] ?? b.status}</p>
                  </div>
                  {badge && <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${badge.className}`}>{badge.label}</span>}
                </div>
                {canPay && <div className="mt-3"><BookingCheckout bookingRequestId={b.id} providers={providers} /></div>}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Legg til lenke i `app/dashboard/page.tsx`.** Les fila; legg til en lenke/kort til `/mine-bookinger` («Mine bookinger») konsistent med sidens eksisterende lenker/kort. (Minimal, additiv.)

- [ ] **Step 3: Verifiser** tsc + eslint (begge filer) + `pnpm build` + full suite grønn.
- [ ] **Step 4: Commit** `git add app/mine-bookinger/page.tsx app/dashboard/page.tsx && git commit -m "feat(booking): Mine bookinger page + dashboard link"`

---

### Task 8: Finish — verifikasjon + live smoke

**Files:** ingen nye.

- [ ] **Step 1: Full verifikasjon.** `pnpm exec tsc --noEmit` (rent), `pnpm test` (rapporter antall), `pnpm build` (OK). `pnpm exec eslint` på de nye filene.

- [ ] **Step 2: Live smoke (tsx, selvryddende).** Skriv `scripts/smoke-booking-checkout.ts` (IKKE commit) som:
  1. Oppretter et online-betalings-kurs (`paymentMethods:'stripe,faktura'`, `price`) + en `BookingRequest` (status `new`, `.invalid`-e-post).
  2. Kaller `PUT`-handleren (importer `PUT` fra ruta) med `{ status:'confirmed' }` og en mocket/gyldig admin-sesjon — ELLER, enklere, kall trigger-logikken via `decideBookingApprovalEmail` + `signCheckoutToken` direkte og verifiser at en `kind:'booking'`-token utstedes som `verifyCheckoutToken` godtar, og at `payUrl` peker på `/betaling/booking?token=`.
  3. Kall `POST /api/payments/checkout`-handleren med `{ bookingRequestId, provider:'stripe', token }` → forvent `{ url }` (eller 503 «Betaling er ikke konfigurert» uten Stripe-nøkler, som i delprosjekt 2b-smoken) — IKKE faktisk betaling. Bekreft eierskap-aksept via token.
  4. Verifiser Mine-bookinger-eierskap: `prisma.bookingRequest.findMany({ where: bookingOwnershipWhere(email, null) })` returnerer bookingen.
  5. Rydd opp (booking, kurs) + re-query. Rapporter PASS/FAIL.

Run: `npx tsx scripts/smoke-booking-checkout.ts` (alle PASS), `rm scripts/smoke-booking-checkout.ts`.

- [ ] **Step 3: Commit (kun hvis småfikser trengs)** ellers ingen.

---

## Self-Review

**Spec-dekning:** §1 bekreftelse-trigger → Task 1 (decide) + Task 2 (e-poster) + Task 3 (wiring); §2 offentlig side → Task 6; §3 Mine bookinger → Task 4 (ownership) + Task 7; §4 delt komponent → Task 5; §5 e-poster → Task 2; §6 kant-tilfeller (paid/cancelled/expired/amount-null) → Task 6 + Task 7 (canPay-guard) + decide (Task 1); §7 testing → per-task + Task 8. Ingen backend-endring — bekreftet (checkout-API/token urørt). Alle seksjoner dekket.

**Placeholder-scan:** Ingen TBD/TODO. UI-tasks (5–7) er verifisert via tsc/eslint/build (repoet har ingen RTL — bevisst, notert i Global Constraints). Task 8 live-smoke-scriptet beskrives eksakt (implementeren skriver det, standard for finish).

**Type-konsistens:** `decideBookingApprovalEmail(input)`-feltene identiske i Task 1 og Task 3-kallet. `BOOKING_CHECKOUT_TOKEN_TTL_MS` (Task 1) brukt i Task 3. `sendBookingApprovedPayEmail(BookingEmail & {amountKr,payUrl})` / `sendBookingApprovedEmail(BookingEmail)` (Task 2) kalt med samme form i Task 3. `signCheckoutToken({kind:'booking',id,expMs})` matcher lib-signaturen. `bookingOwnershipWhere(sessionEmail, sessionUserId)` (Task 4) brukt i Task 7. `<BookingCheckout bookingRequestId, providers, token?>` (Task 5) brukt i Task 6 (token) + Task 7 (sesjon). `paymentStatusBadge` (delprosjekt 7) gjenbrukt i Task 7. Checkout-respons `{ url }` konsumert i Task 5. Ingen drift.
```
