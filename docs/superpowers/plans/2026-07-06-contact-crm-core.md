# Contact & CRM Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the CRM spine of the engagement platform — organizations, contacts, lists/segments, pipeline with deals, unified timeline, tasks, notes, consent/suppression, CSV import, and a bridge that turns existing bookings/registrations into CRM records.

**Architecture:** New Prisma models alongside the existing schema. Pure logic (normalization, segment rules, CSV, bridge mapping, import planning) lives in `lib/crm/*` with Vitest TDD; thin DB/API layers on top. Admin API routes under `app/api/admin/crm/*` gated by `requireAdmin()`; client-rendered admin pages under `app/admin/crm/*` in the existing AdminShell.

**Tech Stack:** Next.js 16 App Router, Prisma 5 (PostgreSQL), Zod 4, Vitest, Tailwind 4, existing `components/admin/*` (Toast, Skeleton, EmptyState, ConfirmModal, Pagination).

**Spec:** `docs/superpowers/specs/2026-07-06-contact-crm-core-design.md`
**Deviation from spec (approved rationale):** the spec suggested Server Actions; this repo uses API routes exclusively (`app/api/admin/*` + `requireAdmin()`), so the plan follows the repo convention. Additionally `Deal.registrationId Int? @unique` is added (spec only had `bookingRequestId`) — registrations also create deals and need the same idempotency guarantee.

## Global Constraints

- pnpm, never npm. Dev server port comes from the project — NEVER port 3000 assumptions in code.
- Prisma conventions: `Int @id @default(autoincrement())`, snake_case via `@map`/`@@map`, `String` columns for enum-like values and JSON, `createdAt`/`updatedAt` on every model.
- Schema sync: `pnpm prisma db push` (repo has no migrations dir). Production schema change is a SQL script applied by Basefarm (see final task).
- Auth: every admin route starts with `const session = await requireAdmin(); if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });`
- Dynamic route params are `Promise`: `{ params }: { params: Promise<{ id: string }> }` then `const { id } = await params;`
- Audit: mutations call `logActivity({ action, entity, entityId, details?, userEmail: session.user.email }).catch(() => {});` (fire-and-forget, as in `app/api/admin/bookings/[id]/route.ts`).
- Validation: Zod (`z.string().email()` style as used in `app/api/bookings/route.ts`).
- UI copy is Norwegian (bokmål), matching existing admin pages. Routes use Norwegian slugs like the existing `/admin/foresporsler`: `/admin/crm/kontakter`, `/admin/crm/bedrifter`, `/admin/crm/pipeline`, `/admin/crm/oppgaver`, `/admin/crm/import`.
- Tests: Vitest, files in `tests/*.test.ts`, alias `@` → repo root. Only pure functions get unit tests (repo pattern) — keep DB/route layers thin.
- Commits: conventional commits, title ≤ 50 chars, footer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- TypeScript strict; named exports; `const` over `let`; early returns.

---

### Task 1: Prisma schema — all CRM models

**Files:**
- Modify: `prisma/schema.prisma` (append CRM models; add back-relations to `User` and `Parent`)

**Interfaces:**
- Produces: Prisma models `Organization`, `Contact`, `ContactList`, `ContactListMembership`, `Segment`, `Pipeline`, `Stage`, `Deal`, `ContactActivity`, `Task`, `Note`, `Consent`, `Suppression` — every later task consumes these via `@/lib/prisma`.

- [ ] **Step 1: Add back-relations to existing models**

In `prisma/schema.prisma`, inside `model User` after `bookingRequests BookingRequest[]`, add:

```prisma
  ownedOrganizations Organization[] @relation("OrgOwner")
  ownedContacts      Contact[]      @relation("ContactOwner")
  crmContact         Contact?       @relation("ContactUser")
  ownedDeals         Deal[]         @relation("DealOwner")
  assignedTasks      Task[]         @relation("TaskAssignee")
```

Inside `model Parent` after `registrations Registration[]`, add:

```prisma
  crmContacts   Contact[]
```

- [ ] **Step 2: Append the CRM models at the end of the file**

```prisma
// ═══════════════════════════════════════════════════════════════════════
// CRM — Engasjementsplattform delprosjekt 1
// Spec: docs/superpowers/specs/2026-07-06-contact-crm-core-design.md
// ═══════════════════════════════════════════════════════════════════════

// Bedrift som booker arrangementer (julebord, firmafest, afterwork).
model Organization {
  id             Int       @id @default(autoincrement())
  name           String
  orgNumber      String?   @map("org_number") // norsk organisasjonsnummer
  domain         String?   // f.eks. "acme.no" — brukes til dedup
  phone          String?
  address        String?
  ownerId        Int?      @map("owner_id") // ansvarlig ansatt (User)
  stage          String    @default("lead") // lead|active|customer|dormant|lost
  tags           String    @default("[]") // JSON string[]
  customFields   String    @default("{}") @map("custom_fields") // JSON objekt
  lastActivityAt DateTime? @map("last_activity_at")
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  owner      User?             @relation("OrgOwner", fields: [ownerId], references: [id], onDelete: SetNull)
  contacts   Contact[]
  deals      Deal[]
  activities ContactActivity[]

  @@index([domain])
  @@index([stage])
  @@map("organizations")
}

// Person. Kan tilhøre en bedrift; kan lenkes til eksisterende User/Parent.
model Contact {
  id             Int       @id @default(autoincrement())
  email          String?   @unique // normalisert lowercase; null for telefon-kontakter
  name           String
  phone          String?
  organizationId Int?      @map("organization_id")
  roleTitle      String?   @map("role_title") // f.eks. "Arrangementsansvarlig"
  userId         Int?      @unique @map("user_id")
  parentId       Int?      @map("parent_id")
  source         String    @default("manual") // manual|import|booking|registration|signup
  ownerId        Int?      @map("owner_id")
  stage          String    @default("lead") // lead|active|customer|dormant|lost
  tags           String    @default("[]") // JSON string[]
  customFields   String    @default("{}") @map("custom_fields")
  lastActivityAt DateTime? @map("last_activity_at")
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  organization Organization?           @relation(fields: [organizationId], references: [id], onDelete: SetNull)
  owner        User?                   @relation("ContactOwner", fields: [ownerId], references: [id], onDelete: SetNull)
  user         User?                   @relation("ContactUser", fields: [userId], references: [id], onDelete: SetNull)
  parent       Parent?                 @relation(fields: [parentId], references: [id], onDelete: SetNull)
  deals        Deal[]
  memberships  ContactListMembership[]
  activities   ContactActivity[]
  tasks        Task[]
  notes        Note[]
  consent      Consent?

  @@index([organizationId])
  @@index([stage])
  @@index([parentId])
  @@map("contacts")
}

// Statiske lister (import-mål, manuelle grupperinger).
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

// Dynamisk, regelbasert segment — evalueres ved lesing (lib/crm/segments.ts).
model Segment {
  id        Int      @id @default(autoincrement())
  name      String
  rules     String   @default("{}") // JSON: { all: [{ field, op, value }] }
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("segments")
}

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
  id         Int     @id @default(autoincrement())
  pipelineId Int     @map("pipeline_id")
  name       String
  position   Int     @default(0) // rekkefølge i kanban
  isWon      Boolean @default(false) @map("is_won")
  isLost     Boolean @default(false) @map("is_lost")

  pipeline Pipeline @relation(fields: [pipelineId], references: [id], onDelete: Cascade)
  deals    Deal[]

  @@index([pipelineId])
  @@map("stages")
}

// En deal = kurspåmelding eller arrangementsbooking.
// eventType/eventDate driver sesongbasert re-engasjement senere.
model Deal {
  id               Int       @id @default(autoincrement())
  title            String
  pipelineId       Int       @map("pipeline_id")
  stageId          Int       @map("stage_id")
  contactId        Int?      @map("contact_id")
  organizationId   Int?      @map("organization_id")
  ownerId          Int?      @map("owner_id")
  value            Float?    // NOK
  probability      Int?      // 0-100
  eventType        String?   @map("event_type") // julebord|firmafest|afterwork|kurs|annet
  eventDate        DateTime? @map("event_date")
  status           String    @default("open") // open|won|lost
  closedAt         DateTime? @map("closed_at")
  source           String    @default("manual") // manual|booking|registration
  bookingRequestId Int?      @unique @map("booking_request_id") // idempotens-bro
  registrationId   Int?      @unique @map("registration_id")   // idempotens-bro
  createdAt        DateTime  @default(now()) @map("created_at")
  updatedAt        DateTime  @updatedAt @map("updated_at")

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

// Samlet tidslinje per kontakt/bedrift — append-only.
model ContactActivity {
  id             Int      @id @default(autoincrement())
  contactId      Int?     @map("contact_id")
  organizationId Int?     @map("organization_id")
  type           String   // booking|registration|note|task|deal_change|import|event
  title          String
  body           String?
  meta           String   @default("{}") // JSON — payload, lenker
  actorEmail     String?  @map("actor_email") // ansatt, hvis manuell handling
  occurredAt     DateTime @default(now()) @map("occurred_at")

  contact      Contact?      @relation(fields: [contactId], references: [id], onDelete: Cascade)
  organization Organization? @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([contactId, occurredAt])
  @@index([organizationId, occurredAt])
  @@map("contact_activities")
}

model Task {
  id             Int       @id @default(autoincrement())
  title          String
  contactId      Int?      @map("contact_id")
  organizationId Int?      @map("organization_id")
  dealId         Int?      @map("deal_id")
  assigneeId     Int?      @map("assignee_id")
  dueAt          DateTime? @map("due_at")
  status         String    @default("open") // open|done|cancelled
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

// Samtykke registreres nå så delprosjekt 4–5 kan sende lovlig.
model Consent {
  id          Int       @id @default(autoincrement())
  contactId   Int       @unique @map("contact_id")
  marketing   Boolean   @default(false)
  lawfulBasis String?   @map("lawful_basis") // consent|legitimate_interest|contract
  consentAt   DateTime? @map("consent_at")
  source      String?   // hvor samtykket ble innhentet
  updatedAt   DateTime  @updatedAt @map("updated_at")

  contact Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)

  @@map("consents")
}

// Global ikke-kontakt-liste (avmelding/bounce/klage/manuell).
model Suppression {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  reason    String   @default("unsubscribe") // unsubscribe|bounce|complaint|manual
  createdAt DateTime @default(now()) @map("created_at")

  @@map("suppressions")
}
```

- [ ] **Step 3: Validate and push**

Run: `pnpm prisma validate && pnpm prisma db push && pnpm prisma generate`
Expected: `The schema at prisma/schema.prisma is valid`, then `Your database is now in sync with your Prisma schema`, then client generated.

- [ ] **Step 4: Verify existing tests still pass**

Run: `pnpm test`
Expected: all existing tests PASS (schema change is additive).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(crm): add CRM data model" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `lib/crm/normalize.ts` — normalization & JSON helpers

**Files:**
- Create: `lib/crm/normalize.ts`
- Test: `tests/crm-normalize.test.ts`

**Interfaces:**
- Produces:
  - `normalizeEmail(raw: string | null | undefined): string | null` — trim+lowercase; null if not a plausible email
  - `emailDomain(email: string | null): string | null`
  - `isCompanyDomain(domain: string | null): boolean` — false for freemail (gmail etc.)
  - `orgNameFromDomain(domain: string): string` — `"acme.no"` → `"Acme"`
  - `parseJsonArray(s: string): string[]`, `parseJsonObject(s: string): Record<string, unknown>` — tolerant parsers for the `tags`/`customFields` String-columns

- [ ] **Step 1: Write the failing test**

Create `tests/crm-normalize.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  normalizeEmail, emailDomain, isCompanyDomain, orgNameFromDomain,
  parseJsonArray, parseJsonObject,
} from '@/lib/crm/normalize';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Kari@Acme.NO ')).toBe('kari@acme.no');
  });
  it('returns null for empty/invalid', () => {
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail('   ')).toBeNull();
    expect(normalizeEmail('ikke-epost')).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});

describe('emailDomain', () => {
  it('extracts domain', () => {
    expect(emailDomain('kari@acme.no')).toBe('acme.no');
  });
  it('null in, null out', () => {
    expect(emailDomain(null)).toBeNull();
  });
});

describe('isCompanyDomain', () => {
  it('freemail is not a company', () => {
    expect(isCompanyDomain('gmail.com')).toBe(false);
    expect(isCompanyDomain('hotmail.com')).toBe(false);
    expect(isCompanyDomain('online.no')).toBe(false);
  });
  it('other domains are companies', () => {
    expect(isCompanyDomain('acme.no')).toBe(true);
  });
  it('null is not a company', () => {
    expect(isCompanyDomain(null)).toBe(false);
  });
});

describe('orgNameFromDomain', () => {
  it('capitalizes the label before the TLD', () => {
    expect(orgNameFromDomain('acme.no')).toBe('Acme');
    expect(orgNameFromDomain('travselskapet.com')).toBe('Travselskapet');
  });
});

describe('json helpers', () => {
  it('parses valid arrays and filters non-strings', () => {
    expect(parseJsonArray('["a","b",3]')).toEqual(['a', 'b']);
  });
  it('bad JSON gives empty array/object', () => {
    expect(parseJsonArray('ikke json')).toEqual([]);
    expect(parseJsonObject('ikke json')).toEqual({});
  });
  it('non-object JSON gives empty object', () => {
    expect(parseJsonObject('[1]')).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/crm-normalize.test.ts`
Expected: FAIL — `Cannot find module '@/lib/crm/normalize'` (or equivalent resolution error).

- [ ] **Step 3: Write the implementation**

Create `lib/crm/normalize.ts`:

```typescript
// Normalisering og tolerant JSON-parsing for CRM-kjernen.
// Alt her er rene funksjoner — testet i tests/crm-normalize.test.ts.

const FREEMAIL_DOMAINS = new Set([
  'gmail.com', 'hotmail.com', 'hotmail.no', 'outlook.com', 'outlook.no',
  'live.no', 'live.com', 'yahoo.com', 'yahoo.no', 'icloud.com', 'me.com',
  'msn.com', 'online.no', 'getmail.no', 'protonmail.com', 'proton.me',
]);

export function normalizeEmail(raw: string | null | undefined): string | null {
  const email = raw?.trim().toLowerCase() ?? '';
  // Minimal plausibilitet: noe@noe.noe — full validering skjer med Zod i API-laget.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function emailDomain(email: string | null): string | null {
  if (!email) return null;
  const domain = email.split('@')[1] ?? '';
  return domain || null;
}

export function isCompanyDomain(domain: string | null): boolean {
  return !!domain && !FREEMAIL_DOMAINS.has(domain);
}

export function orgNameFromDomain(domain: string): string {
  const label = domain.split('.')[0] ?? domain;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function parseJsonArray(s: string): string[] {
  try {
    const value = JSON.parse(s);
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function parseJsonObject(s: string): Record<string, unknown> {
  try {
    const value = JSON.parse(s);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/crm-normalize.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add lib/crm/normalize.ts tests/crm-normalize.test.ts
git commit -m "feat(crm): normalization helpers" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `lib/crm/segments.ts` — segment rule evaluation

**Files:**
- Create: `lib/crm/segments.ts`
- Test: `tests/crm-segments.test.ts`

**Interfaces:**
- Produces:
  - `type SegmentOp = 'eq' | 'neq' | 'contains' | 'lt' | 'gt' | 'is_null' | 'not_null'`
  - `interface SegmentRule { field: string; op: SegmentOp; value?: unknown }`
  - `interface SegmentRules { all: SegmentRule[] }`
  - `interface SegmentContact { stage: string; source: string; email: string | null; organizationId: number | null; lastActivityAt: Date | null; tags: string[]; deals: { eventType: string | null; eventDate: Date | null; status: string }[] }`
  - `parseSegmentRules(json: string): SegmentRules` — tolerant; bad JSON → `{ all: [] }`
  - `contactMatchesSegment(contact: SegmentContact, rules: SegmentRules): boolean`
- Semantics: `all` = AND over rules. Contact fields: `stage`, `source`, `email`, `organizationId`, `lastActivityAt`, `tags` (op `contains`). Deal fields are prefixed `deal.` (`deal.eventType`, `deal.eventDate`, `deal.status`) — a deal-rule passes if **any** deal satisfies it. Date comparisons (`lt`/`gt`) accept ISO-string rule values. Empty `all` matches everyone.

- [ ] **Step 1: Write the failing test**

Create `tests/crm-segments.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { contactMatchesSegment, parseSegmentRules, type SegmentContact } from '@/lib/crm/segments';

const contact = (o: Partial<SegmentContact> = {}): SegmentContact => ({
  stage: 'customer',
  source: 'booking',
  email: 'kari@acme.no',
  organizationId: 1,
  lastActivityAt: new Date('2026-06-01'),
  tags: ['julebord', 'vip'],
  deals: [
    { eventType: 'julebord', eventDate: new Date('2025-12-12'), status: 'won' },
    { eventType: 'kurs', eventDate: new Date('2026-03-01'), status: 'open' },
  ],
  ...o,
});

describe('parseSegmentRules', () => {
  it('parses valid rules', () => {
    expect(parseSegmentRules('{"all":[{"field":"stage","op":"eq","value":"lead"}]}'))
      .toEqual({ all: [{ field: 'stage', op: 'eq', value: 'lead' }] });
  });
  it('bad JSON gives empty rules', () => {
    expect(parseSegmentRules('tull')).toEqual({ all: [] });
    expect(parseSegmentRules('{"nope":1}')).toEqual({ all: [] });
  });
});

describe('contactMatchesSegment', () => {
  it('empty rules match everyone', () => {
    expect(contactMatchesSegment(contact(), { all: [] })).toBe(true);
  });
  it('eq/neq on contact fields', () => {
    expect(contactMatchesSegment(contact(), { all: [{ field: 'stage', op: 'eq', value: 'customer' }] })).toBe(true);
    expect(contactMatchesSegment(contact(), { all: [{ field: 'stage', op: 'neq', value: 'customer' }] })).toBe(false);
  });
  it('tags contains', () => {
    expect(contactMatchesSegment(contact(), { all: [{ field: 'tags', op: 'contains', value: 'vip' }] })).toBe(true);
    expect(contactMatchesSegment(contact(), { all: [{ field: 'tags', op: 'contains', value: 'ukjent' }] })).toBe(false);
  });
  it('AND-semantics over multiple rules', () => {
    expect(contactMatchesSegment(contact(), {
      all: [
        { field: 'stage', op: 'eq', value: 'customer' },
        { field: 'tags', op: 'contains', value: 'ukjent' },
      ],
    })).toBe(false);
  });
  it('deal.* passes when ANY deal matches', () => {
    expect(contactMatchesSegment(contact(), { all: [{ field: 'deal.eventType', op: 'eq', value: 'julebord' }] })).toBe(true);
    expect(contactMatchesSegment(contact(), { all: [{ field: 'deal.eventType', op: 'eq', value: 'firmafest' }] })).toBe(false);
  });
  it('date lt/gt with ISO strings — the re-engagement query', () => {
    // "booket julebord med eventDate før 2026" → re-engasjement for i år
    expect(contactMatchesSegment(contact(), {
      all: [
        { field: 'deal.eventType', op: 'eq', value: 'julebord' },
        { field: 'deal.eventDate', op: 'lt', value: '2026-01-01' },
      ],
    })).toBe(true);
  });
  it('is_null / not_null', () => {
    expect(contactMatchesSegment(contact({ organizationId: null }), { all: [{ field: 'organizationId', op: 'is_null' }] })).toBe(true);
    expect(contactMatchesSegment(contact(), { all: [{ field: 'organizationId', op: 'not_null' }] })).toBe(true);
  });
  it('unknown field never matches', () => {
    expect(contactMatchesSegment(contact(), { all: [{ field: 'finnesIkke', op: 'eq', value: 1 }] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/crm-segments.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/crm/segments.ts`:

```typescript
// Segmentregler: { all: [{ field, op, value }] } — AND over alle regler.
// Kontaktfelter: stage, source, email, organizationId, lastActivityAt, tags.
// Deal-felter prefikses "deal." og passerer hvis MINST ÉN deal matcher.
// Evalueres ved lesing — ingen lagrede medlemskapsrader.

export type SegmentOp = 'eq' | 'neq' | 'contains' | 'lt' | 'gt' | 'is_null' | 'not_null';

export interface SegmentRule {
  field: string;
  op: SegmentOp;
  value?: unknown;
}

export interface SegmentRules {
  all: SegmentRule[];
}

export interface SegmentContact {
  stage: string;
  source: string;
  email: string | null;
  organizationId: number | null;
  lastActivityAt: Date | null;
  tags: string[];
  deals: { eventType: string | null; eventDate: Date | null; status: string }[];
}

const OPS: SegmentOp[] = ['eq', 'neq', 'contains', 'lt', 'gt', 'is_null', 'not_null'];

export function parseSegmentRules(json: string): SegmentRules {
  try {
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.all)) return { all: [] };
    const all = (parsed.all as unknown[]).filter((r): r is SegmentRule => {
      if (!r || typeof r !== 'object') return false;
      const rule = r as Record<string, unknown>;
      return typeof rule.field === 'string' && OPS.includes(rule.op as SegmentOp);
    });
    return { all };
  } catch {
    return { all: [] };
  }
}

function toComparable(value: unknown): number | string | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const asDate = Date.parse(value);
    if (!Number.isNaN(asDate) && /\d{4}-\d{2}-\d{2}/.test(value)) return asDate;
    return value;
  }
  if (typeof value === 'number') return value;
  return null;
}

function checkValue(actual: unknown, rule: SegmentRule): boolean {
  switch (rule.op) {
    case 'is_null':
      return actual === null || actual === undefined;
    case 'not_null':
      return actual !== null && actual !== undefined;
    case 'eq':
      return actual === rule.value;
    case 'neq':
      return actual !== rule.value;
    case 'contains':
      if (Array.isArray(actual)) return actual.includes(rule.value);
      if (typeof actual === 'string' && typeof rule.value === 'string') {
        return actual.toLowerCase().includes(rule.value.toLowerCase());
      }
      return false;
    case 'lt':
    case 'gt': {
      const a = toComparable(actual);
      const b = toComparable(rule.value);
      if (a === null || b === null || typeof a !== typeof b) return false;
      return rule.op === 'lt' ? a < b : a > b;
    }
  }
}

function checkRule(contact: SegmentContact, rule: SegmentRule): boolean {
  if (rule.field.startsWith('deal.')) {
    const dealField = rule.field.slice('deal.'.length);
    if (!['eventType', 'eventDate', 'status'].includes(dealField)) return false;
    // is_null skal bety "har ingen deal som har verdi" → ingen deals = match
    if (rule.op === 'is_null') {
      return contact.deals.every(
        (d) => checkValue(d[dealField as keyof typeof d], rule),
      );
    }
    return contact.deals.some((d) => checkValue(d[dealField as keyof typeof d], rule));
  }

  switch (rule.field) {
    case 'stage': return checkValue(contact.stage, rule);
    case 'source': return checkValue(contact.source, rule);
    case 'email': return checkValue(contact.email, rule);
    case 'organizationId': return checkValue(contact.organizationId, rule);
    case 'lastActivityAt': return checkValue(contact.lastActivityAt, rule);
    case 'tags': return checkValue(contact.tags, rule);
    default: return false;
  }
}

export function contactMatchesSegment(contact: SegmentContact, rules: SegmentRules): boolean {
  return rules.all.every((rule) => checkRule(contact, rule));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/crm-segments.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/crm/segments.ts tests/crm-segments.test.ts
git commit -m "feat(crm): segment rule evaluation" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `lib/crm/csv.ts` — CSV parser (Norwegian Excel-friendly)

**Files:**
- Create: `lib/crm/csv.ts`
- Test: `tests/crm-csv.test.ts`

**Interfaces:**
- Produces:
  - `parseCsv(text: string): { headers: string[]; rows: string[][] }` — autodetects `;` vs `,` delimiter (Norwegian Excel exports use `;`), handles quoted fields with `""` escapes and newlines inside quotes, strips BOM, skips blank lines.

- [ ] **Step 1: Write the failing test**

Create `tests/crm-csv.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseCsv } from '@/lib/crm/csv';

describe('parseCsv', () => {
  it('parses comma-separated with header', () => {
    const { headers, rows } = parseCsv('navn,epost\nKari,kari@acme.no\nOla,ola@x.no');
    expect(headers).toEqual(['navn', 'epost']);
    expect(rows).toEqual([['Kari', 'kari@acme.no'], ['Ola', 'ola@x.no']]);
  });
  it('autodetects semicolon (norsk Excel)', () => {
    const { headers, rows } = parseCsv('navn;epost;telefon\nKari;kari@acme.no;99887766');
    expect(headers).toEqual(['navn', 'epost', 'telefon']);
    expect(rows[0]).toEqual(['Kari', 'kari@acme.no', '99887766']);
  });
  it('handles quoted fields with delimiter and escaped quotes', () => {
    const { rows } = parseCsv('a,b\n"Hansen, Kari","Sa ""hei"""');
    expect(rows[0]).toEqual(['Hansen, Kari', 'Sa "hei"']);
  });
  it('handles newline inside quotes', () => {
    const { rows } = parseCsv('a,b\n"linje1\nlinje2",x');
    expect(rows[0]).toEqual(['linje1\nlinje2', 'x']);
  });
  it('strips BOM and skips blank lines', () => {
    const { headers, rows } = parseCsv('﻿navn,epost\n\nKari,k@x.no\n');
    expect(headers).toEqual(['navn', 'epost']);
    expect(rows).toEqual([['Kari', 'k@x.no']]);
  });
  it('handles CRLF', () => {
    const { rows } = parseCsv('a,b\r\n1,2\r\n');
    expect(rows).toEqual([['1', '2']]);
  });
  it('empty input gives empty result', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/crm-csv.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/crm/csv.ts`:

```typescript
// Minimal, robust CSV-parser for import. Autodetekterer skilletegn
// (norsk Excel eksporterer med semikolon), håndterer anførselstegn med
// ""-escaping og linjeskift inni felt. Ingen avhengigheter.

export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const input = text.replace(/^﻿/, '');
  if (!input.trim()) return { headers: [], rows: [] };

  const firstLine = input.slice(0, input.indexOf('\n') === -1 ? input.length : input.indexOf('\n'));
  const delimiter = countOutsideQuotes(firstLine, ';') > countOutsideQuotes(firstLine, ',') ? ';' : ',';

  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delimiter) { record.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') {
      record.push(field); field = '';
      if (record.some((f) => f.trim() !== '')) records.push(record);
      record = [];
      continue;
    }
    field += ch;
  }
  record.push(field);
  if (record.some((f) => f.trim() !== '')) records.push(record);

  const [headers = [], ...rows] = records;
  return { headers: headers.map((h) => h.trim()), rows };
}

function countOutsideQuotes(line: string, char: string): number {
  let count = 0;
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === char && !inQuotes) count++;
  }
  return count;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/crm-csv.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/crm/csv.ts tests/crm-csv.test.ts
git commit -m "feat(crm): CSV parser for import" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `lib/crm/bridge-mapping.ts` — pure booking/registration → CRM mapping

**Files:**
- Create: `lib/crm/bridge-mapping.ts`
- Test: `tests/crm-bridge-mapping.test.ts`

**Interfaces:**
- Consumes: `normalizeEmail`, `emailDomain`, `isCompanyDomain`, `orgNameFromDomain` from `@/lib/crm/normalize` (Task 2).
- Produces:
  - `interface CrmSyncInput { organization: { name: string; domain: string } | null; contact: { email: string | null; name: string; phone: string | null; source: 'booking' | 'registration'; userId: number | null; parentId: number | null }; deal: { title: string; eventType: string; eventDate: Date | null; value: number | null; status: 'open' | 'won' | 'lost'; stageName: 'Ny' | 'Bekreftet' | 'Tapt'; source: 'booking' | 'registration'; bookingRequestId: number | null; registrationId: number | null }; activity: { type: 'booking' | 'registration'; title: string; occurredAt: Date } }`
  - `bookingToCrm(booking: BookingForCrm, course: CourseForCrm): CrmSyncInput`
  - `registrationToCrm(reg: RegistrationForCrm, course: CourseForCrm): CrmSyncInput`
  - `interface BookingForCrm { id: number; name: string; email: string; phone: string; participants: number; preferredDate: Date | null; status: string; userId: number | null; createdAt: Date }`
  - `interface CourseForCrm { name: string; type: string; price: number | null; startDate: Date | null }`
  - `interface RegistrationForCrm { id: number; status: string; createdAt: Date; parent: { id: number; name: string; phone: string; userId: number; user: { email: string } } }`
- Mapping rules:
  - Organization: only when the booking email has a company domain (not freemail) — `{ name: orgNameFromDomain(domain), domain }`. Registrations (B2C course signups) never create organizations.
  - `deal.eventType`: `course.type` verbatim for bookings (course types are admin-configured values like `julebord`); `'kurs'` for registrations.
  - `deal.eventDate`: booking → `preferredDate ?? course.startDate`; registration → `course.startDate`.
  - `deal.value`: booking → `course.price × participants` when price set, else null; registration → `course.price`.
  - Status/stage: `new`/`pending` → `open`/`Ny`; `confirmed` → `won`/`Bekreftet`; `cancelled` → `lost`/`Tapt`.
  - `activity.occurredAt` = `createdAt` (so backfilled history lands on the right date).

- [ ] **Step 1: Write the failing test**

Create `tests/crm-bridge-mapping.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { bookingToCrm, registrationToCrm, type BookingForCrm, type CourseForCrm, type RegistrationForCrm } from '@/lib/crm/bridge-mapping';

const course = (o: Partial<CourseForCrm> = {}): CourseForCrm => ({
  name: 'Julebord på Bjerke', type: 'julebord', price: 850, startDate: new Date('2026-12-11'), ...o,
});
const booking = (o: Partial<BookingForCrm> = {}): BookingForCrm => ({
  id: 7, name: 'Kari Hansen', email: 'Kari@Acme.NO', phone: '99887766',
  participants: 20, preferredDate: new Date('2026-12-04'), status: 'new',
  userId: null, createdAt: new Date('2026-07-01'), ...o,
});
const registration = (o: Partial<RegistrationForCrm> = {}): RegistrationForCrm => ({
  id: 42, status: 'confirmed', createdAt: new Date('2026-05-01'),
  parent: { id: 3, name: 'Ola Nordmann', phone: '48123456', userId: 9, user: { email: 'ola@gmail.com' } },
  ...o,
});

describe('bookingToCrm', () => {
  it('company email creates organization, normalized contact email', () => {
    const input = bookingToCrm(booking(), course());
    expect(input.organization).toEqual({ name: 'Acme', domain: 'acme.no' });
    expect(input.contact.email).toBe('kari@acme.no');
    expect(input.contact.source).toBe('booking');
  });
  it('freemail creates no organization', () => {
    expect(bookingToCrm(booking({ email: 'kari@gmail.com' }), course()).organization).toBeNull();
  });
  it('deal carries eventType/date/value from course and participants', () => {
    const { deal } = bookingToCrm(booking(), course());
    expect(deal.eventType).toBe('julebord');
    expect(deal.eventDate).toEqual(new Date('2026-12-04')); // preferredDate vinner
    expect(deal.value).toBe(850 * 20);
    expect(deal.bookingRequestId).toBe(7);
    expect(deal.registrationId).toBeNull();
  });
  it('falls back to course.startDate without preferredDate', () => {
    expect(bookingToCrm(booking({ preferredDate: null }), course()).deal.eventDate)
      .toEqual(new Date('2026-12-11'));
  });
  it('status mapping: new→Ny/open, confirmed→Bekreftet/won, cancelled→Tapt/lost', () => {
    expect(bookingToCrm(booking(), course()).deal).toMatchObject({ status: 'open', stageName: 'Ny' });
    expect(bookingToCrm(booking({ status: 'confirmed' }), course()).deal).toMatchObject({ status: 'won', stageName: 'Bekreftet' });
    expect(bookingToCrm(booking({ status: 'cancelled' }), course()).deal).toMatchObject({ status: 'lost', stageName: 'Tapt' });
  });
  it('null price gives null value', () => {
    expect(bookingToCrm(booking(), course({ price: null })).deal.value).toBeNull();
  });
  it('activity uses createdAt for backfill-correct timeline', () => {
    const { activity } = bookingToCrm(booking(), course());
    expect(activity.type).toBe('booking');
    expect(activity.occurredAt).toEqual(new Date('2026-07-01'));
  });
});

describe('registrationToCrm', () => {
  it('maps parent to contact, never creates organization', () => {
    const input = registrationToCrm(registration(), course({ type: 'kurs', name: 'Begynnerkurs' }));
    expect(input.organization).toBeNull();
    expect(input.contact).toMatchObject({
      email: 'ola@gmail.com', name: 'Ola Nordmann', parentId: 3, userId: 9, source: 'registration',
    });
  });
  it('deal is kurs-typed with course price and registrationId', () => {
    const { deal } = registrationToCrm(registration(), course({ type: 'kurs', name: 'Begynnerkurs', price: 2500 }));
    expect(deal).toMatchObject({
      eventType: 'kurs', value: 2500, registrationId: 42, bookingRequestId: null,
      status: 'won', stageName: 'Bekreftet',
    });
  });
  it('pending registration is open/Ny', () => {
    expect(registrationToCrm(registration({ status: 'pending' }), course()).deal)
      .toMatchObject({ status: 'open', stageName: 'Ny' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/crm-bridge-mapping.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/crm/bridge-mapping.ts`:

```typescript
// Ren mapping fra eksisterende BookingRequest/Registration til CRM-input.
// Ingen DB her — lib/crm/bridge.ts gjør selve upsertene.

import { normalizeEmail, emailDomain, isCompanyDomain, orgNameFromDomain } from '@/lib/crm/normalize';

export interface CourseForCrm {
  name: string;
  type: string;
  price: number | null;
  startDate: Date | null;
}

export interface BookingForCrm {
  id: number;
  name: string;
  email: string;
  phone: string;
  participants: number;
  preferredDate: Date | null;
  status: string; // new|confirmed|cancelled
  userId: number | null;
  createdAt: Date;
}

export interface RegistrationForCrm {
  id: number;
  status: string; // pending|confirmed|cancelled
  createdAt: Date;
  parent: { id: number; name: string; phone: string; userId: number; user: { email: string } };
}

export interface CrmSyncInput {
  organization: { name: string; domain: string } | null;
  contact: {
    email: string | null;
    name: string;
    phone: string | null;
    source: 'booking' | 'registration';
    userId: number | null;
    parentId: number | null;
  };
  deal: {
    title: string;
    eventType: string;
    eventDate: Date | null;
    value: number | null;
    status: 'open' | 'won' | 'lost';
    stageName: 'Ny' | 'Bekreftet' | 'Tapt';
    source: 'booking' | 'registration';
    bookingRequestId: number | null;
    registrationId: number | null;
  };
  activity: {
    type: 'booking' | 'registration';
    title: string;
    occurredAt: Date;
  };
}

function statusToDeal(status: string): { status: 'open' | 'won' | 'lost'; stageName: 'Ny' | 'Bekreftet' | 'Tapt' } {
  if (status === 'confirmed') return { status: 'won', stageName: 'Bekreftet' };
  if (status === 'cancelled') return { status: 'lost', stageName: 'Tapt' };
  return { status: 'open', stageName: 'Ny' }; // new | pending
}

export function bookingToCrm(booking: BookingForCrm, course: CourseForCrm): CrmSyncInput {
  const email = normalizeEmail(booking.email);
  const domain = emailDomain(email);
  const organization = isCompanyDomain(domain)
    ? { name: orgNameFromDomain(domain!), domain: domain! }
    : null;

  return {
    organization,
    contact: {
      email,
      name: booking.name,
      phone: booking.phone || null,
      source: 'booking',
      userId: booking.userId,
      parentId: null,
    },
    deal: {
      title: `${course.name} — ${booking.name}`,
      eventType: course.type,
      eventDate: booking.preferredDate ?? course.startDate,
      value: course.price !== null ? course.price * booking.participants : null,
      ...statusToDeal(booking.status),
      source: 'booking',
      bookingRequestId: booking.id,
      registrationId: null,
    },
    activity: {
      type: 'booking',
      title: `Forespørsel: ${course.name}`,
      occurredAt: booking.createdAt,
    },
  };
}

export function registrationToCrm(reg: RegistrationForCrm, course: CourseForCrm): CrmSyncInput {
  return {
    organization: null, // kurspåmelding er B2C — aldri bedrift
    contact: {
      email: normalizeEmail(reg.parent.user.email),
      name: reg.parent.name,
      phone: reg.parent.phone || null,
      source: 'registration',
      userId: reg.parent.userId,
      parentId: reg.parent.id,
    },
    deal: {
      title: `${course.name} — ${reg.parent.name}`,
      eventType: 'kurs',
      eventDate: course.startDate,
      value: course.price,
      ...statusToDeal(reg.status),
      source: 'registration',
      bookingRequestId: null,
      registrationId: reg.id,
    },
    activity: {
      type: 'registration',
      title: `Påmelding: ${course.name}`,
      occurredAt: reg.createdAt,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/crm-bridge-mapping.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/crm/bridge-mapping.ts tests/crm-bridge-mapping.test.ts
git commit -m "feat(crm): booking/registration mapping" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `lib/crm/pipeline.ts` + `lib/crm/bridge.ts` — DB layer

**Files:**
- Create: `lib/crm/pipeline.ts`
- Create: `lib/crm/bridge.ts`

**Interfaces:**
- Consumes: `bookingToCrm`, `registrationToCrm`, `CrmSyncInput` from `@/lib/crm/bridge-mapping` (Task 5); Prisma models (Task 1).
- Produces:
  - `ensureDefaultPipeline(): Promise<{ id: number; stages: { id: number; name: string }[] }>` — idempotent; creates pipeline "Arrangementsbooking" with stages Ny(0) → I dialog(1) → Tilbud sendt(2) → Bekreftet(3, isWon) → Gjennomført(4, isWon) → Tapt(5, isLost) on first call.
  - `syncBookingToCrm(bookingId: number): Promise<void>` — loads booking+course, maps, upserts org/contact/deal, appends activity, touches `lastActivityAt`. Idempotent via `Deal.bookingRequestId @unique` and contact-email upsert. Never throws to the caller (logs instead) — CRM sync must not break the public booking flow.
  - `syncRegistrationToCrm(registrationId: number): Promise<void>` — same for registrations via `Deal.registrationId @unique`.

No unit tests (DB layer — repo pattern keeps these thin); verified end-to-end by the backfill run in Task 7.

- [ ] **Step 1: Create `lib/crm/pipeline.ts`**

```typescript
import { prisma } from '@/lib/prisma';

const DEFAULT_STAGES = [
  { name: 'Ny', position: 0, isWon: false, isLost: false },
  { name: 'I dialog', position: 1, isWon: false, isLost: false },
  { name: 'Tilbud sendt', position: 2, isWon: false, isLost: false },
  { name: 'Bekreftet', position: 3, isWon: true, isLost: false },
  { name: 'Gjennomført', position: 4, isWon: true, isLost: false },
  { name: 'Tapt', position: 5, isWon: false, isLost: true },
] as const;

/**
 * Idempotent: returnerer første pipeline, eller oppretter standard-pipelinen
 * "Arrangementsbooking" med faste stadier ved første kall.
 */
export async function ensureDefaultPipeline() {
  const existing = await prisma.pipeline.findFirst({
    orderBy: { id: 'asc' },
    include: { stages: { orderBy: { position: 'asc' }, select: { id: true, name: true } } },
  });
  if (existing) return existing;

  return prisma.pipeline.create({
    data: {
      name: 'Arrangementsbooking',
      stages: { create: [...DEFAULT_STAGES] },
    },
    include: { stages: { orderBy: { position: 'asc' }, select: { id: true, name: true } } },
  });
}
```

- [ ] **Step 2: Create `lib/crm/bridge.ts`**

```typescript
// Broen fra eksisterende booking-/påmeldingsflyt til CRM.
// Kalles fire-and-forget fra publikums-API-ene og fra backfill-scriptet.
// Idempotent: Deal.bookingRequestId/registrationId er @unique, kontakter
// upsertes på normalisert e-post, organisasjoner på domene.

import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';
import { bookingToCrm, registrationToCrm, type CrmSyncInput } from '@/lib/crm/bridge-mapping';
import { ensureDefaultPipeline } from '@/lib/crm/pipeline';

async function applySync(input: CrmSyncInput): Promise<void> {
  const pipeline = await ensureDefaultPipeline();
  const stage = pipeline.stages.find((s) => s.name === input.deal.stageName) ?? pipeline.stages[0];

  // 1) Organisasjon (kun bedriftsdomener)
  let organizationId: number | null = null;
  if (input.organization) {
    const existingOrg = await prisma.organization.findFirst({
      where: { domain: input.organization.domain },
    });
    const org = existingOrg ?? await prisma.organization.create({
      data: { name: input.organization.name, domain: input.organization.domain, stage: 'lead' },
    });
    organizationId = org.id;
  }

  // 2) Kontakt — upsert på normalisert e-post
  const contactData = {
    name: input.contact.name,
    phone: input.contact.phone,
    organizationId,
    userId: input.contact.userId,
    parentId: input.contact.parentId,
  };
  const contact = input.contact.email
    ? await prisma.contact.upsert({
        where: { email: input.contact.email },
        create: { email: input.contact.email, source: input.contact.source, ...contactData },
        // Ved oppdatering: ikke overskriv organisasjon/eier med null
        update: {
          name: input.contact.name,
          phone: input.contact.phone ?? undefined,
          organizationId: organizationId ?? undefined,
          userId: input.contact.userId ?? undefined,
          parentId: input.contact.parentId ?? undefined,
        },
      })
    : await prisma.contact.create({
        data: { email: null, source: input.contact.source, ...contactData },
      });

  // 3) Deal — idempotent på kilde-ID
  const dealWhere = input.deal.bookingRequestId !== null
    ? { bookingRequestId: input.deal.bookingRequestId }
    : { registrationId: input.deal.registrationId! };
  const dealData = {
    title: input.deal.title,
    pipelineId: pipeline.id,
    stageId: stage.id,
    contactId: contact.id,
    organizationId,
    value: input.deal.value,
    eventType: input.deal.eventType,
    eventDate: input.deal.eventDate,
    status: input.deal.status,
    closedAt: input.deal.status === 'open' ? null : new Date(),
    source: input.deal.source,
    bookingRequestId: input.deal.bookingRequestId,
    registrationId: input.deal.registrationId,
  };
  const existingDeal = await prisma.deal.findUnique({ where: dealWhere });
  if (existingDeal) {
    await prisma.deal.update({ where: { id: existingDeal.id }, data: dealData });
  } else {
    await prisma.deal.create({ data: dealData });
    // Tidslinje kun ved første sync — status-oppdateringer gir egne innslag senere
    await prisma.contactActivity.create({
      data: {
        contactId: contact.id,
        organizationId,
        type: input.activity.type,
        title: input.activity.title,
        occurredAt: input.activity.occurredAt,
      },
    });
  }

  // 4) Puls
  const touch = { lastActivityAt: input.activity.occurredAt };
  await prisma.contact.update({ where: { id: contact.id }, data: touch });
  if (organizationId) {
    await prisma.organization.update({ where: { id: organizationId }, data: touch });
  }
}

export async function syncBookingToCrm(bookingId: number): Promise<void> {
  try {
    const booking = await prisma.bookingRequest.findUnique({
      where: { id: bookingId },
      include: { course: { select: { name: true, type: true, price: true, startDate: true } } },
    });
    if (!booking || !booking.course) return;
    await applySync(bookingToCrm(booking, booking.course));
  } catch (error) {
    // CRM-sync får ALDRI velte publikums-flyten
    logger.error(`CRM sync failed for booking ${bookingId}`, { error });
  }
}

export async function syncRegistrationToCrm(registrationId: number): Promise<void> {
  try {
    const reg = await prisma.registration.findUnique({
      where: { id: registrationId },
      include: {
        course: { select: { name: true, type: true, price: true, startDate: true } },
        parent: { include: { user: { select: { email: true } } } },
      },
    });
    if (!reg) return;
    await applySync(registrationToCrm(reg, reg.course));
  } catch (error) {
    logger.error(`CRM sync failed for registration ${registrationId}`, { error });
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. (If `reg.parent.userId` type errors appear, the Parent include needs `user: { select: { email: true } }` and the mapping consumes `parent.userId` which exists on the Parent model.)

- [ ] **Step 4: Commit**

```bash
git add lib/crm/pipeline.ts lib/crm/bridge.ts
git commit -m "feat(crm): booking/registration CRM bridge" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Hook bridge into live flows + backfill script

**Files:**
- Modify: `app/api/bookings/route.ts` (after successful `prisma.bookingRequest.create`)
- Modify: `app/api/registrations/route.ts` (after successful `prisma.registration.create`, ~line 315)
- Modify: `app/api/admin/bookings/[id]/route.ts` (status change → re-sync)
- Create: `scripts/backfill-crm.ts`

**Interfaces:**
- Consumes: `syncBookingToCrm(bookingId)`, `syncRegistrationToCrm(registrationId)` from `@/lib/crm/bridge` (Task 6).

- [ ] **Step 1: Hook into public booking flow**

In `app/api/bookings/route.ts`, add import at top:

```typescript
import { syncBookingToCrm } from '@/lib/crm/bridge';
```

Directly after `const booking = await prisma.bookingRequest.create({ ... });` (line ~61), add:

```typescript
    // CRM-bro: fire-and-forget — får aldri stoppe bookingen
    syncBookingToCrm(booking.id).catch(() => {});
```

- [ ] **Step 2: Hook into public registration flow**

In `app/api/registrations/route.ts`, add import at top:

```typescript
import { syncRegistrationToCrm } from '@/lib/crm/bridge';
```

Directly after `const registration = await prisma.registration.create({ ... });` (line ~315), add:

```typescript
    // CRM-bro: fire-and-forget
    syncRegistrationToCrm(registration.id).catch(() => {});
```

- [ ] **Step 3: Re-sync on admin status change**

In `app/api/admin/bookings/[id]/route.ts`, add import and call after the `prisma.bookingRequest.update` in `PUT`:

```typescript
import { syncBookingToCrm } from '@/lib/crm/bridge';
```

```typescript
  syncBookingToCrm(Number(id)).catch(() => {});
```

- [ ] **Step 4: Create the backfill script**

Create `scripts/backfill-crm.ts`:

```typescript
// Engangs backfill: kjør bridge-syncen over alle historiske bookinger og
// påmeldinger så CRM-et har full historikk fra dag én.
//
//   pnpm dlx tsx scripts/backfill-crm.ts
//
// Idempotent — trygt å kjøre flere ganger (Deal.bookingRequestId/registrationId
// er unike, kontakter upsertes på e-post).

import { prisma } from '../lib/prisma';
import { syncBookingToCrm, syncRegistrationToCrm } from '../lib/crm/bridge';

async function main() {
  const bookings = await prisma.bookingRequest.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
  console.log(`Backfiller ${bookings.length} bookinger …`);
  for (const b of bookings) {
    await syncBookingToCrm(b.id);
  }

  const registrations = await prisma.registration.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
  console.log(`Backfiller ${registrations.length} påmeldinger …`);
  for (const r of registrations) {
    await syncRegistrationToCrm(r.id);
  }

  const [contacts, orgs, deals] = await Promise.all([
    prisma.contact.count(), prisma.organization.count(), prisma.deal.count(),
  ]);
  console.log(`Ferdig. Kontakter: ${contacts}, bedrifter: ${orgs}, deals: ${deals}`);
}

main().finally(() => prisma.$disconnect());
```

- [ ] **Step 5: Run backfill against dev DB and verify**

Run: `pnpm dlx tsx scripts/backfill-crm.ts`
Expected: counts printed, no errors. Run it TWICE and verify the counts do not grow the second time (idempotency proof).

- [ ] **Step 6: Run full test suite**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/api/bookings/route.ts app/api/registrations/route.ts 'app/api/admin/bookings/[id]/route.ts' scripts/backfill-crm.ts
git commit -m "feat(crm): wire bridge + backfill script" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: API — contacts (list/search, detail, mutate, consent)

**Files:**
- Create: `app/api/admin/crm/contacts/route.ts`
- Create: `app/api/admin/crm/contacts/[id]/route.ts`
- Create: `app/api/admin/crm/contacts/[id]/consent/route.ts`

**Interfaces:**
- Consumes: `requireAdmin` (`@/lib/auth`), `prisma`, `logActivity`, `normalizeEmail`/`parseJsonArray` (Task 2), `parseSegmentRules`/`contactMatchesSegment` (Task 3).
- Produces (consumed by UI Tasks 14–15):
  - `GET /api/admin/crm/contacts?q=&stage=&tag=&segmentId=&page=` → `{ contacts: ContactRow[], total: number, page: number, pageSize: number }` where `ContactRow = { id, name, email, phone, stage, source, tags: string[], organization: { id, name } | null, owner: { id, email } | null, lastActivityAt, dealCount: number }`
  - `POST /api/admin/crm/contacts` body `{ name, email?, phone?, organizationId?, stage?, tags?: string[], roleTitle? }` → `{ contact }` (409 if email exists)
  - `GET /api/admin/crm/contacts/:id` → `{ contact }` incl. `organization`, `owner`, `consent`, `deals` (with stage+pipeline names), `tasks`, `notes`, `activities` (newest first, max 100)
  - `PATCH /api/admin/crm/contacts/:id` (partial update, same fields as POST + `ownerId`) → `{ contact }`
  - `DELETE /api/admin/crm/contacts/:id` → `{ ok: true }`
  - `PUT /api/admin/crm/contacts/:id/consent` body `{ marketing: boolean, lawfulBasis?: string, source?: string }` → `{ consent }`

- [ ] **Step 1: Create list/create route**

Create `app/api/admin/crm/contacts/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { normalizeEmail, parseJsonArray } from '@/lib/crm/normalize';
import { parseSegmentRules, contactMatchesSegment } from '@/lib/crm/segments';

const PAGE_SIZE = 50;

export async function GET(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const q = sp.get('q')?.trim() ?? '';
  const stage = sp.get('stage') ?? '';
  const tag = sp.get('tag')?.trim() ?? '';
  const segmentId = Number(sp.get('segmentId')) || null;
  const page = Math.max(1, Number(sp.get('page')) || 1);

  const where = {
    ...(q && {
      OR: [
        { name: { contains: q, mode: 'insensitive' as const } },
        { email: { contains: q.toLowerCase() } },
        { phone: { contains: q } },
      ],
    }),
    ...(stage && { stage }),
  };

  const all = await prisma.contact.findMany({
    where,
    orderBy: [{ lastActivityAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
    include: {
      organization: { select: { id: true, name: true } },
      owner: { select: { id: true, email: true } },
      deals: { select: { eventType: true, eventDate: true, status: true } },
    },
  });

  // Tag- og segmentfiltrering skjer i minnet (tags er JSON-kolonne,
  // segmenter er regelbaserte). Datamengden her er små tusen kontakter.
  let filtered = all.map((c) => ({ ...c, tagList: parseJsonArray(c.tags) }));
  if (tag) {
    filtered = filtered.filter((c) => c.tagList.includes(tag));
  }
  if (segmentId) {
    const segment = await prisma.segment.findUnique({ where: { id: segmentId } });
    if (segment) {
      const rules = parseSegmentRules(segment.rules);
      filtered = filtered.filter((c) =>
        contactMatchesSegment(
          {
            stage: c.stage, source: c.source, email: c.email,
            organizationId: c.organizationId, lastActivityAt: c.lastActivityAt,
            tags: c.tagList, deals: c.deals,
          },
          rules,
        ),
      );
    }
  }

  const total = filtered.length;
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return NextResponse.json({
    contacts: pageItems.map((c) => ({
      id: c.id, name: c.name, email: c.email, phone: c.phone,
      stage: c.stage, source: c.source, tags: c.tagList,
      organization: c.organization, owner: c.owner,
      lastActivityAt: c.lastActivityAt, dealCount: c.deals.length,
    })),
    total, page, pageSize: PAGE_SIZE,
  });
}

const createSchema = z.object({
  name: z.string().min(1, 'Navn er påkrevd').max(200),
  email: z.string().email('Ugyldig e-postadresse').nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  organizationId: z.number().int().positive().nullable().optional(),
  stage: z.enum(['lead', 'active', 'customer', 'dormant', 'lost']).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  roleTitle: z.string().max(100).nullable().optional(),
});

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;
  const email = normalizeEmail(data.email ?? null);

  if (email) {
    const existing = await prisma.contact.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: 'En kontakt med denne e-posten finnes allerede' }, { status: 409 });
    }
  }

  const contact = await prisma.contact.create({
    data: {
      name: data.name, email, phone: data.phone ?? null,
      organizationId: data.organizationId ?? null,
      stage: data.stage ?? 'lead',
      tags: JSON.stringify(data.tags ?? []),
      roleTitle: data.roleTitle ?? null,
      source: 'manual',
    },
  });

  logActivity({ action: 'create', entity: 'contact', entityId: contact.id, userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ contact }, { status: 201 });
}
```

- [ ] **Step 2: Create detail/patch/delete route**

Create `app/api/admin/crm/contacts/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { normalizeEmail, parseJsonArray } from '@/lib/crm/normalize';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const contact = await prisma.contact.findUnique({
    where: { id: Number(id) },
    include: {
      organization: { select: { id: true, name: true } },
      owner: { select: { id: true, email: true } },
      consent: true,
      deals: {
        orderBy: { createdAt: 'desc' },
        include: { stage: { select: { name: true } }, pipeline: { select: { name: true } } },
      },
      tasks: { orderBy: [{ status: 'asc' }, { dueAt: 'asc' }] },
      notes: { orderBy: { createdAt: 'desc' } },
      activities: { orderBy: { occurredAt: 'desc' }, take: 100 },
    },
  });
  if (!contact) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }

  return NextResponse.json({ contact: { ...contact, tags: parseJsonArray(contact.tags) } });
}

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  organizationId: z.number().int().positive().nullable().optional(),
  ownerId: z.number().int().positive().nullable().optional(),
  stage: z.enum(['lead', 'active', 'customer', 'dormant', 'lost']).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  roleTitle: z.string().max(100).nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;

  const email = data.email !== undefined ? normalizeEmail(data.email) : undefined;
  if (email) {
    const existing = await prisma.contact.findUnique({ where: { email } });
    if (existing && existing.id !== Number(id)) {
      return NextResponse.json({ error: 'En annen kontakt har denne e-posten' }, { status: 409 });
    }
  }

  const contact = await prisma.contact.update({
    where: { id: Number(id) },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(email !== undefined && { email }),
      ...(data.phone !== undefined && { phone: data.phone }),
      ...(data.organizationId !== undefined && { organizationId: data.organizationId }),
      ...(data.ownerId !== undefined && { ownerId: data.ownerId }),
      ...(data.stage !== undefined && { stage: data.stage }),
      ...(data.tags !== undefined && { tags: JSON.stringify(data.tags) }),
      ...(data.roleTitle !== undefined && { roleTitle: data.roleTitle }),
    },
  });

  logActivity({ action: 'update', entity: 'contact', entityId: contact.id, userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ contact });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  await prisma.contact.delete({ where: { id: Number(id) } });
  logActivity({ action: 'delete', entity: 'contact', entityId: Number(id), userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Create consent route**

Create `app/api/admin/crm/contacts/[id]/consent/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

const consentSchema = z.object({
  marketing: z.boolean(),
  lawfulBasis: z.enum(['consent', 'legitimate_interest', 'contract']).nullable().optional(),
  source: z.string().max(200).nullable().optional(),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const parsed = consentSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;

  const consent = await prisma.consent.upsert({
    where: { contactId: Number(id) },
    create: {
      contactId: Number(id),
      marketing: data.marketing,
      lawfulBasis: data.lawfulBasis ?? null,
      source: data.source ?? `admin:${session.user.email}`,
      consentAt: data.marketing ? new Date() : null,
    },
    update: {
      marketing: data.marketing,
      lawfulBasis: data.lawfulBasis ?? null,
      source: data.source ?? `admin:${session.user.email}`,
      consentAt: data.marketing ? new Date() : null,
    },
  });

  logActivity({ action: 'update', entity: 'consent', entityId: consent.id, details: JSON.stringify({ marketing: data.marketing }), userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ consent });
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. Note: if `orderBy: [{ lastActivityAt: { sort: 'desc', nulls: 'last' } }]` errors on Prisma 5, replace with `orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }]`.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/crm/contacts
git commit -m "feat(crm): contacts API" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: API — organizations

**Files:**
- Create: `app/api/admin/crm/organizations/route.ts`
- Create: `app/api/admin/crm/organizations/[id]/route.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `prisma`, `logActivity`, `parseJsonArray` (Task 2).
- Produces (consumed by UI Task 16):
  - `GET /api/admin/crm/organizations?q=&stage=` → `{ organizations: { id, name, domain, orgNumber, phone, stage, tags: string[], contactCount, dealCount, lastActivityAt }[] }`
  - `POST /api/admin/crm/organizations` body `{ name, domain?, orgNumber?, phone?, address?, stage?, tags? }` → `{ organization }` (409 on duplicate domain)
  - `GET /api/admin/crm/organizations/:id` → `{ organization }` incl. `contacts`, `deals` (with stage names), `activities` (max 100)
  - `PATCH /api/admin/crm/organizations/:id` / `DELETE /api/admin/crm/organizations/:id`

- [ ] **Step 1: Create list/create route**

Create `app/api/admin/crm/organizations/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { parseJsonArray } from '@/lib/crm/normalize';

export async function GET(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const q = sp.get('q')?.trim() ?? '';
  const stage = sp.get('stage') ?? '';

  const organizations = await prisma.organization.findMany({
    where: {
      ...(q && {
        OR: [
          { name: { contains: q, mode: 'insensitive' as const } },
          { domain: { contains: q.toLowerCase() } },
          { orgNumber: { contains: q } },
        ],
      }),
      ...(stage && { stage }),
    },
    orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
    include: { _count: { select: { contacts: true, deals: true } } },
  });

  return NextResponse.json({
    organizations: organizations.map((o) => ({
      id: o.id, name: o.name, domain: o.domain, orgNumber: o.orgNumber,
      phone: o.phone, stage: o.stage, tags: parseJsonArray(o.tags),
      contactCount: o._count.contacts, dealCount: o._count.deals,
      lastActivityAt: o.lastActivityAt,
    })),
  });
}

const createSchema = z.object({
  name: z.string().min(1, 'Navn er påkrevd').max(200),
  domain: z.string().max(200).nullable().optional(),
  orgNumber: z.string().max(20).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  stage: z.enum(['lead', 'active', 'customer', 'dormant', 'lost']).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;
  const domain = data.domain?.trim().toLowerCase() || null;

  if (domain) {
    const existing = await prisma.organization.findFirst({ where: { domain } });
    if (existing) {
      return NextResponse.json({ error: 'En bedrift med dette domenet finnes allerede' }, { status: 409 });
    }
  }

  const organization = await prisma.organization.create({
    data: {
      name: data.name, domain, orgNumber: data.orgNumber ?? null,
      phone: data.phone ?? null, address: data.address ?? null,
      stage: data.stage ?? 'lead', tags: JSON.stringify(data.tags ?? []),
    },
  });

  logActivity({ action: 'create', entity: 'organization', entityId: organization.id, userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ organization }, { status: 201 });
}
```

- [ ] **Step 2: Create detail/patch/delete route**

Create `app/api/admin/crm/organizations/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { parseJsonArray } from '@/lib/crm/normalize';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const organization = await prisma.organization.findUnique({
    where: { id: Number(id) },
    include: {
      owner: { select: { id: true, email: true } },
      contacts: { select: { id: true, name: true, email: true, phone: true, roleTitle: true, stage: true } },
      deals: {
        orderBy: { createdAt: 'desc' },
        include: { stage: { select: { name: true } } },
      },
      activities: { orderBy: { occurredAt: 'desc' }, take: 100 },
    },
  });
  if (!organization) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }

  return NextResponse.json({ organization: { ...organization, tags: parseJsonArray(organization.tags) } });
}

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  domain: z.string().max(200).nullable().optional(),
  orgNumber: z.string().max(20).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  ownerId: z.number().int().positive().nullable().optional(),
  stage: z.enum(['lead', 'active', 'customer', 'dormant', 'lost']).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;

  const organization = await prisma.organization.update({
    where: { id: Number(id) },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.domain !== undefined && { domain: data.domain?.trim().toLowerCase() || null }),
      ...(data.orgNumber !== undefined && { orgNumber: data.orgNumber }),
      ...(data.phone !== undefined && { phone: data.phone }),
      ...(data.address !== undefined && { address: data.address }),
      ...(data.ownerId !== undefined && { ownerId: data.ownerId }),
      ...(data.stage !== undefined && { stage: data.stage }),
      ...(data.tags !== undefined && { tags: JSON.stringify(data.tags) }),
    },
  });

  logActivity({ action: 'update', entity: 'organization', entityId: organization.id, userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ organization });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  await prisma.organization.delete({ where: { id: Number(id) } });
  logActivity({ action: 'delete', entity: 'organization', entityId: Number(id), userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

```bash
git add app/api/admin/crm/organizations
git commit -m "feat(crm): organizations API" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: API — pipelines & deals

**Files:**
- Create: `app/api/admin/crm/pipelines/route.ts`
- Create: `app/api/admin/crm/deals/route.ts`
- Create: `app/api/admin/crm/deals/[id]/route.ts`

**Interfaces:**
- Consumes: `ensureDefaultPipeline` (Task 6), `requireAdmin`, `prisma`, `logActivity`.
- Produces (consumed by kanban UI Task 17):
  - `GET /api/admin/crm/pipelines` → `{ pipelines: { id, name, stages: { id, name, position, isWon, isLost, deals: DealCard[] }[] }[] }` where `DealCard = { id, title, value, eventType, eventDate, status, contact: { id, name } | null, organization: { id, name } | null }`. Calls `ensureDefaultPipeline()` first so a fresh install always has one.
  - `POST /api/admin/crm/deals` body `{ title, pipelineId, stageId, contactId?, organizationId?, value?, eventType?, eventDate? }` → `{ deal }`
  - `PATCH /api/admin/crm/deals/:id` body (any of) `{ stageId, title, value, eventType, eventDate, contactId, organizationId, ownerId }` — moving to a stage with `isWon`/`isLost` sets `status`/`closedAt` accordingly, moving to a normal stage reopens; appends a `deal_change` ContactActivity when the stage changes → `{ deal }`
  - `DELETE /api/admin/crm/deals/:id` → `{ ok: true }`

- [ ] **Step 1: Create pipelines route**

Create `app/api/admin/crm/pipelines/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { ensureDefaultPipeline } from '@/lib/crm/pipeline';

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await ensureDefaultPipeline();

  const pipelines = await prisma.pipeline.findMany({
    orderBy: { id: 'asc' },
    include: {
      stages: {
        orderBy: { position: 'asc' },
        include: {
          deals: {
            orderBy: { updatedAt: 'desc' },
            select: {
              id: true, title: true, value: true, eventType: true,
              eventDate: true, status: true,
              contact: { select: { id: true, name: true } },
              organization: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  return NextResponse.json({ pipelines });
}
```

- [ ] **Step 2: Create deal create route**

Create `app/api/admin/crm/deals/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

const createSchema = z.object({
  title: z.string().min(1, 'Tittel er påkrevd').max(300),
  pipelineId: z.number().int().positive(),
  stageId: z.number().int().positive(),
  contactId: z.number().int().positive().nullable().optional(),
  organizationId: z.number().int().positive().nullable().optional(),
  value: z.number().nonnegative().nullable().optional(),
  eventType: z.string().max(50).nullable().optional(),
  eventDate: z.string().datetime().nullable().optional(),
});

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;

  const stage = await prisma.stage.findUnique({ where: { id: data.stageId } });
  if (!stage || stage.pipelineId !== data.pipelineId) {
    return NextResponse.json({ error: 'Ugyldig stadium for valgt pipeline' }, { status: 400 });
  }

  const deal = await prisma.deal.create({
    data: {
      title: data.title,
      pipelineId: data.pipelineId,
      stageId: data.stageId,
      contactId: data.contactId ?? null,
      organizationId: data.organizationId ?? null,
      value: data.value ?? null,
      eventType: data.eventType ?? null,
      eventDate: data.eventDate ? new Date(data.eventDate) : null,
      status: stage.isWon ? 'won' : stage.isLost ? 'lost' : 'open',
      closedAt: stage.isWon || stage.isLost ? new Date() : null,
      source: 'manual',
    },
  });

  logActivity({ action: 'create', entity: 'deal', entityId: deal.id, userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ deal }, { status: 201 });
}
```

- [ ] **Step 3: Create deal patch/delete route**

Create `app/api/admin/crm/deals/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

const patchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  stageId: z.number().int().positive().optional(),
  contactId: z.number().int().positive().nullable().optional(),
  organizationId: z.number().int().positive().nullable().optional(),
  ownerId: z.number().int().positive().nullable().optional(),
  value: z.number().nonnegative().nullable().optional(),
  eventType: z.string().max(50).nullable().optional(),
  eventDate: z.string().datetime().nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;

  const existing = await prisma.deal.findUnique({
    where: { id: Number(id) },
    include: { stage: { select: { name: true } } },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }

  // Stadiebytte styrer status/closedAt
  let statusPatch = {};
  let newStageName: string | null = null;
  if (data.stageId !== undefined && data.stageId !== existing.stageId) {
    const stage = await prisma.stage.findUnique({ where: { id: data.stageId } });
    if (!stage || stage.pipelineId !== existing.pipelineId) {
      return NextResponse.json({ error: 'Ugyldig stadium' }, { status: 400 });
    }
    newStageName = stage.name;
    statusPatch = stage.isWon
      ? { status: 'won', closedAt: new Date() }
      : stage.isLost
        ? { status: 'lost', closedAt: new Date() }
        : { status: 'open', closedAt: null };
  }

  const deal = await prisma.deal.update({
    where: { id: Number(id) },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.stageId !== undefined && { stageId: data.stageId }),
      ...(data.contactId !== undefined && { contactId: data.contactId }),
      ...(data.organizationId !== undefined && { organizationId: data.organizationId }),
      ...(data.ownerId !== undefined && { ownerId: data.ownerId }),
      ...(data.value !== undefined && { value: data.value }),
      ...(data.eventType !== undefined && { eventType: data.eventType }),
      ...(data.eventDate !== undefined && { eventDate: data.eventDate ? new Date(data.eventDate) : null }),
      ...statusPatch,
    },
  });

  // Tidslinje-innslag ved stadiebytte
  if (newStageName && (deal.contactId || deal.organizationId)) {
    await prisma.contactActivity.create({
      data: {
        contactId: deal.contactId,
        organizationId: deal.organizationId,
        type: 'deal_change',
        title: `${deal.title}: ${existing.stage.name} → ${newStageName}`,
        actorEmail: session.user.email,
      },
    });
  }

  logActivity({ action: 'update', entity: 'deal', entityId: deal.id, details: newStageName ? JSON.stringify({ stage: newStageName }) : undefined, userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ deal });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  await prisma.deal.delete({ where: { id: Number(id) } });
  logActivity({ action: 'delete', entity: 'deal', entityId: Number(id), userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

```bash
git add app/api/admin/crm/pipelines app/api/admin/crm/deals
git commit -m "feat(crm): pipelines and deals API" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: API — tasks & notes

**Files:**
- Create: `app/api/admin/crm/tasks/route.ts`
- Create: `app/api/admin/crm/tasks/[id]/route.ts`
- Create: `app/api/admin/crm/notes/route.ts`
- Create: `app/api/admin/crm/notes/[id]/route.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `prisma`, `logActivity`.
- Produces (consumed by UI Tasks 15 & 18):
  - `GET /api/admin/crm/tasks?status=&assigneeId=` → `{ tasks: { id, title, dueAt, status, contact: { id, name } | null, assignee: { id, email } | null }[] }` sorted by `dueAt` asc, nulls last
  - `POST /api/admin/crm/tasks` body `{ title, contactId?, organizationId?, dealId?, assigneeId?, dueAt? }` → `{ task }`; appends `task` ContactActivity when contact-linked
  - `PATCH /api/admin/crm/tasks/:id` body `{ title?, status?, assigneeId?, dueAt? }` → `{ task }`
  - `DELETE /api/admin/crm/tasks/:id` → `{ ok: true }`
  - `POST /api/admin/crm/notes` body `{ body, contactId?, organizationId?, dealId? }` → `{ note }`; appends `note` ContactActivity
  - `DELETE /api/admin/crm/notes/:id` → `{ ok: true }`

- [ ] **Step 1: Create tasks routes**

Create `app/api/admin/crm/tasks/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

export async function GET(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const status = sp.get('status') ?? '';
  const assigneeId = Number(sp.get('assigneeId')) || null;

  const tasks = await prisma.task.findMany({
    where: {
      ...(status && { status }),
      ...(assigneeId && { assigneeId }),
    },
    orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { id: 'desc' }],
    include: {
      contact: { select: { id: true, name: true } },
      assignee: { select: { id: true, email: true } },
    },
  });

  return NextResponse.json({ tasks });
}

const createSchema = z.object({
  title: z.string().min(1, 'Tittel er påkrevd').max(300),
  contactId: z.number().int().positive().nullable().optional(),
  organizationId: z.number().int().positive().nullable().optional(),
  dealId: z.number().int().positive().nullable().optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;

  const task = await prisma.task.create({
    data: {
      title: data.title,
      contactId: data.contactId ?? null,
      organizationId: data.organizationId ?? null,
      dealId: data.dealId ?? null,
      assigneeId: data.assigneeId ?? null,
      dueAt: data.dueAt ? new Date(data.dueAt) : null,
    },
  });

  if (task.contactId || task.organizationId) {
    await prisma.contactActivity.create({
      data: {
        contactId: task.contactId,
        organizationId: task.organizationId,
        type: 'task',
        title: `Oppgave opprettet: ${task.title}`,
        actorEmail: session.user.email,
      },
    });
  }

  logActivity({ action: 'create', entity: 'task', entityId: task.id, userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ task }, { status: 201 });
}
```

Create `app/api/admin/crm/tasks/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

const patchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  status: z.enum(['open', 'done', 'cancelled']).optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;

  const task = await prisma.task.update({
    where: { id: Number(id) },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.assigneeId !== undefined && { assigneeId: data.assigneeId }),
      ...(data.dueAt !== undefined && { dueAt: data.dueAt ? new Date(data.dueAt) : null }),
    },
  });

  logActivity({ action: 'update', entity: 'task', entityId: task.id, userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ task });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  await prisma.task.delete({ where: { id: Number(id) } });
  logActivity({ action: 'delete', entity: 'task', entityId: Number(id), userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Create notes routes**

Create `app/api/admin/crm/notes/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

const createSchema = z.object({
  body: z.string().min(1, 'Notatet kan ikke være tomt').max(10000),
  contactId: z.number().int().positive().nullable().optional(),
  organizationId: z.number().int().positive().nullable().optional(),
  dealId: z.number().int().positive().nullable().optional(),
});

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;

  if (!data.contactId && !data.organizationId && !data.dealId) {
    return NextResponse.json({ error: 'Notat må knyttes til kontakt, bedrift eller deal' }, { status: 400 });
  }

  const note = await prisma.note.create({
    data: {
      body: data.body,
      contactId: data.contactId ?? null,
      organizationId: data.organizationId ?? null,
      dealId: data.dealId ?? null,
      authorEmail: session.user.email,
    },
  });

  if (note.contactId || note.organizationId) {
    await prisma.contactActivity.create({
      data: {
        contactId: note.contactId,
        organizationId: note.organizationId,
        type: 'note',
        title: 'Notat',
        body: note.body.slice(0, 500),
        actorEmail: session.user.email,
        meta: JSON.stringify({ noteId: note.id }),
      },
    });
  }

  logActivity({ action: 'create', entity: 'note', entityId: note.id, userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ note }, { status: 201 });
}
```

Create `app/api/admin/crm/notes/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  await prisma.note.delete({ where: { id: Number(id) } });
  logActivity({ action: 'delete', entity: 'note', entityId: Number(id), userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. (Same `nulls: 'last'` fallback note as Task 8 applies to the tasks orderBy.)

```bash
git add app/api/admin/crm/tasks app/api/admin/crm/notes
git commit -m "feat(crm): tasks and notes API" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: API — lists, segments, suppressions

**Files:**
- Create: `app/api/admin/crm/lists/route.ts`
- Create: `app/api/admin/crm/lists/[id]/route.ts`
- Create: `app/api/admin/crm/segments/route.ts`
- Create: `app/api/admin/crm/segments/[id]/route.ts`
- Create: `app/api/admin/crm/suppressions/route.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `prisma`, `logActivity`, `parseSegmentRules` (Task 3), `normalizeEmail` (Task 2).
- Produces:
  - `GET /api/admin/crm/lists` → `{ lists: { id, name, memberCount }[] }`; `POST` body `{ name }` → `{ list }`
  - `POST /api/admin/crm/lists/:id` body `{ contactIds: number[] }` adds members (skipDuplicates) → `{ added: number }`; `DELETE /api/admin/crm/lists/:id` deletes the list
  - `GET /api/admin/crm/segments` → `{ segments: { id, name, rules }[] }`; `POST` body `{ name, rules }` (rules validated by `parseSegmentRules` round-trip) → `{ segment }`
  - `PATCH /api/admin/crm/segments/:id` / `DELETE /api/admin/crm/segments/:id`
  - `GET /api/admin/crm/suppressions` → `{ suppressions }`; `POST` body `{ email, reason? }` → `{ suppression }`; `DELETE ?email=` removes

- [ ] **Step 1: Create lists routes**

Create `app/api/admin/crm/lists/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const lists = await prisma.contactList.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { memberships: true } } },
  });

  return NextResponse.json({
    lists: lists.map((l) => ({ id: l.id, name: l.name, memberCount: l._count.memberships })),
  });
}

const createSchema = z.object({ name: z.string().min(1, 'Navn er påkrevd').max(200) });

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const list = await prisma.contactList.create({ data: { name: parsed.data.name } });
  logActivity({ action: 'create', entity: 'contact_list', entityId: list.id, userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ list }, { status: 201 });
}
```

Create `app/api/admin/crm/lists/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

const addSchema = z.object({ contactIds: z.array(z.number().int().positive()).min(1).max(1000) });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const parsed = addSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const result = await prisma.contactListMembership.createMany({
    data: parsed.data.contactIds.map((contactId) => ({ listId: Number(id), contactId })),
    skipDuplicates: true,
  });

  return NextResponse.json({ added: result.count });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  await prisma.contactList.delete({ where: { id: Number(id) } });
  logActivity({ action: 'delete', entity: 'contact_list', entityId: Number(id), userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Create segments routes**

Create `app/api/admin/crm/segments/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { parseSegmentRules } from '@/lib/crm/segments';

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const segments = await prisma.segment.findMany({ orderBy: { name: 'asc' } });
  return NextResponse.json({ segments });
}

const createSchema = z.object({
  name: z.string().min(1, 'Navn er påkrevd').max(200),
  rules: z.string().max(10000),
});

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  // Normaliser reglene gjennom parseren — ugyldige regler forkastes stille,
  // så det som lagres alltid er evaluerbart.
  const rules = JSON.stringify(parseSegmentRules(parsed.data.rules));
  const segment = await prisma.segment.create({ data: { name: parsed.data.name, rules } });

  logActivity({ action: 'create', entity: 'segment', entityId: segment.id, userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ segment }, { status: 201 });
}
```

Create `app/api/admin/crm/segments/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { parseSegmentRules } from '@/lib/crm/segments';

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  rules: z.string().max(10000).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;

  const segment = await prisma.segment.update({
    where: { id: Number(id) },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.rules !== undefined && { rules: JSON.stringify(parseSegmentRules(data.rules)) }),
    },
  });

  logActivity({ action: 'update', entity: 'segment', entityId: segment.id, userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ segment });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  await prisma.segment.delete({ where: { id: Number(id) } });
  logActivity({ action: 'delete', entity: 'segment', entityId: Number(id), userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Create suppressions route**

Create `app/api/admin/crm/suppressions/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { normalizeEmail } from '@/lib/crm/normalize';

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const suppressions = await prisma.suppression.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ suppressions });
}

const createSchema = z.object({
  email: z.string().email('Ugyldig e-postadresse'),
  reason: z.enum(['unsubscribe', 'bounce', 'complaint', 'manual']).optional(),
});

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const email = normalizeEmail(parsed.data.email);
  if (!email) {
    return NextResponse.json({ error: 'Ugyldig e-postadresse' }, { status: 400 });
  }

  const suppression = await prisma.suppression.upsert({
    where: { email },
    create: { email, reason: parsed.data.reason ?? 'manual' },
    update: { reason: parsed.data.reason ?? 'manual' },
  });

  logActivity({ action: 'create', entity: 'suppression', entityId: suppression.id, userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ suppression }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const email = normalizeEmail(request.nextUrl.searchParams.get('email'));
  if (!email) {
    return NextResponse.json({ error: 'Ugyldig e-postadresse' }, { status: 400 });
  }

  await prisma.suppression.delete({ where: { email } }).catch(() => {});
  logActivity({ action: 'delete', entity: 'suppression', details: JSON.stringify({ email }), userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

```bash
git add app/api/admin/crm/lists app/api/admin/crm/segments app/api/admin/crm/suppressions
git commit -m "feat(crm): lists, segments, suppressions API" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: `lib/crm/import.ts` (TDD) + import API

**Files:**
- Create: `lib/crm/import.ts`
- Test: `tests/crm-import.test.ts`
- Create: `app/api/admin/crm/import/route.ts`

**Interfaces:**
- Consumes: `parseCsv` (Task 4), `normalizeEmail` (Task 2), `requireAdmin`, `prisma`, `logActivity`.
- Produces:
  - `interface ImportMapping { name: number | null; email: number | null; phone: number | null; organization: number | null }` — column indexes into a CSV row
  - `interface ImportPlan { create: ImportRow[]; update: ImportRow[]; skip: { row: number; reason: string }[] }` with `ImportRow = { row: number; name: string; email: string | null; phone: string | null; organizationName: string | null }`
  - `planImport(rows: string[][], mapping: ImportMapping, existingEmails: Set<string>): ImportPlan` — pure. Rules: no name AND no email → skip (`'mangler navn og e-post'`); invalid email → imported with `email: null` if name exists; duplicate email within the file → first wins, rest skip (`'duplikat i filen'`); email in `existingEmails` → update; otherwise create. Missing name with valid email → name falls back to the email local-part.
  - `POST /api/admin/crm/import` body `{ csv: string, mapping: ImportMapping, listId?: number, dryRun: boolean }` → dryRun: `{ plan }` (create/update/skip preview); commit: `{ created, updated, skipped }` — creates/updates contacts (`source: 'import'`), optionally adds all touched contacts to `listId`, appends `import` ContactActivity per contact.

- [ ] **Step 1: Write the failing test**

Create `tests/crm-import.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { planImport, type ImportMapping } from '@/lib/crm/import';

const mapping: ImportMapping = { name: 0, email: 1, phone: 2, organization: 3 };

describe('planImport', () => {
  it('plans creates for new emails', () => {
    const plan = planImport([['Kari', 'kari@acme.no', '99887766', 'Acme AS']], mapping, new Set());
    expect(plan.create).toEqual([
      { row: 1, name: 'Kari', email: 'kari@acme.no', phone: '99887766', organizationName: 'Acme AS' },
    ]);
    expect(plan.update).toEqual([]);
    expect(plan.skip).toEqual([]);
  });
  it('existing email becomes update', () => {
    const plan = planImport([['Kari', 'kari@acme.no', '', '']], mapping, new Set(['kari@acme.no']));
    expect(plan.update).toHaveLength(1);
    expect(plan.create).toHaveLength(0);
  });
  it('normalizes email before dedup', () => {
    const plan = planImport([['Kari', '  KARI@ACME.NO ', '', '']], mapping, new Set(['kari@acme.no']));
    expect(plan.update).toHaveLength(1);
  });
  it('duplicate within file: first wins', () => {
    const plan = planImport(
      [['Kari', 'kari@acme.no', '', ''], ['Kari B', 'kari@acme.no', '', '']],
      mapping, new Set(),
    );
    expect(plan.create).toHaveLength(1);
    expect(plan.skip).toEqual([{ row: 2, reason: 'duplikat i filen' }]);
  });
  it('skips rows without name and email', () => {
    const plan = planImport([['', '', '123', '']], mapping, new Set());
    expect(plan.skip).toEqual([{ row: 1, reason: 'mangler navn og e-post' }]);
  });
  it('invalid email kept as contact without email when name exists', () => {
    const plan = planImport([['Kari', 'ikke-epost', '', '']], mapping, new Set());
    expect(plan.create[0]).toMatchObject({ name: 'Kari', email: null });
  });
  it('missing name falls back to email local-part', () => {
    const plan = planImport([['', 'ola@x.no', '', '']], mapping, new Set());
    expect(plan.create[0]).toMatchObject({ name: 'ola', email: 'ola@x.no' });
  });
  it('unmapped columns give nulls', () => {
    const noPhone: ImportMapping = { name: 0, email: 1, phone: null, organization: null };
    const plan = planImport([['Kari', 'k@x.no', 'ignorert', 'ignorert']], noPhone, new Set());
    expect(plan.create[0]).toMatchObject({ phone: null, organizationName: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/crm-import.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/crm/import.ts`:

```typescript
// Ren import-planlegging: rader + kolonnemapping + eksisterende e-poster
// → create/update/skip-plan. DB-siden ligger i API-ruta.

import { normalizeEmail } from '@/lib/crm/normalize';

export interface ImportMapping {
  name: number | null;
  email: number | null;
  phone: number | null;
  organization: number | null;
}

export interface ImportRow {
  row: number; // 1-basert radnummer i fila (uten header)
  name: string;
  email: string | null;
  phone: string | null;
  organizationName: string | null;
}

export interface ImportPlan {
  create: ImportRow[];
  update: ImportRow[];
  skip: { row: number; reason: string }[];
}

function cell(row: string[], index: number | null): string {
  if (index === null || index < 0 || index >= row.length) return '';
  return row[index].trim();
}

export function planImport(
  rows: string[][],
  mapping: ImportMapping,
  existingEmails: Set<string>,
): ImportPlan {
  const plan: ImportPlan = { create: [], update: [], skip: [] };
  const seenInFile = new Set<string>();

  rows.forEach((raw, i) => {
    const rowNum = i + 1;
    const rawName = cell(raw, mapping.name);
    const email = normalizeEmail(cell(raw, mapping.email));
    const phone = cell(raw, mapping.phone) || null;
    const organizationName = cell(raw, mapping.organization) || null;

    if (!rawName && !email) {
      plan.skip.push({ row: rowNum, reason: 'mangler navn og e-post' });
      return;
    }
    if (email && seenInFile.has(email)) {
      plan.skip.push({ row: rowNum, reason: 'duplikat i filen' });
      return;
    }
    if (email) seenInFile.add(email);

    const name = rawName || email!.split('@')[0];
    const item: ImportRow = { row: rowNum, name, email, phone, organizationName };

    if (email && existingEmails.has(email)) plan.update.push(item);
    else plan.create.push(item);
  });

  return plan;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/crm-import.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the import API route**

Create `app/api/admin/crm/import/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { parseCsv } from '@/lib/crm/csv';
import { planImport, type ImportRow } from '@/lib/crm/import';

const importSchema = z.object({
  csv: z.string().min(1, 'CSV-innhold mangler').max(5_000_000),
  mapping: z.object({
    name: z.number().int().nullable(),
    email: z.number().int().nullable(),
    phone: z.number().int().nullable(),
    organization: z.number().int().nullable(),
  }),
  listId: z.number().int().positive().nullable().optional(),
  dryRun: z.boolean(),
});

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = importSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { csv, mapping, listId, dryRun } = parsed.data;

  const { rows } = parseCsv(csv);
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Fant ingen rader i CSV-en' }, { status: 400 });
  }
  if (rows.length > 10000) {
    return NextResponse.json({ error: 'Maks 10 000 rader per import' }, { status: 400 });
  }

  const existing = await prisma.contact.findMany({
    where: { email: { not: null } },
    select: { email: true },
  });
  const existingEmails = new Set(existing.map((c) => c.email!));

  const plan = planImport(rows, mapping, existingEmails);
  if (dryRun) {
    return NextResponse.json({ plan });
  }

  const touchedIds: number[] = [];

  async function orgIdFor(row: ImportRow): Promise<number | null> {
    if (!row.organizationName) return null;
    const found = await prisma.organization.findFirst({
      where: { name: { equals: row.organizationName, mode: 'insensitive' } },
    });
    if (found) return found.id;
    const created = await prisma.organization.create({
      data: { name: row.organizationName, stage: 'lead' },
    });
    return created.id;
  }

  for (const row of plan.create) {
    const contact = await prisma.contact.create({
      data: {
        name: row.name, email: row.email, phone: row.phone,
        organizationId: await orgIdFor(row), source: 'import',
      },
    });
    touchedIds.push(contact.id);
    await prisma.contactActivity.create({
      data: { contactId: contact.id, type: 'import', title: 'Importert fra CSV', actorEmail: session.user.email },
    });
  }

  for (const row of plan.update) {
    const contact = await prisma.contact.update({
      where: { email: row.email! },
      data: {
        name: row.name,
        ...(row.phone && { phone: row.phone }),
      },
    });
    touchedIds.push(contact.id);
  }

  if (listId && touchedIds.length > 0) {
    await prisma.contactListMembership.createMany({
      data: touchedIds.map((contactId) => ({ listId, contactId })),
      skipDuplicates: true,
    });
  }

  logActivity({
    action: 'create', entity: 'contact_import',
    details: JSON.stringify({ created: plan.create.length, updated: plan.update.length, skipped: plan.skip.length }),
    userEmail: session.user.email,
  }).catch(() => {});

  return NextResponse.json({
    created: plan.create.length,
    updated: plan.update.length,
    skipped: plan.skip.length,
  });
}
```

- [ ] **Step 6: Typecheck + full tests + commit**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no type errors, all tests PASS.

```bash
git add lib/crm/import.ts tests/crm-import.test.ts app/api/admin/crm/import
git commit -m "feat(crm): CSV import planning + API" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: UI — nav entry + contacts list page

**Files:**
- Modify: `app/admin/AdminShell.tsx` (nav item + breadcrumb labels)
- Create: `app/admin/crm/page.tsx` (redirect)
- Create: `app/admin/crm/kontakter/page.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/crm/contacts` and `GET /api/admin/crm/segments` (Tasks 8, 12); components `TableSkeleton`, `EmptyState`, `Pagination`, `useToast` from `@/components/admin`.

- [ ] **Step 1: Add nav + breadcrumbs in AdminShell**

In `app/admin/AdminShell.tsx`, in the nav items array (after the `Forespørsler` entry, line ~15), add:

```typescript
  { href: '/admin/crm/kontakter', label: 'CRM', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
```

In the breadcrumb `labelMap` (line ~34), add:

```typescript
      crm: 'CRM',
      kontakter: 'Kontakter',
      bedrifter: 'Bedrifter',
      pipeline: 'Pipeline',
      oppgaver: 'Oppgaver',
      import: 'Import',
```

Note: `isActive` uses `pathname.startsWith(href)`, so the nav item stays highlighted on all `/admin/crm/*` sub-pages only if `href` is `/admin/crm/kontakter`. Change the nav item check is not needed — accepted that only Kontakter highlights; sub-pages get a local tab bar (Step 3).

- [ ] **Step 2: Create redirect page**

Create `app/admin/crm/page.tsx`:

```typescript
import { redirect } from 'next/navigation';

export default function CrmIndexPage() {
  redirect('/admin/crm/kontakter');
}
```

- [ ] **Step 3: Create shared CRM tab bar component**

Create `components/admin/CrmTabs.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/admin/crm/kontakter', label: 'Kontakter' },
  { href: '/admin/crm/bedrifter', label: 'Bedrifter' },
  { href: '/admin/crm/pipeline', label: 'Pipeline' },
  { href: '/admin/crm/oppgaver', label: 'Oppgaver' },
  { href: '/admin/crm/import', label: 'Import' },
];

export function CrmTabs() {
  const pathname = usePathname();
  return (
    <div className="flex gap-1 border-b border-gray-200 mb-6">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-2 text-sm font-medium rounded-t-md border-b-2 -mb-px transition-colors ${
              active
                ? 'border-blue-600 text-blue-700 bg-blue-50'
                : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
```

Also export it from `components/admin/index.ts` (add `export { CrmTabs } from './CrmTabs';`).

- [ ] **Step 4: Create contacts list page**

Create `app/admin/crm/kontakter/page.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TableSkeleton } from '@/components/admin/Skeleton';
import { EmptyState } from '@/components/admin/EmptyState';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { useToast } from '@/components/admin/Toast';

interface ContactRow {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  stage: string;
  source: string;
  tags: string[];
  organization: { id: number; name: string } | null;
  lastActivityAt: string | null;
  dealCount: number;
}

interface Segment { id: number; name: string }

const STAGE_LABELS: Record<string, string> = {
  lead: 'Interessent', active: 'Aktiv', customer: 'Kunde', dormant: 'Sovende', lost: 'Tapt',
};

export default function KontakterPage() {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', email: '', phone: '' });
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (stage) params.set('stage', stage);
    if (segmentId) params.set('segmentId', segmentId);
    params.set('page', String(page));
    const res = await fetch(`/api/admin/crm/contacts?${params}`);
    const data = await res.json();
    setContacts(data.contacts || []);
    setTotal(data.total || 0);
    setPageSize(data.pageSize || 50);
    setLoading(false);
  }, [q, stage, segmentId, page]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    fetch('/api/admin/crm/segments')
      .then((r) => r.json())
      .then((d) => setSegments(d.segments || []));
  }, []);

  async function createContact() {
    const res = await fetch('/api/admin/crm/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newContact.name,
        email: newContact.email || null,
        phone: newContact.phone || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Kunne ikke opprette kontakt', 'error');
      return;
    }
    toast('Kontakt opprettet', 'success');
    setShowNew(false);
    setNewContact({ name: '', email: '', phone: '' });
    load();
  }

  return (
    <div>
      <CrmTabs />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="search"
          placeholder="Søk navn, e-post, telefon …"
          value={q}
          onChange={(e) => { setPage(1); setQ(e.target.value); }}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm w-64"
        />
        <select
          value={stage}
          onChange={(e) => { setPage(1); setStage(e.target.value); }}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
        >
          <option value="">Alle stadier</option>
          {Object.entries(STAGE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          value={segmentId}
          onChange={(e) => { setPage(1); setSegmentId(e.target.value); }}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
        >
          <option value="">Alle segmenter</option>
          {segments.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <span className="text-sm text-gray-500">{total} kontakter</span>
        <button
          onClick={() => setShowNew(true)}
          className="ml-auto bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
        >
          Ny kontakt
        </button>
      </div>

      {showNew && (
        <div className="border border-gray-200 rounded-lg p-4 mb-4 bg-gray-50 flex flex-wrap gap-3 items-end">
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Navn *</span>
            <input value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">E-post</span>
            <input type="email" value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Telefon</span>
            <input value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm" />
          </label>
          <button onClick={createContact} disabled={!newContact.name}
            className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
            Lagre
          </button>
          <button onClick={() => setShowNew(false)} className="text-sm text-gray-600 px-2 py-2">Avbryt</button>
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={8} />
      ) : contacts.length === 0 ? (
        <EmptyState title="Ingen kontakter" description="Opprett en kontakt eller importer fra CSV." />
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">Navn</th>
                <th className="px-4 py-3 font-medium">E-post</th>
                <th className="px-4 py-3 font-medium">Bedrift</th>
                <th className="px-4 py-3 font-medium">Stadium</th>
                <th className="px-4 py-3 font-medium">Deals</th>
                <th className="px-4 py-3 font-medium">Sist aktiv</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {contacts.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/crm/kontakter/${c.id}`} className="font-medium text-blue-700 hover:underline">
                      {c.name}
                    </Link>
                    {c.tags.length > 0 && (
                      <span className="ml-2 space-x-1">
                        {c.tags.map((t) => (
                          <span key={t} className="inline-block bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded">{t}</span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{c.email ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {c.organization ? (
                      <Link href={`/admin/crm/bedrifter/${c.organization.id}`} className="hover:underline">
                        {c.organization.name}
                      </Link>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">{STAGE_LABELS[c.stage] ?? c.stage}</td>
                  <td className="px-4 py-3">{c.dealCount}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {c.lastActivityAt ? new Date(c.lastActivityAt).toLocaleDateString('nb-NO') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > pageSize && (
        <div className="flex items-center gap-2 mt-4 text-sm">
          <button disabled={page === 1} onClick={() => setPage(page - 1)}
            className="border rounded px-3 py-1 disabled:opacity-40">Forrige</button>
          <span>Side {page} av {Math.ceil(total / pageSize)}</span>
          <button disabled={page >= Math.ceil(total / pageSize)} onClick={() => setPage(page + 1)}
            className="border rounded px-3 py-1 disabled:opacity-40">Neste</button>
        </div>
      )}
    </div>
  );
}
```

Note for implementer: check `components/admin/EmptyState.tsx` and `Skeleton.tsx` prop names before use (`TableSkeleton rows` / `EmptyState title description`) — adjust to their actual APIs if they differ.

- [ ] **Step 5: Verify in dev + commit**

Run: `pnpm dev` (use the project's configured port) and open `/admin/crm/kontakter` as an admin user.
Expected: tab bar renders, backfilled contacts from Task 7 are listed, search and filters work, "Ny kontakt" creates and appears in the list.

```bash
git add app/admin/AdminShell.tsx app/admin/crm components/admin/CrmTabs.tsx components/admin/index.ts
git commit -m "feat(crm): admin nav + contacts list UI" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: UI — contact detail (timeline, deals, tasks, notes, consent)

**Files:**
- Create: `app/admin/crm/kontakter/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET/PATCH /api/admin/crm/contacts/:id`, `PUT /api/admin/crm/contacts/:id/consent` (Task 8), `POST /api/admin/crm/notes` (Task 11), `POST/PATCH /api/admin/crm/tasks` (Task 11).

- [ ] **Step 1: Create the detail page**

Create `app/admin/crm/kontakter/[id]/page.tsx`:

```tsx
'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { useToast } from '@/components/admin/Toast';

interface ContactDetail {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  roleTitle: string | null;
  stage: string;
  source: string;
  tags: string[];
  organization: { id: number; name: string } | null;
  consent: { marketing: boolean; lawfulBasis: string | null; consentAt: string | null } | null;
  deals: { id: number; title: string; value: number | null; eventType: string | null; eventDate: string | null; status: string; stage: { name: string }; pipeline: { name: string } }[];
  tasks: { id: number; title: string; dueAt: string | null; status: string }[];
  notes: { id: number; body: string; authorEmail: string; createdAt: string }[];
  activities: { id: number; type: string; title: string; body: string | null; actorEmail: string | null; occurredAt: string }[];
}

const STAGES = [
  { value: 'lead', label: 'Interessent' }, { value: 'active', label: 'Aktiv' },
  { value: 'customer', label: 'Kunde' }, { value: 'dormant', label: 'Sovende' },
  { value: 'lost', label: 'Tapt' },
];

const ACTIVITY_ICONS: Record<string, string> = {
  booking: '📅', registration: '📝', note: '🗒️', task: '✅',
  deal_change: '💼', import: '📥', event: '⚡',
};

function fmtDate(d: string | null): string {
  return d ? new Date(d).toLocaleDateString('nb-NO') : '—';
}

export default function KontaktDetaljPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [noteText, setNoteText] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const { toast } = useToast();

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/crm/contacts/${id}`);
    if (res.ok) {
      const data = await res.json();
      setContact(data.contact);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function patch(body: Record<string, unknown>, okMsg: string) {
    const res = await fetch(`/api/admin/crm/contacts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json();
      toast(data.error || 'Noe gikk galt', 'error');
      return;
    }
    toast(okMsg, 'success');
    load();
  }

  async function setConsent(marketing: boolean) {
    const res = await fetch(`/api/admin/crm/contacts/${id}/consent`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marketing, lawfulBasis: marketing ? 'consent' : null }),
    });
    if (res.ok) { toast('Samtykke oppdatert', 'success'); load(); }
  }

  async function addNote() {
    if (!noteText.trim()) return;
    const res = await fetch('/api/admin/crm/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: noteText, contactId: Number(id) }),
    });
    if (res.ok) { setNoteText(''); toast('Notat lagret', 'success'); load(); }
  }

  async function addTask() {
    if (!taskTitle.trim()) return;
    const res = await fetch('/api/admin/crm/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: taskTitle, contactId: Number(id),
        dueAt: taskDue ? new Date(taskDue).toISOString() : null,
      }),
    });
    if (res.ok) { setTaskTitle(''); setTaskDue(''); toast('Oppgave opprettet', 'success'); load(); }
  }

  async function toggleTask(taskId: number, status: string) {
    await fetch(`/api/admin/crm/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: status === 'done' ? 'open' : 'done' }),
    });
    load();
  }

  if (loading) return <div className="text-gray-500 p-8">Laster …</div>;
  if (!contact) return <div className="text-gray-500 p-8">Kontakten finnes ikke.</div>;

  return (
    <div>
      <CrmTabs />

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">{contact.name}</h1>
          <p className="text-gray-600 text-sm mt-1">
            {contact.email ?? 'Ingen e-post'} · {contact.phone ?? 'Ingen telefon'}
            {contact.organization && (
              <> · <Link href={`/admin/crm/bedrifter/${contact.organization.id}`} className="text-blue-700 hover:underline">{contact.organization.name}</Link></>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600">
            Stadium:{' '}
            <select
              value={contact.stage}
              onChange={(e) => patch({ stage: e.target.value }, 'Stadium oppdatert')}
              className="border border-gray-300 rounded-md px-2 py-1 text-sm"
            >
              {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={contact.consent?.marketing ?? false}
              onChange={(e) => setConsent(e.target.checked)}
            />
            Markedsføringssamtykke
          </label>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Venstre: tidslinje */}
        <section>
          <h2 className="font-semibold mb-3">Tidslinje</h2>
          {contact.activities.length === 0 ? (
            <p className="text-sm text-gray-500">Ingen aktivitet ennå.</p>
          ) : (
            <ol className="space-y-3">
              {contact.activities.map((a) => (
                <li key={a.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{ACTIVITY_ICONS[a.type] ?? '·'} {a.title}</span>
                    <span className="text-gray-500 text-xs">{fmtDate(a.occurredAt)}</span>
                  </div>
                  {a.body && <p className="text-gray-600 mt-1 whitespace-pre-wrap">{a.body}</p>}
                  {a.actorEmail && <p className="text-gray-400 text-xs mt-1">{a.actorEmail}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Høyre: deals, oppgaver, notater */}
        <div className="space-y-6">
          <section>
            <h2 className="font-semibold mb-3">Deals ({contact.deals.length})</h2>
            {contact.deals.length === 0 ? (
              <p className="text-sm text-gray-500">Ingen deals.</p>
            ) : (
              <ul className="space-y-2">
                {contact.deals.map((d) => (
                  <li key={d.id} className="border border-gray-200 rounded-lg p-3 text-sm flex items-center justify-between">
                    <div>
                      <span className="font-medium">{d.title}</span>
                      <span className="text-gray-500 ml-2">{d.stage.name}</span>
                      {d.eventDate && <span className="text-gray-500 ml-2">{fmtDate(d.eventDate)}</span>}
                    </div>
                    <span className="text-gray-700">{d.value !== null ? `${d.value.toLocaleString('nb-NO')} kr` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="font-semibold mb-3">Oppgaver</h2>
            <div className="flex gap-2 mb-2">
              <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Ny oppgave …"
                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm flex-1" />
              <input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
              <button onClick={addTask} disabled={!taskTitle.trim()}
                className="bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm disabled:opacity-50">Legg til</button>
            </div>
            <ul className="space-y-1">
              {contact.tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-sm py-1">
                  <input type="checkbox" checked={t.status === 'done'} onChange={() => toggleTask(t.id, t.status)} />
                  <span className={t.status === 'done' ? 'line-through text-gray-400' : ''}>{t.title}</span>
                  {t.dueAt && <span className="text-gray-500 text-xs ml-auto">{fmtDate(t.dueAt)}</span>}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-semibold mb-3">Notater</h2>
            <div className="flex gap-2 mb-2">
              <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Skriv et notat …"
                rows={2} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm flex-1" />
              <button onClick={addNote} disabled={!noteText.trim()}
                className="bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm self-end disabled:opacity-50">Lagre</button>
            </div>
            <ul className="space-y-2">
              {contact.notes.map((n) => (
                <li key={n.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <p className="text-gray-400 text-xs mt-1">{n.authorEmail} · {fmtDate(n.createdAt)}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify in dev + commit**

Open `/admin/crm/kontakter/<id>` for a backfilled contact.
Expected: header with stage select and consent checkbox; timeline shows the booking/registration entries with historic dates; adding a note/task updates both its section AND the timeline (reload shows the note in the timeline).

```bash
git add 'app/admin/crm/kontakter/[id]/page.tsx'
git commit -m "feat(crm): contact detail UI" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: UI — organizations list + detail

**Files:**
- Create: `app/admin/crm/bedrifter/page.tsx`
- Create: `app/admin/crm/bedrifter/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/admin/crm/organizations`, `GET/PATCH /api/admin/crm/organizations/:id` (Task 9), `POST /api/admin/crm/notes` (Task 11).

- [ ] **Step 1: Create organizations list page**

Create `app/admin/crm/bedrifter/page.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TableSkeleton } from '@/components/admin/Skeleton';
import { EmptyState } from '@/components/admin/EmptyState';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { useToast } from '@/components/admin/Toast';

interface OrgRow {
  id: number;
  name: string;
  domain: string | null;
  phone: string | null;
  stage: string;
  contactCount: number;
  dealCount: number;
  lastActivityAt: string | null;
}

const STAGE_LABELS: Record<string, string> = {
  lead: 'Interessent', active: 'Aktiv', customer: 'Kunde', dormant: 'Sovende', lost: 'Tapt',
};

export default function BedrifterPage() {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [newOrg, setNewOrg] = useState({ name: '', domain: '', phone: '' });
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    const res = await fetch(`/api/admin/crm/organizations?${params}`);
    const data = await res.json();
    setOrgs(data.organizations || []);
    setLoading(false);
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function createOrg() {
    const res = await fetch('/api/admin/crm/organizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newOrg.name,
        domain: newOrg.domain || null,
        phone: newOrg.phone || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Kunne ikke opprette bedrift', 'error');
      return;
    }
    toast('Bedrift opprettet', 'success');
    setShowNew(false);
    setNewOrg({ name: '', domain: '', phone: '' });
    load();
  }

  return (
    <div>
      <CrmTabs />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="search"
          placeholder="Søk navn, domene, org.nr …"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm w-64"
        />
        <button
          onClick={() => setShowNew(true)}
          className="ml-auto bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
        >
          Ny bedrift
        </button>
      </div>

      {showNew && (
        <div className="border border-gray-200 rounded-lg p-4 mb-4 bg-gray-50 flex flex-wrap gap-3 items-end">
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Navn *</span>
            <input value={newOrg.name} onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Domene</span>
            <input placeholder="acme.no" value={newOrg.domain} onChange={(e) => setNewOrg({ ...newOrg, domain: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Telefon</span>
            <input value={newOrg.phone} onChange={(e) => setNewOrg({ ...newOrg, phone: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm" />
          </label>
          <button onClick={createOrg} disabled={!newOrg.name}
            className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">Lagre</button>
          <button onClick={() => setShowNew(false)} className="text-sm text-gray-600 px-2 py-2">Avbryt</button>
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={6} />
      ) : orgs.length === 0 ? (
        <EmptyState title="Ingen bedrifter" description="Bedrifter opprettes automatisk fra bookinger med firmadomene, eller manuelt her." />
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">Navn</th>
                <th className="px-4 py-3 font-medium">Domene</th>
                <th className="px-4 py-3 font-medium">Stadium</th>
                <th className="px-4 py-3 font-medium">Kontakter</th>
                <th className="px-4 py-3 font-medium">Deals</th>
                <th className="px-4 py-3 font-medium">Sist aktiv</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orgs.map((o) => (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/crm/bedrifter/${o.id}`} className="font-medium text-blue-700 hover:underline">
                      {o.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{o.domain ?? '—'}</td>
                  <td className="px-4 py-3">{STAGE_LABELS[o.stage] ?? o.stage}</td>
                  <td className="px-4 py-3">{o.contactCount}</td>
                  <td className="px-4 py-3">{o.dealCount}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {o.lastActivityAt ? new Date(o.lastActivityAt).toLocaleDateString('nb-NO') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create organization detail page**

Create `app/admin/crm/bedrifter/[id]/page.tsx`:

```tsx
'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { useToast } from '@/components/admin/Toast';

interface OrgDetail {
  id: number;
  name: string;
  domain: string | null;
  orgNumber: string | null;
  phone: string | null;
  address: string | null;
  stage: string;
  tags: string[];
  contacts: { id: number; name: string; email: string | null; phone: string | null; roleTitle: string | null }[];
  deals: { id: number; title: string; value: number | null; eventType: string | null; eventDate: string | null; status: string; stage: { name: string } }[];
  activities: { id: number; type: string; title: string; body: string | null; occurredAt: string }[];
}

const STAGES = [
  { value: 'lead', label: 'Interessent' }, { value: 'active', label: 'Aktiv' },
  { value: 'customer', label: 'Kunde' }, { value: 'dormant', label: 'Sovende' },
  { value: 'lost', label: 'Tapt' },
];

function fmtDate(d: string | null): string {
  return d ? new Date(d).toLocaleDateString('nb-NO') : '—';
}

export default function BedriftDetaljPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [noteText, setNoteText] = useState('');
  const { toast } = useToast();

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/crm/organizations/${id}`);
    if (res.ok) {
      const data = await res.json();
      setOrg(data.organization);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function setStage(stage: string) {
    const res = await fetch(`/api/admin/crm/organizations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage }),
    });
    if (res.ok) { toast('Stadium oppdatert', 'success'); load(); }
  }

  async function addNote() {
    if (!noteText.trim()) return;
    const res = await fetch('/api/admin/crm/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: noteText, organizationId: Number(id) }),
    });
    if (res.ok) { setNoteText(''); toast('Notat lagret', 'success'); load(); }
  }

  if (loading) return <div className="text-gray-500 p-8">Laster …</div>;
  if (!org) return <div className="text-gray-500 p-8">Bedriften finnes ikke.</div>;

  const totalValue = org.deals
    .filter((d) => d.status !== 'lost' && d.value !== null)
    .reduce((sum, d) => sum + (d.value ?? 0), 0);

  return (
    <div>
      <CrmTabs />

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">{org.name}</h1>
          <p className="text-gray-600 text-sm mt-1">
            {org.domain ?? 'Ikke noe domene'} · {org.phone ?? 'Ingen telefon'}
            {org.orgNumber && <> · Org.nr {org.orgNumber}</>}
          </p>
          <p className="text-gray-700 text-sm mt-2 font-medium">
            Samlet verdi (åpne + vunnede deals): {totalValue.toLocaleString('nb-NO')} kr
          </p>
        </div>
        <label className="text-sm text-gray-600">
          Stadium:{' '}
          <select value={org.stage} onChange={(e) => setStage(e.target.value)}
            className="border border-gray-300 rounded-md px-2 py-1 text-sm">
            {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-6">
          <section>
            <h2 className="font-semibold mb-3">Kontaktpersoner ({org.contacts.length})</h2>
            {org.contacts.length === 0 ? (
              <p className="text-sm text-gray-500">Ingen kontaktpersoner.</p>
            ) : (
              <ul className="space-y-2">
                {org.contacts.map((c) => (
                  <li key={c.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                    <Link href={`/admin/crm/kontakter/${c.id}`} className="font-medium text-blue-700 hover:underline">
                      {c.name}
                    </Link>
                    {c.roleTitle && <span className="text-gray-500 ml-2">{c.roleTitle}</span>}
                    <p className="text-gray-600 mt-0.5">{c.email ?? '—'} · {c.phone ?? '—'}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="font-semibold mb-3">Bookinghistorikk ({org.deals.length})</h2>
            {org.deals.length === 0 ? (
              <p className="text-sm text-gray-500">Ingen deals ennå.</p>
            ) : (
              <ul className="space-y-2">
                {org.deals.map((d) => (
                  <li key={d.id} className="border border-gray-200 rounded-lg p-3 text-sm flex items-center justify-between">
                    <div>
                      <span className="font-medium">{d.title}</span>
                      <span className="text-gray-500 ml-2">{d.stage.name}</span>
                      {d.eventType && <span className="bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded ml-2">{d.eventType}</span>}
                      {d.eventDate && <span className="text-gray-500 ml-2">{fmtDate(d.eventDate)}</span>}
                    </div>
                    <span className="text-gray-700">{d.value !== null ? `${d.value.toLocaleString('nb-NO')} kr` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section>
            <h2 className="font-semibold mb-3">Notat</h2>
            <div className="flex gap-2">
              <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Skriv et notat …"
                rows={2} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm flex-1" />
              <button onClick={addNote} disabled={!noteText.trim()}
                className="bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm self-end disabled:opacity-50">Lagre</button>
            </div>
          </section>

          <section>
            <h2 className="font-semibold mb-3">Tidslinje</h2>
            {org.activities.length === 0 ? (
              <p className="text-sm text-gray-500">Ingen aktivitet ennå.</p>
            ) : (
              <ol className="space-y-3">
                {org.activities.map((a) => (
                  <li key={a.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{a.title}</span>
                      <span className="text-gray-500 text-xs">{fmtDate(a.occurredAt)}</span>
                    </div>
                    {a.body && <p className="text-gray-600 mt-1 whitespace-pre-wrap">{a.body}</p>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify in dev + commit**

Open `/admin/crm/bedrifter`. Expected: backfilled companies (from company-domain bookings) listed; detail shows contact people, full booking history with event types/dates, and total value — the re-engagement view.

```bash
git add app/admin/crm/bedrifter
git commit -m "feat(crm): organizations UI" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: UI — pipeline kanban

**Files:**
- Create: `app/admin/crm/pipeline/page.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/crm/pipelines`, `PATCH /api/admin/crm/deals/:id` (Task 10).

- [ ] **Step 1: Create the kanban page**

Create `app/admin/crm/pipeline/page.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { useToast } from '@/components/admin/Toast';

interface DealCard {
  id: number;
  title: string;
  value: number | null;
  eventType: string | null;
  eventDate: string | null;
  status: string;
  contact: { id: number; name: string } | null;
  organization: { id: number; name: string } | null;
}

interface StageCol {
  id: number;
  name: string;
  position: number;
  isWon: boolean;
  isLost: boolean;
  deals: DealCard[];
}

interface Pipeline {
  id: number;
  name: string;
  stages: StageCol[];
}

export default function PipelinePage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [activePipelineId, setActivePipelineId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState<number | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/crm/pipelines');
    const data = await res.json();
    setPipelines(data.pipelines || []);
    setActivePipelineId((prev) => prev ?? data.pipelines?.[0]?.id ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const pipeline = pipelines.find((p) => p.id === activePipelineId) ?? null;

  async function moveDeal(dealId: number, stageId: number) {
    // Optimistisk flytt i UI
    setPipelines((prev) => prev.map((p) => {
      if (p.id !== activePipelineId) return p;
      let moved: DealCard | undefined;
      const stages = p.stages.map((s) => {
        const found = s.deals.find((d) => d.id === dealId);
        if (found) moved = found;
        return { ...s, deals: s.deals.filter((d) => d.id !== dealId) };
      });
      return {
        ...p,
        stages: stages.map((s) => (s.id === stageId && moved ? { ...s, deals: [moved, ...s.deals] } : s)),
      };
    }));

    const res = await fetch(`/api/admin/crm/deals/${dealId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stageId }),
    });
    if (!res.ok) {
      const data = await res.json();
      toast(data.error || 'Kunne ikke flytte deal', 'error');
      load(); // rull tilbake til serverens sannhet
    }
  }

  if (loading) return <div className="text-gray-500 p-8">Laster …</div>;
  if (!pipeline) return <div className="text-gray-500 p-8">Ingen pipeline.</div>;

  return (
    <div>
      <CrmTabs />
      {pipelines.length > 1 && (
        <select
          value={activePipelineId ?? ''}
          onChange={(e) => setActivePipelineId(Number(e.target.value))}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm mb-4"
        >
          {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}

      <div className="flex gap-4 overflow-x-auto pb-4">
        {pipeline.stages.map((stage) => {
          const sum = stage.deals.reduce((acc, d) => acc + (d.value ?? 0), 0);
          return (
            <div
              key={stage.id}
              className="flex-shrink-0 w-72 bg-gray-50 rounded-lg border border-gray-200"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragId !== null) { moveDeal(dragId, stage.id); setDragId(null); } }}
            >
              <div className={`px-3 py-2 border-b border-gray-200 flex items-center justify-between rounded-t-lg ${
                stage.isWon ? 'bg-green-50' : stage.isLost ? 'bg-red-50' : 'bg-gray-100'
              }`}>
                <span className="font-semibold text-sm">{stage.name}</span>
                <span className="text-xs text-gray-500">
                  {stage.deals.length}{sum > 0 && ` · ${sum.toLocaleString('nb-NO')} kr`}
                </span>
              </div>
              <div className="p-2 space-y-2 min-h-24">
                {stage.deals.map((deal) => (
                  <div
                    key={deal.id}
                    draggable
                    onDragStart={() => setDragId(deal.id)}
                    onDragEnd={() => setDragId(null)}
                    className={`bg-white border border-gray-200 rounded-md p-3 text-sm shadow-sm cursor-grab active:cursor-grabbing ${
                      dragId === deal.id ? 'opacity-50' : ''
                    }`}
                  >
                    <p className="font-medium leading-snug">{deal.title}</p>
                    <div className="flex flex-wrap gap-x-2 mt-1 text-xs text-gray-500">
                      {deal.eventType && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{deal.eventType}</span>}
                      {deal.eventDate && <span>{new Date(deal.eventDate).toLocaleDateString('nb-NO')}</span>}
                      {deal.value !== null && <span>{deal.value.toLocaleString('nb-NO')} kr</span>}
                    </div>
                    {(deal.organization || deal.contact) && (
                      <p className="text-xs mt-1">
                        {deal.organization && (
                          <Link href={`/admin/crm/bedrifter/${deal.organization.id}`} className="text-blue-700 hover:underline">
                            {deal.organization.name}
                          </Link>
                        )}
                        {deal.organization && deal.contact && ' · '}
                        {deal.contact && (
                          <Link href={`/admin/crm/kontakter/${deal.contact.id}`} className="text-blue-700 hover:underline">
                            {deal.contact.name}
                          </Link>
                        )}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify in dev + commit**

Open `/admin/crm/pipeline`. Expected: six columns (Ny → Tapt), backfilled deals as cards, drag a card to another column → sticks after reload, column header shows count and sum; dropping into Bekreftet marks the deal `won` (verify via contact detail deal status).

```bash
git add app/admin/crm/pipeline
git commit -m "feat(crm): pipeline kanban UI" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: UI — tasks page

**Files:**
- Create: `app/admin/crm/oppgaver/page.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/admin/crm/tasks`, `PATCH /api/admin/crm/tasks/:id` (Task 11).

- [ ] **Step 1: Create the tasks page**

Create `app/admin/crm/oppgaver/page.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { EmptyState } from '@/components/admin/EmptyState';
import { useToast } from '@/components/admin/Toast';

interface TaskRow {
  id: number;
  title: string;
  dueAt: string | null;
  status: string;
  contact: { id: number; name: string } | null;
  assignee: { id: number; email: string } | null;
}

export default function OppgaverPage() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('open');
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    const res = await fetch(`/api/admin/crm/tasks?${params}`);
    const data = await res.json();
    setTasks(data.tasks || []);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function createTask() {
    if (!title.trim()) return;
    const res = await fetch('/api/admin/crm/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, dueAt: dueAt ? new Date(dueAt).toISOString() : null }),
    });
    if (res.ok) { setTitle(''); setDueAt(''); toast('Oppgave opprettet', 'success'); load(); }
  }

  async function toggle(task: TaskRow) {
    await fetch(`/api/admin/crm/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: task.status === 'done' ? 'open' : 'done' }),
    });
    load();
  }

  const overdue = (t: TaskRow) =>
    t.status === 'open' && t.dueAt !== null && new Date(t.dueAt) < new Date();

  return (
    <div>
      <CrmTabs />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm">
          <option value="open">Åpne</option>
          <option value="done">Fullførte</option>
          <option value="">Alle</option>
        </select>
        <div className="ml-auto flex gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ny oppgave …"
            className="border border-gray-300 rounded-md px-3 py-2 text-sm w-64" />
          <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)}
            className="border border-gray-300 rounded-md px-2 py-2 text-sm" />
          <button onClick={createTask} disabled={!title.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">Legg til</button>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-500 p-8">Laster …</div>
      ) : tasks.length === 0 ? (
        <EmptyState title="Ingen oppgaver" description="Opprett oppgaver her eller fra en kontakt." />
      ) : (
        <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <input type="checkbox" checked={t.status === 'done'} onChange={() => toggle(t)} />
              <span className={t.status === 'done' ? 'line-through text-gray-400' : ''}>{t.title}</span>
              {t.contact && (
                <Link href={`/admin/crm/kontakter/${t.contact.id}`} className="text-blue-700 hover:underline text-xs">
                  {t.contact.name}
                </Link>
              )}
              <span className={`ml-auto text-xs ${overdue(t) ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                {t.dueAt ? new Date(t.dueAt).toLocaleDateString('nb-NO') : ''}
                {overdue(t) && ' (forfalt)'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify in dev + commit**

Open `/admin/crm/oppgaver`. Expected: tasks created from contact detail appear; checkbox toggles done; overdue dates highlighted red; filter works.

```bash
git add app/admin/crm/oppgaver
git commit -m "feat(crm): tasks UI" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: UI — CSV import wizard

**Files:**
- Create: `app/admin/crm/import/page.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/crm/import` with `dryRun: true|false` (Task 13), `GET /api/admin/crm/lists` + `POST /api/admin/crm/lists` (Task 12).

- [ ] **Step 1: Create the import page**

Create `app/admin/crm/import/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { useToast } from '@/components/admin/Toast';

interface ImportPlanRow { row: number; name: string; email: string | null; phone: string | null; organizationName: string | null }
interface ImportPlan { create: ImportPlanRow[]; update: ImportPlanRow[]; skip: { row: number; reason: string }[] }
interface List { id: number; name: string }

type MappingKey = 'name' | 'email' | 'phone' | 'organization';
const MAPPING_LABELS: Record<MappingKey, string> = {
  name: 'Navn', email: 'E-post', phone: 'Telefon', organization: 'Bedrift',
};

export default function ImportPage() {
  const [csv, setCsv] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<MappingKey, number | null>>({
    name: null, email: null, phone: null, organization: null,
  });
  const [lists, setLists] = useState<List[]>([]);
  const [listId, setListId] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetch('/api/admin/crm/lists').then((r) => r.json()).then((d) => setLists(d.lists || []));
  }, []);

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setCsv(text);
      setPlan(null);
      setResult(null);
      // Første linje = header — autodetekter skilletegn som i lib/crm/csv.ts
      const firstLine = text.split('\n')[0] ?? '';
      const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
      const cols = firstLine.replace(/^﻿/, '').split(delimiter).map((h) => h.replace(/^"|"$/g, '').trim());
      setHeaders(cols);
      // Gjett mapping fra headernavn
      const guess = (patterns: RegExp): number | null => {
        const i = cols.findIndex((c) => patterns.test(c.toLowerCase()));
        return i === -1 ? null : i;
      };
      setMapping({
        name: guess(/navn|name/),
        email: guess(/e-?post|email|mail/),
        phone: guess(/telefon|phone|mobil|tlf/),
        organization: guess(/bedrift|firma|selskap|company|org/),
      });
    };
    reader.readAsText(file);
  }

  async function preview() {
    setBusy(true);
    const res = await fetch('/api/admin/crm/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv, mapping, dryRun: true }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { toast(data.error || 'Kunne ikke lese CSV', 'error'); return; }
    setPlan(data.plan);
  }

  async function commit() {
    setBusy(true);
    const res = await fetch('/api/admin/crm/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv, mapping, listId: listId ? Number(listId) : null, dryRun: false }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { toast(data.error || 'Import feilet', 'error'); return; }
    setResult(data);
    setPlan(null);
    toast(`Importert: ${data.created} nye, ${data.updated} oppdatert`, 'success');
  }

  return (
    <div>
      <CrmTabs />
      <div className="max-w-3xl space-y-6">
        <section>
          <h2 className="font-semibold mb-2">1. Velg CSV-fil</h2>
          <p className="text-sm text-gray-500 mb-2">Komma- eller semikolonseparert (norsk Excel), første rad må være kolonnenavn.</p>
          <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            className="text-sm" />
        </section>

        {headers.length > 0 && (
          <section>
            <h2 className="font-semibold mb-2">2. Koble kolonner</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(Object.keys(MAPPING_LABELS) as MappingKey[]).map((key) => (
                <label key={key} className="text-sm">
                  <span className="block text-gray-600 mb-1">{MAPPING_LABELS[key]}{key === 'name' && ' *'}</span>
                  <select
                    value={mapping[key] ?? ''}
                    onChange={(e) => setMapping({ ...mapping, [key]: e.target.value === '' ? null : Number(e.target.value) })}
                    className="border border-gray-300 rounded-md px-2 py-1.5 text-sm w-full"
                  >
                    <option value="">— Ikke i filen —</option>
                    {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div className="flex items-end gap-3 mt-4">
              <label className="text-sm">
                <span className="block text-gray-600 mb-1">Legg til i liste (valgfritt)</span>
                <select value={listId} onChange={(e) => setListId(e.target.value)}
                  className="border border-gray-300 rounded-md px-2 py-1.5 text-sm">
                  <option value="">Ingen liste</option>
                  {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
              <button onClick={preview} disabled={busy || (mapping.name === null && mapping.email === null)}
                className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
                Forhåndsvis
              </button>
            </div>
          </section>
        )}

        {plan && (
          <section>
            <h2 className="font-semibold mb-2">3. Forhåndsvisning</h2>
            <p className="text-sm mb-3">
              <span className="text-green-700 font-medium">{plan.create.length} nye</span> ·{' '}
              <span className="text-blue-700 font-medium">{plan.update.length} oppdateres</span> ·{' '}
              <span className="text-gray-500 font-medium">{plan.skip.length} hoppes over</span>
            </p>
            {plan.skip.length > 0 && (
              <details className="text-sm text-gray-600 mb-3">
                <summary className="cursor-pointer">Vis hoppede rader</summary>
                <ul className="mt-1 list-disc pl-5">
                  {plan.skip.map((s) => <li key={s.row}>Rad {s.row}: {s.reason}</li>)}
                </ul>
              </details>
            )}
            <div className="overflow-x-auto border border-gray-200 rounded-lg mb-4 max-h-64 overflow-y-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-600 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 font-medium">Navn</th>
                    <th className="px-3 py-2 font-medium">E-post</th>
                    <th className="px-3 py-2 font-medium">Telefon</th>
                    <th className="px-3 py-2 font-medium">Bedrift</th>
                    <th className="px-3 py-2 font-medium">Handling</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[...plan.create.map((r) => ({ ...r, action: 'Ny' })), ...plan.update.map((r) => ({ ...r, action: 'Oppdater' }))].map((r) => (
                    <tr key={`${r.action}-${r.row}`}>
                      <td className="px-3 py-1.5">{r.name}</td>
                      <td className="px-3 py-1.5 text-gray-600">{r.email ?? '—'}</td>
                      <td className="px-3 py-1.5 text-gray-600">{r.phone ?? '—'}</td>
                      <td className="px-3 py-1.5 text-gray-600">{r.organizationName ?? '—'}</td>
                      <td className="px-3 py-1.5">{r.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={commit} disabled={busy}
              className="bg-green-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50">
              Importer {plan.create.length + plan.update.length} kontakter
            </button>
          </section>
        )}

        {result && (
          <section className="border border-green-200 bg-green-50 rounded-lg p-4 text-sm">
            Import fullført: {result.created} nye, {result.updated} oppdatert, {result.skipped} hoppet over.
          </section>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify in dev + commit**

Test with a semicolon-CSV: `navn;epost;bedrift` + a couple of rows (one duplicate email). Expected: auto-mapping guesses columns, preview shows Ny/Oppdater/skip correctly, commit creates contacts (visible in Kontakter with `import` source) and the org appears under Bedrifter.

```bash
git add app/admin/crm/import
git commit -m "feat(crm): CSV import wizard UI" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 20: UI — segments, lists & suppressions admin

**Files:**
- Create: `app/admin/crm/segmenter/page.tsx`
- Modify: `components/admin/CrmTabs.tsx` (add tab)
- Modify: `app/admin/AdminShell.tsx` (breadcrumb label)
- Modify: `app/admin/crm/import/page.tsx` (inline "Ny liste")

**Interfaces:**
- Consumes: segments/lists/suppressions APIs (Task 12); `SegmentOp` semantics from Task 3.

- [ ] **Step 1: Add tab + breadcrumb**

In `components/admin/CrmTabs.tsx`, add to `TABS` after Oppgaver:

```typescript
  { href: '/admin/crm/segmenter', label: 'Segmenter' },
```

In `app/admin/AdminShell.tsx` breadcrumb `labelMap`, add:

```typescript
      segmenter: 'Segmenter',
```

- [ ] **Step 2: Create the segments & suppressions page**

Create `app/admin/crm/segmenter/page.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { useToast } from '@/components/admin/Toast';

interface Segment { id: number; name: string; rules: string }
interface List { id: number; name: string; memberCount: number }
interface Suppression { id: number; email: string; reason: string; createdAt: string }
interface Rule { field: string; op: string; value: string }

const FIELDS = [
  { value: 'stage', label: 'Stadium' },
  { value: 'source', label: 'Kilde' },
  { value: 'email', label: 'E-post' },
  { value: 'tags', label: 'Tagg' },
  { value: 'deal.eventType', label: 'Deal: arrangementstype' },
  { value: 'deal.eventDate', label: 'Deal: dato' },
  { value: 'deal.status', label: 'Deal: status' },
];
const OPS = [
  { value: 'eq', label: 'er' },
  { value: 'neq', label: 'er ikke' },
  { value: 'contains', label: 'inneholder' },
  { value: 'lt', label: 'før/mindre enn' },
  { value: 'gt', label: 'etter/større enn' },
  { value: 'is_null', label: 'mangler' },
  { value: 'not_null', label: 'finnes' },
];

export default function SegmenterPage() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [suppressions, setSuppressions] = useState<Suppression[]>([]);
  const [segName, setSegName] = useState('');
  const [rules, setRules] = useState<Rule[]>([{ field: 'deal.eventType', op: 'eq', value: '' }]);
  const [listName, setListName] = useState('');
  const [suppressEmail, setSuppressEmail] = useState('');
  const { toast } = useToast();

  const load = useCallback(async () => {
    const [s, l, sup] = await Promise.all([
      fetch('/api/admin/crm/segments').then((r) => r.json()),
      fetch('/api/admin/crm/lists').then((r) => r.json()),
      fetch('/api/admin/crm/suppressions').then((r) => r.json()),
    ]);
    setSegments(s.segments || []);
    setLists(l.lists || []);
    setSuppressions(sup.suppressions || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createSegment() {
    if (!segName.trim()) return;
    const cleaned = rules
      .filter((r) => r.field && r.op)
      .map((r) => ({ field: r.field, op: r.op, ...(r.op === 'is_null' || r.op === 'not_null' ? {} : { value: r.value }) }));
    const res = await fetch('/api/admin/crm/segments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: segName, rules: JSON.stringify({ all: cleaned }) }),
    });
    if (res.ok) {
      toast('Segment opprettet', 'success');
      setSegName('');
      setRules([{ field: 'deal.eventType', op: 'eq', value: '' }]);
      load();
    }
  }

  async function deleteSegment(id: number) {
    await fetch(`/api/admin/crm/segments/${id}`, { method: 'DELETE' });
    load();
  }

  async function createList() {
    if (!listName.trim()) return;
    const res = await fetch('/api/admin/crm/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: listName }),
    });
    if (res.ok) { toast('Liste opprettet', 'success'); setListName(''); load(); }
  }

  async function addSuppression() {
    if (!suppressEmail.trim()) return;
    const res = await fetch('/api/admin/crm/suppressions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: suppressEmail }),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Ugyldig e-post', 'error'); return; }
    toast('Lagt til i ikke-kontakt-listen', 'success');
    setSuppressEmail('');
    load();
  }

  async function removeSuppression(email: string) {
    await fetch(`/api/admin/crm/suppressions?email=${encodeURIComponent(email)}`, { method: 'DELETE' });
    load();
  }

  return (
    <div>
      <CrmTabs />
      <div className="grid md:grid-cols-2 gap-8 max-w-5xl">
        <section>
          <h2 className="font-semibold mb-3">Segmenter</h2>
          <p className="text-sm text-gray-500 mb-3">
            Dynamiske utvalg av kontakter, f.eks. «booket julebord i fjor». Brukes som filter i kontaktlisten
            og senere som målgruppe for automatiske flyter.
          </p>
          <div className="border border-gray-200 rounded-lg p-4 mb-4 space-y-3">
            <input value={segName} onChange={(e) => setSegName(e.target.value)} placeholder="Navn, f.eks. Julebord 2025"
              className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full" />
            {rules.map((rule, i) => (
              <div key={i} className="flex gap-2 items-center">
                <select value={rule.field} onChange={(e) => setRules(rules.map((r, j) => j === i ? { ...r, field: e.target.value } : r))}
                  className="border border-gray-300 rounded-md px-2 py-1.5 text-sm">
                  {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
                <select value={rule.op} onChange={(e) => setRules(rules.map((r, j) => j === i ? { ...r, op: e.target.value } : r))}
                  className="border border-gray-300 rounded-md px-2 py-1.5 text-sm">
                  {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {rule.op !== 'is_null' && rule.op !== 'not_null' && (
                  <input value={rule.value} onChange={(e) => setRules(rules.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}
                    placeholder="verdi" className="border border-gray-300 rounded-md px-2 py-1.5 text-sm flex-1" />
                )}
                {rules.length > 1 && (
                  <button onClick={() => setRules(rules.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600 text-sm">✕</button>
                )}
              </div>
            ))}
            <div className="flex gap-2">
              <button onClick={() => setRules([...rules, { field: 'stage', op: 'eq', value: '' }])}
                className="text-sm text-blue-700 hover:underline">+ Legg til regel</button>
              <button onClick={createSegment} disabled={!segName.trim()}
                className="ml-auto bg-blue-600 text-white px-4 py-1.5 rounded-md text-sm disabled:opacity-50">Lagre segment</button>
            </div>
          </div>
          <ul className="space-y-2">
            {segments.map((s) => (
              <li key={s.id} className="border border-gray-200 rounded-lg p-3 text-sm flex items-center justify-between">
                <span className="font-medium">{s.name}</span>
                <button onClick={() => deleteSegment(s.id)} className="text-gray-400 hover:text-red-600 text-xs">Slett</button>
              </li>
            ))}
          </ul>
        </section>

        <div className="space-y-8">
          <section>
            <h2 className="font-semibold mb-3">Lister</h2>
            <div className="flex gap-2 mb-3">
              <input value={listName} onChange={(e) => setListName(e.target.value)} placeholder="Ny liste …"
                className="border border-gray-300 rounded-md px-3 py-2 text-sm flex-1" />
              <button onClick={createList} disabled={!listName.trim()}
                className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">Opprett</button>
            </div>
            <ul className="space-y-2">
              {lists.map((l) => (
                <li key={l.id} className="border border-gray-200 rounded-lg p-3 text-sm flex items-center justify-between">
                  <span className="font-medium">{l.name}</span>
                  <span className="text-gray-500 text-xs">{l.memberCount} kontakter</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-semibold mb-3">Ikke kontakt (suppression)</h2>
            <p className="text-sm text-gray-500 mb-3">
              E-poster her mottar ALDRI utsendelser — respekteres av alt som sendes fra plattformen.
            </p>
            <div className="flex gap-2 mb-3">
              <input type="email" value={suppressEmail} onChange={(e) => setSuppressEmail(e.target.value)} placeholder="epost@eksempel.no"
                className="border border-gray-300 rounded-md px-3 py-2 text-sm flex-1" />
              <button onClick={addSuppression} disabled={!suppressEmail.trim()}
                className="bg-gray-800 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">Legg til</button>
            </div>
            <ul className="space-y-1">
              {suppressions.map((s) => (
                <li key={s.id} className="flex items-center justify-between text-sm py-1 border-b border-gray-100">
                  <span>{s.email} <span className="text-gray-400 text-xs">({s.reason})</span></span>
                  <button onClick={() => removeSuppression(s.email)} className="text-gray-400 hover:text-red-600 text-xs">Fjern</button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Inline list creation in import wizard**

In `app/admin/crm/import/page.tsx`, next to the list dropdown (section 2), add a small button:

```tsx
              <button
                onClick={async () => {
                  const name = window.prompt('Navn på ny liste:');
                  if (!name?.trim()) return;
                  const res = await fetch('/api/admin/crm/lists', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name }),
                  });
                  if (res.ok) {
                    const data = await res.json();
                    setLists((prev) => [...prev, { id: data.list.id, name: data.list.name }]);
                    setListId(String(data.list.id));
                  }
                }}
                className="text-sm text-blue-700 hover:underline pb-2"
              >
                + Ny liste
              </button>
```

- [ ] **Step 4: Verify in dev + commit**

Open `/admin/crm/segmenter`. Expected: create segment «Julebord 2025» with rules `Deal: arrangementstype er julebord` + `Deal: dato før/mindre enn 2026-01-01` → it appears in the contacts list segment filter and matches backfilled julebord contacts. Lists and suppressions can be created and removed.

```bash
git add app/admin/crm/segmenter components/admin/CrmTabs.tsx app/admin/AdminShell.tsx app/admin/crm/import
git commit -m "feat(crm): segments, lists, suppressions UI" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 21: Finish — keyboard shortcut, prod migration SQL, full verification

**Files:**
- Modify: `components/admin/KeyboardShortcuts.tsx` (add CRM shortcut)
- Create: `scripts/crm-migration.sql` (prod schema change for Basefarm routine)

- [ ] **Step 1: Add keyboard shortcut**

In `components/admin/KeyboardShortcuts.tsx`, in the shortcuts array (after the `g b` entry, line ~11), add:

```typescript
  { keys: 'g c', label: 'CRM', path: '/admin/crm/kontakter' },
```

(Match the exact object shape used by the existing entries in that file.)

- [ ] **Step 2: Generate the production migration SQL**

The prod DB is behind Basefarm's firewall — schema changes ship as SQL (see `scripts/deploy-app.sh` notes). Diff the schema as it was before Task 1's commit against the current one:

Run:
```bash
# Finn commiten fra Task 1 ("feat(crm): add CRM data model") og bruk dens forelder
TASK1_SHA=$(git log --format='%H %s' | grep 'add CRM data model' | head -1 | cut -d' ' -f1)
git show "$TASK1_SHA^:prisma/schema.prisma" > /tmp/schema-old.prisma
pnpm prisma migrate diff --from-schema-datamodel /tmp/schema-old.prisma --to-schema-datamodel prisma/schema.prisma --script > scripts/crm-migration.sql
```

Then open `scripts/crm-migration.sql` and verify it contains ONLY `CREATE TABLE`/`CREATE INDEX`/`ALTER TABLE ... ADD` statements for the new CRM tables — NO drops or modifications of existing tables. If any appear, stop and investigate before committing.

- [ ] **Step 3: Full verification pass**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit && pnpm build`
Expected: all tests pass, no lint errors, no type errors, production build succeeds.

- [ ] **Step 4: End-to-end smoke test in dev**

1. Create a booking via the public flow (request-mode course) with a company email → contact + org + deal appear in CRM, timeline entry exists.
2. Drag the deal to "Bekreftet" in the kanban → deal status `won`, timeline gets `deal_change`.
3. Add note + task on the contact → both visible in timeline.
4. Toggle marketing consent on → consent saved with timestamp.
5. Import a 3-row CSV → contacts created, one duplicate updates instead.

- [ ] **Step 5: Commit + wrap up**

```bash
git add components/admin/KeyboardShortcuts.tsx scripts/crm-migration.sql
git commit -m "feat(crm): shortcut + prod migration SQL" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Deployment notes (for the deploy runbook, not automated):
- Apply `scripts/crm-migration.sql` via the Basefarm firewall-window routine BEFORE deploying the app build.
- Run `pnpm dlx tsx scripts/backfill-crm.ts` against prod (same firewall window) AFTER deploy so historical bookings/registrations populate the CRM.
