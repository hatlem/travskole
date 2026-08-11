# Booking-side checkout-UI — Design Spec

*Kunde- og admin-flyt for betaling av booking-forespørsler: admin bekrefter → kunden får en betalingsavhengig godkjenning-e-post → kunden betaler via en offentlig token-lenke eller innlogget «Mine bookinger». Backend (checkout-API + token) finnes allerede fra delprosjekt 2b — dette er kun kunde-UI + bekreftelse-triggeren.*

## Kontekst

Dagens flyt: kunde sender booking-forespørsel (`POST /api/bookings` → `BookingRequest` status `new` + «mottatt»-e-post). Admin bekrefter/kansellerer i `/admin/foresporsler` via `PUT /api/admin/bookings/[id]` (setter status, syncer CRM, emitter `booking.status_changed`). **Gap:** ved bekreftelse varsles ikke kunden, og det finnes ingen kunde-UI for å betale — selv om checkout-API-et allerede støtter booking.

**Bekreftet allerede i backend (INGEN endring nødvendig):**
- `CheckoutTokenKind = 'registration' | 'booking'` (lib/payments/checkout-token.ts) — booking-kind finnes; `verifyCheckoutToken` godtar den; TTL settes av kalleren (`expMs`), så en langtlevende godkjennings-token trenger ingen lib-endring.
- `POST /api/payments/checkout` har full booking-sti: beløp = `course.price × participants` (aldri fra klient), eierskap via sesjon-e-postmatch ELLER gyldig token (kind+id må matche raden nøyaktig).
- `/betaling/takk` resolver allerede booking-betalingsstatus via `paymentRef`.

**Non-goals:** endring av checkout-API/token-lib; schema-endring (BookingRequest har alle feltene); refusjons-UI; endring av admin-booking-listen utover bekreftelse-triggeren; endring av `POST /api/bookings` (opprettelse) eller `registration_confirmed`.

## 1. Admin-bekreftelse-trigger (godkjenning-e-post)

I `PUT /api/admin/bookings/[id]`, KUN ved overgang *inn i* `confirmed` (les nåværende status FØR update; hvis den allerede var `confirmed`, ikke send — unngår re-send ved gjentatte lagringer):
- Last kurset (via `booking.courseId`). Beregn `amountKr = course.price != null ? course.price * booking.participants : null`.
- **Online betaling gjelder** hvis `parsePaymentMethods(course.paymentMethods)` inneholder `stripe` eller `vipps`, OG `amountKr != null && amountKr > 0`, OG `booking.paymentStatus ∈ {none, pending}`.
- Hvis online betaling gjelder → signer `signCheckoutToken({ kind:'booking', id: booking.id, expMs: Date.now() + BOOKING_CHECKOUT_TOKEN_TTL_MS })` (14 dager), bygg betal-URL `${getBaseUrl()}/betaling/booking?token=${token}`, og send `sendBookingApprovedPayEmail`.
- Ellers → send `sendBookingApprovedEmail` (godkjent; faktura kommer / ingen online betaling; ingen lenke).
- Alt fire-safe (`.catch(() => {})`) — en e-postfeil skal aldri velte statusendringen. Beslutningen om hvilken e-post kapsles i en ren, testbar funksjon (seksjon 7).

`BOOKING_CHECKOUT_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000` (14 dager) — vesentlig lengre enn registrerings-tokenens korte levetid, siden lenken sendes på e-post og brukes senere.

## 2. Offentlig betalingsside `/betaling/booking`

Server Component, `force-dynamic`. Leser `?token=`:
- `verifyCheckoutToken(token)` → hvis null, eller `kind !== 'booking'` → vis «Lenken er ugyldig eller utløpt. Logg inn på **Mine bookinger** for å betale, eller kontakt oss.» (lenke til `/mine-bookinger`).
- Ellers last `BookingRequest` (via `payload.id`) + kurs. Tilstander:
  - `paymentStatus === 'paid'` → «Betalingen er allerede mottatt — takk!» (grønn), ingen knapp.
  - `status === 'cancelled'` → «Denne bookingen er kansellert.» (grå), ingen knapp.
  - ellers → vis oppsummering (kursnavn, deltakere, `amountKr`) + `<BookingCheckout bookingRequestId=… token=… providers=… />`.
- Post-betaling redirect håndteres av eksisterende `/betaling/takk` (allerede booking-aware).

## 3. Innlogget «Mine bookinger» `/mine-bookinger`

Server Component, krever sesjon (`getServerSession`; uinnlogget → redirect til login med callback). Lenkes fra `/dashboard`.
- Last bookinger med SAMME eierskapsregel som checkout-API-et: `where: { OR: [ { email: { equals: sessionEmail, mode: 'insensitive' } }, ...(sessionUserId ? [{ userId: sessionUserId }] : []) ] }`. **Case-insensitiv e-postmatch** er nødvendig fordi `booking.email` lagres i original kasus mens checkout-API-et sammenligner lowercased (`booking.email.toLowerCase()`); Postgres `mode: 'insensitive'` gir samme semantikk. Kontoene er e-post-verifiserte, så e-postmatch er trygt og dekker anonyme bookinger laget med samme e-post. Nyeste først.
- Per booking: kursnavn, deltakere, `preferredDate`, status-merke, betalingsstatus-merke (gjenbruk `paymentStatusBadge` fra delprosjekt 7 der det passer). For `status==='confirmed'` + online-betalbar + `paymentStatus ∈ {none, pending}` → `<BookingCheckout bookingRequestId=… providers=… />` (sesjon-eierskap, INGEN token). `paid` → «Betalt»-merke.
- Tom liste → vennlig empty-state.

## 4. Delt `BookingCheckout`-klientkomponent

`'use client'`. Props: `bookingRequestId: number`, `providers: ('stripe'|'vipps')[]` (utledet fra kursets `paymentMethods`), `token?: string`.
- Rendrer én knapp per tillatt provider («Betal med kort (Stripe)» / «Betal med Vipps»).
- Klikk → `POST /api/payments/checkout` med `{ bookingRequestId, provider, ...(token ? { token } : {}) }` → ved 200 `window.location.href = data.url`; ved feil vis inline feilmelding. Laster-tilstand på knappen (deaktivert + spinner-tekst).
- Gjenbrukt av offentlig side (token) og Mine bookinger (sesjon). Ingen beløp/logikk i klienten — alt fra API-et.

## 5. E-poster (lib/mail.ts)

To nye funksjoner, norsk, gjenbruker `wrapEmailHtml` + `sendMail`:
- `sendBookingApprovedPayEmail(data)` — «{kurs} er godkjent! Fullfør betaling ({beløp} kr for {deltakere} plass(er))» + tydelig «Betal nå»-knapp/lenke (`payUrl`). Nevner at lenken er gyldig i 14 dager + at man ellers kan betale via Mine bookinger.
- `sendBookingApprovedEmail(data)` — «{kurs} er godkjent!» + at faktura sendes / ingen online betaling kreves. Ingen betal-lenke.
Begge inkluderer kursnavn, deltakere, ev. `preferredDate`, kontakt-e-post.

## 6. Feil/kant-tilfeller

- Utløpt token (offentlig side) → login-fallback-melding (Mine bookinger). Den innloggede stien fungerer alltid uavhengig av token-utløp.
- Allerede betalt → begge sider viser «betalt», ingen knapp; checkout-API-et ville uansett avvist re-betaling (monoton pengetilstandsmaskin, delprosjekt 2b/7).
- Kansellert booking → ingen betaling.
- `amountKr == null` (kurs uten pris) → behandles som «ingen online betaling» (plain godkjenning-e-post, ingen pay-knapp).
- Booking uten `courseId` (generell forespørsel) → ingen online betaling (plain e-post).

## 7. Testing & scope

- **Enhet (rene, mockfrie/mock-prisma):**
  - `decideBookingApprovalEmail({ prevStatus, newStatus, paymentMethods, amountKr, paymentStatus })` → `'pay' | 'plain' | 'none'` (`none` når ikke overgang inn i confirmed). Dekker alle grener (online→pay, faktura→plain, allerede confirmed→none, kansellert-input→none, amount null→plain).
  - Eierskaps-`where` for Mine bookinger (email/userId-match) — bygges av en ren hjelper, testet.
  - `BOOKING_CHECKOUT_TOKEN_TTL_MS` gir en token som `verifyCheckoutToken` godtar innen 14 dager og avviser etter (gjenbruk token-lib-testene / én ny case).
- **Integrasjon/live-smoke (tsx, selvryddende):** opprett booking mot online-betalings-kurs → `PUT status=confirmed` → verifiser at en booking-token utstedes og `decide…` gir `pay`; kall checkout-API-et med `{ bookingRequestId, provider:'stripe', token }` → forvent en checkout-URL (eller 503 uten Stripe-nøkler, som i delprosjekt 2b-smoken) uten å faktisk betale; rydd opp.
- **Testarkitektur:** vitest DB-uavhengig (mock prisma); UI-sidene verifiseres via tsc + build (repoet har ingen RTL). Live E2E via tsx-smoke.
- **Ingen** schema-, env-, checkout-API- eller token-lib-endring. Følger prod ved neste ordinære deploy (ingen migrering).
