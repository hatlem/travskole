# Contact & CRM Core — Design Spec

*Subproject 1 of the Engagement Platform (see
`2026-07-06-engagement-platform-architecture.md`).*

## Overview

The CRM spine the whole platform hangs off. Staff manage **companies**
(`Organization`) and **people** (`Contact`), see a unified **timeline** per
subject, run a **pipeline** of deals (course signups and venue-event bookings —
julebord, firmafest, afterwork), and keep **tasks** and **notes**. Existing
`BookingRequest` and `Registration` rows are bridged into contacts/orgs/deals so
booking history — and thus re-engagement — works from day one.

This subproject deliberately excludes the flow engine, sending, and AI. It ships
the data model, the CRM admin UI, import, and the booking→CRM bridge. It emits
domain events through a thin `emitEvent()` seam (fully built in subproject 2) so
the timeline is populated, but does not yet act on them.

## Goals

- One record per company and per person, deduplicated by email/domain.
- A company shows every booking across all its contact people and years —
  making "book again this year" trivial.
- A pipeline where staff drag deals between stages, tagged by event type and date.
- A timeline that already captures bookings, registrations, notes, and tasks.
- Consent and suppression recorded up front, so later sending is compliant.

## Non-goals

- No flows, no email sending, no AI (subprojects 3–5).
- No behavioral/on-page event capture yet (subproject 2) — only server-side
  domain events from existing flows (booking, registration).

## Data Model

Conventions match the existing schema: `Int @default(autoincrement())` IDs,
`String` for enum-like and JSON columns, `@map`/`@@map` snake_case,
`createdAt`/`updatedAt` on every model.

### Organization

A company that books events. Optional — private course signups have none.

```prisma
model Organization {
  id            Int      @id @default(autoincrement())
  name          String
  orgNumber     String?  @map("org_number")   // Norwegian organisasjonsnummer
  domain        String?                        // e.g. "acme.no" — used for dedup
  phone         String?
  address       String?
  ownerId       Int?     @map("owner_id")      // staff User responsible
  stage         String   @default("lead")      // lifecycle: lead|active|customer|dormant|lost
  tags          String   @default("[]")        // JSON string[]
  customFields  String   @default("{}") @map("custom_fields") // JSON object
  lastActivityAt DateTime? @map("last_activity_at")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  owner    User?    @relation("OrgOwner", fields: [ownerId], references: [id], onDelete: SetNull)
  contacts Contact[]
  deals    Deal[]

  @@index([domain])
  @@index([stage])
  @@map("organizations")
}
```

### Contact

A person. May belong to an organization; may link to an existing `User`/`Parent`.

```prisma
model Contact {
  id             Int      @id @default(autoincrement())
  email          String?                        // nullable: some contacts are phone-only
  name           String
  phone          String?
  organizationId Int?     @map("organization_id")
  roleTitle      String?  @map("role_title")    // e.g. "Arrangementsansvarlig"
  userId         Int?     @unique @map("user_id")    // link to auth User if they have an account
  parentId       Int?     @map("parent_id")          // link to Parent if applicable
  source         String   @default("manual")    // manual|import|booking|registration|signup
  ownerId        Int?     @map("owner_id")
  stage          String   @default("lead")      // lead|active|customer|dormant|lost
  tags           String   @default("[]")        // JSON string[]
  customFields   String   @default("{}") @map("custom_fields")
  lastActivityAt DateTime? @map("last_activity_at")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  organization Organization? @relation(fields: [organizationId], references: [id], onDelete: SetNull)
  owner        User?         @relation("ContactOwner", fields: [ownerId], references: [id], onDelete: SetNull)
  user         User?         @relation("ContactUser", fields: [userId], references: [id], onDelete: SetNull)
  parent       Parent?       @relation(fields: [parentId], references: [id], onDelete: SetNull)
  deals        Deal[]
  memberships  ContactListMembership[]
  activities   ContactActivity[]
  tasks        Task[]
  notes        Note[]
  consent      Consent?

  @@unique([email])
  @@index([organizationId])
  @@index([stage])
  @@map("contacts")
}
```

Dedup: on create/import, match by `email` (case-insensitive); merge rather than
duplicate. `@@unique([email])` enforces it at the DB level (nullable emails are
allowed to repeat under Postgres NULL semantics; phone-only contacts skip it).

### ContactList & membership

Static lists (import targets, manual groupings). Many-to-many.

```prisma
model ContactList {
  id        Int      @id @default(autoincrement())
  name      String
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  memberships ContactListMembership[]

  @@map("contact_lists")
}

model ContactListMembership {
  id        Int      @id @default(autoincrement())
  listId    Int      @map("list_id")
  contactId Int      @map("contact_id")
  addedAt   DateTime @default(now()) @map("added_at")

  list    ContactList @relation(fields: [listId], references: [id], onDelete: Cascade)
  contact Contact     @relation(fields: [contactId], references: [id], onDelete: Cascade)

  @@unique([listId, contactId])
  @@index([contactId])
  @@map("contact_list_memberships")
}
```

### Segment

Dynamic, rule-based membership evaluated on read (no stored membership rows).
Rules as JSON — e.g. `{ all: [{ field: "deal.eventType", op: "eq", value: "julebord" }, { field: "deal.eventDate", op: "lt", value: "2026-01-01" }] }`.
Consumed later by flow enrollment; here it powers CRM filtered views.

```prisma
model Segment {
  id        Int      @id @default(autoincrement())
  name      String
  rules     String   @default("{}")            // JSON rule tree
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("segments")
}
```

### Pipeline, Stage, Deal

A deal is a course signup or a venue-event booking. `eventType`/`eventDate`
carry the venue-event semantics that make seasonal re-engagement possible.
Multiple pipelines allowed (e.g. "Arrangementsbooking", "Kursrekruttering").

```prisma
model Pipeline {
  id        Int      @id @default(autoincrement())
  name      String
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  stages Stage[]
  deals  Deal[]

  @@map("pipelines")
}

model Stage {
  id         Int    @id @default(autoincrement())
  pipelineId Int    @map("pipeline_id")
  name       String
  position   Int    @default(0)               // order in the kanban
  isWon      Boolean @default(false) @map("is_won")
  isLost     Boolean @default(false) @map("is_lost")

  pipeline Pipeline @relation(fields: [pipelineId], references: [id], onDelete: Cascade)
  deals    Deal[]

  @@index([pipelineId])
  @@map("stages")
}

model Deal {
  id             Int       @id @default(autoincrement())
  title          String
  pipelineId     Int       @map("pipeline_id")
  stageId        Int       @map("stage_id")
  contactId      Int?      @map("contact_id")
  organizationId Int?      @map("organization_id")
  ownerId        Int?      @map("owner_id")
  value          Float?                             // NOK
  probability    Int?                               // 0-100
  eventType      String?   @map("event_type")       // julebord|firmafest|afterwork|kurs|annet
  eventDate      DateTime? @map("event_date")
  status         String    @default("open")         // open|won|lost
  closedAt       DateTime? @map("closed_at")
  source         String    @default("manual")       // manual|booking|registration
  bookingRequestId Int?    @unique @map("booking_request_id") // bridge to existing model
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  pipeline     Pipeline      @relation(fields: [pipelineId], references: [id], onDelete: Cascade)
  stage        Stage         @relation(fields: [stageId], references: [id], onDelete: Restrict)
  contact      Contact?      @relation(fields: [contactId], references: [id], onDelete: SetNull)
  organization Organization? @relation(fields: [organizationId], references: [id], onDelete: SetNull)
  owner        User?         @relation("DealOwner", fields: [ownerId], references: [id], onDelete: SetNull)

  @@index([pipelineId, stageId])
  @@index([contactId])
  @@index([organizationId])
  @@index([eventType, eventDate])
  @@map("deals")
}
```

### ContactActivity (timeline)

One unified, append-only stream per subject. A *view* over domain events plus
manual entries. Polymorphic subject: contact and/or organization.

```prisma
model ContactActivity {
  id             Int      @id @default(autoincrement())
  contactId      Int?     @map("contact_id")
  organizationId Int?     @map("organization_id")
  type           String                            // event|note|task|deal_change|booking|registration|email
  title          String
  body           String?
  meta           String   @default("{}")           // JSON — event payload, links
  actorEmail     String?  @map("actor_email")      // staff who did it, if manual
  occurredAt     DateTime @default(now()) @map("occurred_at")

  contact      Contact?      @relation(fields: [contactId], references: [id], onDelete: Cascade)
  organization Organization? @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([contactId, occurredAt])
  @@index([organizationId, occurredAt])
  @@map("contact_activities")
}
```

### Task & Note

```prisma
model Task {
  id             Int       @id @default(autoincrement())
  title          String
  contactId      Int?      @map("contact_id")
  organizationId Int?      @map("organization_id")
  dealId         Int?      @map("deal_id")
  assigneeId     Int?      @map("assignee_id")     // staff User
  dueAt          DateTime? @map("due_at")
  status         String    @default("open")        // open|done|cancelled
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  contact  Contact? @relation(fields: [contactId], references: [id], onDelete: Cascade)
  assignee User?    @relation("TaskAssignee", fields: [assigneeId], references: [id], onDelete: SetNull)

  @@index([assigneeId, status])
  @@index([contactId])
  @@map("tasks")
}

model Note {
  id             Int      @id @default(autoincrement())
  body           String
  contactId      Int?     @map("contact_id")
  organizationId Int?     @map("organization_id")
  dealId         Int?     @map("deal_id")
  authorEmail    String   @map("author_email")
  createdAt      DateTime @default(now()) @map("created_at")

  contact Contact? @relation(fields: [contactId], references: [id], onDelete: Cascade)

  @@index([contactId])
  @@map("notes")
}
```

### Consent & Suppression

Recorded now so subprojects 4–5 send compliantly.

```prisma
model Consent {
  id           Int       @id @default(autoincrement())
  contactId    Int       @unique @map("contact_id")
  marketing    Boolean   @default(false)            // opted in to marketing/re-engagement
  lawfulBasis  String?   @map("lawful_basis")       // consent|legitimate_interest|contract
  consentAt    DateTime? @map("consent_at")
  source       String?                              // where consent was captured
  updatedAt    DateTime  @updatedAt @map("updated_at")

  contact Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)

  @@map("consents")
}

model Suppression {
  id        Int      @id @default(autoincrement())
  email     String   @unique                        // global do-not-contact
  reason    String   @default("unsubscribe")        // unsubscribe|bounce|complaint|manual
  createdAt DateTime @default(now()) @map("created_at")

  @@map("suppressions")
}
```

## Booking → CRM bridge

A pure function `syncBookingToCrm(bookingRequest)` and
`syncRegistrationToCrm(registration)`, called from the existing booking and
registration flows (and once as a backfill migration over historical rows):

1. Upsert `Organization` if the booking carries a company (by `domain`/`name`).
2. Upsert `Contact` by email; link to the organization and to `User`/`Parent`.
3. Upsert `Deal` (`bookingRequestId` unique guarantees idempotency), set
   `eventType`/`eventDate`, place in the default pipeline's first stage.
4. Append a `ContactActivity` (`type: booking|registration`).
5. Touch `lastActivityAt` on contact and organization.

This makes the very first release show real booking history — the foundation of
"contact them again."

## Admin UI

Under `app/admin/crm/` (role-gated admin/superadmin, matching existing admin
routes):

- **Contacts / Companies list** — searchable, filterable by segment/stage/owner/tag.
- **Contact & Company detail** — header + fields, the unified timeline, deals,
  tasks, notes, consent status.
- **Pipeline (kanban)** — columns = stages, cards = deals, drag to move stage.
- **Tasks** — per-assignee list with due dates.
- **Import** — CSV upload → column mapping → dedup preview → commit.

Server Actions for mutations (per repo Next.js App Router conventions); Zod for
validation; server-side authorization on every action.

## Testing

- Unit: dedup/upsert logic, segment rule evaluation, the booking/registration
  bridge (idempotency, org+contact+deal creation), consent/suppression checks.
- Integration: CSV import (dedup, malformed rows), pipeline stage moves,
  timeline aggregation.
- Follows repo Vitest setup.

## Migration & rollout

- One Prisma migration adding the models above; no changes to existing tables
  except new nullable back-relations.
- Backfill script: run `syncBookingToCrm` / `syncRegistrationToCrm` over all
  historical `BookingRequest` and `Registration` rows.
- Seed one default pipeline ("Arrangementsbooking") with stages
  Ny → I dialog → Tilbud sendt → Bekreftet → Gjennomført, plus won/lost flags.

## Open items

- Company dedup heuristics (domain vs. name vs. org number) — start with
  `orgNumber` then `domain` then exact `name`; refine in implementation.
- Whether `Segment` rules need an OR/nested grammar in v1 or just AND — default
  to a simple `{ all: [...] }` now, extend when flows need it.
