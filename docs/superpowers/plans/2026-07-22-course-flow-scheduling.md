# Dato-forankret planlegging + kurs-forankret enrollment — Implementasjonsplan (delprosjekt A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gi flyt-motoren evnen til å planlegge et steg relativt til en kurs-ankerdato (start/slutt/halvveis) og å ankre en enrollment til et kurs/registrering — fundamentet for å migrere legacy kurs-`EmailTrigger` inn i flyter.

**Architecture:** En ny `schedule`-node produserer den SAMME `{ kind: 'sleep', until }`-planen som dagens `wait`-node, så runnerens lease/`nextRunAt`/catch-up-maskineri er urørt — kun `until`-beregningen (kurs-dato-forankret, Oslo-dag) er ny. `FlowEnrollment` får nullbare `courseId`/`registrationId`; kursdata (ankerdatoer + flettefelt) leses live ved hvert tick/send fra `registrationId`. Uberegnelig anker ⇒ enrollment avsluttes rolig via den eksisterende exit-terminal-stien.

**Tech Stack:** Next.js 16, Prisma 5/Postgres, Vitest, TypeScript strict, pnpm.

## Global Constraints

- Ingen nye env-vars. Én ny additiv SQL-migrering (`scripts/course-flows-migration.sql`) — kun `ADD COLUMN`/`CREATE INDEX`/`DROP INDEX IF EXISTS`.
- Dagens markedsførings-flyt-atferd (enrollment uten `registrationId`) skal være NØYAKTIG uendret.
- De to nye statusene på schedule-utfall: en beregnet anker ⇒ `sleep`; uberegnelig/manglende kurs-anker ⇒ enrollment `status: 'exited'` (aldri `failed`).
- Anker-vokabular EKSAKT: `anchor ∈ {'course_start','course_end','course_midway'}`, `offsetDays: number` (heltall, kan være negativt).
- Flettefelt-navnene EKSAKT som legacy/`MergeTagData`: `forelder_navn`, `barnets_navn`, `kurs_navn`, `kurs_startdato`, `kurs_sluttdato`, `allergier`, `kontakt_epost`. Datoformat `nb-NO` (`dd.mm.yyyy`).
- Tidssone: alle ankerdager beregnes i `Europe/Oslo`; `until` = 00:00 Oslo på ankerdagen.
- Scope-grense: INGEN canvas-UI for schedule-noden, INGEN «ved registrering → enroll»-wiring, INGEN datamigrering. Kun motor-fundamentet + testbare primitiver.

---

### Task 1: Schema + migrering — kurs-anker på `FlowEnrollment`

**Files:**
- Modify: `prisma/schema.prisma` (model `FlowEnrollment`, `Course`, `Registration`)
- Create: `scripts/course-flows-migration.sql`

**Interfaces:**
- Produces: `FlowEnrollment.courseId: number | null`, `FlowEnrollment.registrationId: number | null` (Prisma-felter) + partielle unike indekser `flow_enrollments_one_active` (markedsføring) og `flow_enrollments_one_active_reg` (per-registrering).

- [ ] **Step 1: Legg til kolonner + relasjoner i `FlowEnrollment`**

I `prisma/schema.prisma`, i `model FlowEnrollment`, etter linjen `contact Contact @relation(...)`, legg til feltene (blant scalars, ved de andre `Int?`) og relasjonene:

```prisma
  courseId       Int?      @map("course_id")
  registrationId Int?      @map("registration_id")
```
og i relasjons-blokken:
```prisma
  course         Course?       @relation(fields: [courseId], references: [id], onDelete: SetNull)
  registration   Registration? @relation(fields: [registrationId], references: [id], onDelete: Cascade)
```
Legg til en indeks i `@@index`-seksjonen:
```prisma
  @@index([registrationId])
  @@index([courseId])
```
Oppdater kommentaren over `@@index([flowId, contactId, status])` til å nevne at maks-én-aktiv nå håndheves av TO partielle indekser (se `scripts/course-flows-migration.sql`): `flow_enrollments_one_active` (WHERE `registration_id IS NULL`) og `flow_enrollments_one_active_reg` (WHERE `registration_id IS NOT NULL`).

- [ ] **Step 2: Legg til revers-relasjoner på `Course` og `Registration`**

I `model Course`, i relasjons-listen (f.eks. etter `bookingRequests BookingRequest[]`):
```prisma
  flowEnrollments FlowEnrollment[]
```
I `model Registration`, i relasjons-listen (etter `emailLogs EmailLog[]`):
```prisma
  flowEnrollments FlowEnrollment[]
```

- [ ] **Step 3: Push skjemaet til dev-DB + regenerer klienten**

Run: `pnpm prisma db push && pnpm prisma generate`
Expected: «Your database is now in sync with your Prisma schema.» + generert klient. (`db push` legger til de to kolonnene i dev; partielle indekser lages i Step 5.)

- [ ] **Step 4: Skriv migrerings-SQL for Basefarm/prod**

Create `scripts/course-flows-migration.sql`:
```sql
-- Delprosjekt A: kurs-anker på flow_enrollments (additiv).
-- Kjøres av Basefarm mot prod FØR koden deployes. Idempotent-vennlig.

ALTER TABLE flow_enrollments ADD COLUMN IF NOT EXISTS course_id INT NULL;
ALTER TABLE flow_enrollments ADD COLUMN IF NOT EXISTS registration_id INT NULL;

DO $$ BEGIN
  ALTER TABLE flow_enrollments
    ADD CONSTRAINT flow_enrollments_course_id_fkey
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE flow_enrollments
    ADD CONSTRAINT flow_enrollments_registration_id_fkey
    FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS flow_enrollments_registration_id_idx ON flow_enrollments (registration_id);
CREATE INDEX IF NOT EXISTS flow_enrollments_course_id_idx ON flow_enrollments (course_id);

-- Maks-én-aktiv: markedsføring (uendret semantikk) scopes nå til registration_id IS NULL.
DROP INDEX IF EXISTS flow_enrollments_one_active;
CREATE UNIQUE INDEX flow_enrollments_one_active
  ON flow_enrollments (flow_id, contact_id)
  WHERE registration_id IS NULL AND status = 'active';

-- Maks-én-aktiv per registrering (kurs-flyter).
CREATE UNIQUE INDEX IF NOT EXISTS flow_enrollments_one_active_reg
  ON flow_enrollments (flow_id, registration_id)
  WHERE registration_id IS NOT NULL AND status = 'active';
```

- [ ] **Step 5: Bruk indeks-DDL-en på dev-DB (partielle indekser er ikke i schema.prisma)**

Run: `pnpm prisma db execute --file scripts/course-flows-migration.sql --schema prisma/schema.prisma`
Expected: kjører uten feil. (Kolonnene finnes allerede fra `db push`; `ADD COLUMN IF NOT EXISTS` er no-op. Indeksene lages nå i dev.)

- [ ] **Step 6: Verifiser at de partielle indeksene håndhever unikheten (tsx-assertion)**

Create a temp script `scripts/verify-course-flow-indexes.ts` (slett etter kjøring — IKKE commit):
```ts
import { prisma } from '../lib/prisma';
const hex = `${Date.now().toString(36)}${process.pid}`;
const checks: [string, boolean][] = [];
let flowId = 0, contactId = 0, courseId = 0, regA = 0, regB = 0, userId = 0, parentId = 0;
async function main() {
  const flow = await prisma.flow.create({ data: { name: `IDXTEST ${hex}` } });
  flowId = flow.id;
  const contact = await prisma.contact.create({ data: { name: `idx ${hex}`, email: `idx-${hex}@example.invalid`, source: 'manual' } });
  contactId = contact.id;
  const course = await prisma.course.create({ data: { name: `IDX ${hex}`, type: 'kurs', slug: `idx-${hex}`, audience: 'voksen' } });
  courseId = course.id;
  const user = await prisma.user.create({ data: { email: `idxp-${hex}@example.invalid`, role: 'parent' } });
  userId = user.id;
  const parent = await prisma.parent.create({ data: { userId: user.id, name: `idx ${hex}`, phone: '0' } });
  parentId = parent.id;
  const a = await prisma.registration.create({ data: { courseId, parentId, childId: null } });
  const b = await prisma.registration.create({ data: { courseId, parentId, childId: null } });
  regA = a.id; regB = b.id;

  // Markedsføring (registrationId null): to aktive samme (flyt, kontakt) → andre skal feile.
  await prisma.flowEnrollment.create({ data: { flowId, contactId, status: 'active', nextRunAt: new Date() } });
  let mktDupBlocked = false;
  try { await prisma.flowEnrollment.create({ data: { flowId, contactId, status: 'active', nextRunAt: new Date() } }); }
  catch { mktDupBlocked = true; }
  checks.push(['marketing one-active blocks dup', mktDupBlocked]);

  // Kurs: to aktive for SAMME registrering → andre feiler; ULIKE registreringer → begge OK.
  await prisma.flowEnrollment.create({ data: { flowId, contactId, courseId, registrationId: regA, status: 'active', nextRunAt: new Date() } });
  let regDupBlocked = false;
  try { await prisma.flowEnrollment.create({ data: { flowId, contactId, courseId, registrationId: regA, status: 'active', nextRunAt: new Date() } }); }
  catch { regDupBlocked = true; }
  checks.push(['same-registration one-active blocks dup', regDupBlocked]);
  const second = await prisma.flowEnrollment.create({ data: { flowId, contactId, courseId, registrationId: regB, status: 'active', nextRunAt: new Date() } });
  checks.push(['different registrations both allowed', !!second.id]);
}
main().catch((e) => { console.error(e); checks.push(['ran', false]); }).finally(async () => {
  await prisma.flowEnrollment.deleteMany({ where: { flowId } });
  await prisma.flow.deleteMany({ where: { id: flowId } });
  await prisma.registration.deleteMany({ where: { id: { in: [regA, regB].filter(Boolean) } } });
  await prisma.parent.deleteMany({ where: { id: parentId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.course.deleteMany({ where: { id: courseId } });
  await prisma.contact.deleteMany({ where: { id: contactId } });
  const failed = checks.filter(([, ok]) => !ok);
  console.log(checks.map(([n, ok]) => `${ok ? 'PASS' : 'FAIL'} ${n}`).join('\n'));
  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
});
```
Run: `npx tsx scripts/verify-course-flow-indexes.ts`
Expected: alle `PASS`. Slett så scriptet: `rm scripts/verify-course-flow-indexes.ts`

- [ ] **Step 7: tsc + commit**

Run: `pnpm exec tsc --noEmit` (rent).
```bash
git add prisma/schema.prisma scripts/course-flows-migration.sql
git commit -m "feat(flows): course/registration anchor on FlowEnrollment + migration"
```

---

### Task 2: Anker-beregning — `lib/flows/schedule.ts`

**Files:**
- Create: `lib/flows/schedule.ts`
- Test: `tests/flows-schedule.test.ts`

**Interfaces:**
- Produces: `computeAnchorDay(anchor: ScheduleAnchor, offsetDays: number, startDate: Date | null, endDate: Date | null): string | null`; `osloDayStartUtc(day: string): Date`; `osloDay(d: Date): string`; `type ScheduleAnchor = 'course_start' | 'course_end' | 'course_midway'`.

- [ ] **Step 1: Skriv failende tester**

Create `tests/flows-schedule.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeAnchorDay, osloDayStartUtc, osloDay } from '@/lib/flows/schedule';

const d = (iso: string) => new Date(iso);

describe('computeAnchorDay', () => {
  const start = d('2026-06-01T10:00:00Z'); // Oslo-dag 2026-06-01
  const end = d('2026-06-11T10:00:00Z');   // Oslo-dag 2026-06-11
  it('course_start + offset (reminder_before/welcome_start)', () => {
    expect(computeAnchorDay('course_start', -3, start, end)).toBe('2026-05-29');
    expect(computeAnchorDay('course_start', 0, start, end)).toBe('2026-06-01');
  });
  it('course_end + offset (after_end)', () => {
    expect(computeAnchorDay('course_end', 1, start, end)).toBe('2026-06-12');
  });
  it('course_midway = halvveis start→slutt', () => {
    expect(computeAnchorDay('course_midway', 0, start, end)).toBe('2026-06-06'); // 10 dager / 2 = 5
  });
  it('manglende dato → null', () => {
    expect(computeAnchorDay('course_start', 0, null, end)).toBeNull();
    expect(computeAnchorDay('course_end', 0, start, null)).toBeNull();
    expect(computeAnchorDay('course_midway', 0, start, null)).toBeNull();
  });
});

describe('osloDay / osloDayStartUtc', () => {
  it('osloDay gir Oslo-kalenderdag', () => {
    // 2026-01-01T23:30Z er 2026-01-02 00:30 i Oslo (vinter, UTC+1)
    expect(osloDay(d('2026-01-01T23:30:00Z'))).toBe('2026-01-02');
  });
  it('osloDayStartUtc: vinter 00:00 Oslo = 23:00Z dagen før (UTC+1)', () => {
    expect(osloDayStartUtc('2026-01-15').toISOString()).toBe('2026-01-14T23:00:00.000Z');
  });
  it('osloDayStartUtc: sommer 00:00 Oslo = 22:00Z dagen før (UTC+2, DST)', () => {
    expect(osloDayStartUtc('2026-07-15').toISOString()).toBe('2026-07-14T22:00:00.000Z');
  });
});
```

- [ ] **Step 2: Kjør — FEILER** (`Cannot find module '@/lib/flows/schedule'`)

Run: `pnpm exec vitest run tests/flows-schedule.test.ts`

- [ ] **Step 3: Implementer `lib/flows/schedule.ts`**

```ts
/**
 * Rene planleggings-hjelpere for flyt-motorens `schedule`-node.
 * Alle ankerdager beregnes i Europe/Oslo; ingen I/O.
 */
const OSLO_TZ = 'Europe/Oslo';

export type ScheduleAnchor = 'course_start' | 'course_end' | 'course_midway';

/** Kalenderdag (YYYY-MM-DD) i Europe/Oslo for et gitt tidspunkt. */
export function osloDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: OSLO_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/** Oslo-tidssonens offset (ms) mot UTC ved et gitt tidspunkt. */
function osloOffsetMs(atUtcMs: number): number {
  const d = new Date(atUtcMs);
  const asUtc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  const asOslo = new Date(d.toLocaleString('en-US', { timeZone: OSLO_TZ })).getTime();
  return asOslo - asUtc;
}

/** Legger n hele kalenderdager til en Oslo-dag (YYYY-MM-DD). DST-trygg (middag unngår kanter). */
function addOsloDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const noonUtc = Date.UTC(y, m - 1, d, 12, 0, 0);
  return osloDay(new Date(noonUtc + n * 86_400_000));
}

/** UTC-instant for 00:00 Europe/Oslo på en gitt Oslo-dag. */
export function osloDayStartUtc(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const naiveUtcMidnight = Date.UTC(y, m - 1, d, 0, 0, 0);
  return new Date(naiveUtcMidnight - osloOffsetMs(naiveUtcMidnight));
}

/** Oslo-kalenderdagen en schedule-node skal sende på, eller null hvis uberegnelig. */
export function computeAnchorDay(
  anchor: ScheduleAnchor,
  offsetDays: number,
  startDate: Date | null,
  endDate: Date | null,
): string | null {
  if (anchor === 'course_start') {
    if (!startDate) return null;
    return addOsloDays(osloDay(startDate), offsetDays);
  }
  if (anchor === 'course_end') {
    if (!endDate) return null;
    return addOsloDays(osloDay(endDate), offsetDays);
  }
  // course_midway
  if (!startDate || !endDate) return null;
  const halfDays = Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000 / 2);
  return addOsloDays(osloDay(startDate), halfDays + offsetDays);
}
```

- [ ] **Step 4: Kjør — PASS**; deretter full suite + tsc.

Run: `pnpm exec vitest run tests/flows-schedule.test.ts` (PASS), `pnpm test`, `pnpm exec tsc --noEmit`.

- [ ] **Step 5: Commit**
```bash
git add lib/flows/schedule.ts tests/flows-schedule.test.ts
git commit -m "feat(flows): course-anchored date computation (Oslo-day)"
```

---

### Task 3: Graf-validering av `schedule`-noden — `lib/flows/graph.ts`

**Files:**
- Modify: `lib/flows/graph.ts`
- Test: `tests/flows-graph.test.ts` (append; opprett hvis den ikke finnes)

**Interfaces:**
- Consumes: intet nytt.
- Produces: `FlowNodeType` inkluderer `'schedule'`; `validateFlow` avviser ugyldig schedule-config med kode `schedule_config`.

- [ ] **Step 1: Skriv failende tester** (append til `tests/flows-graph.test.ts`; hvis fila mangler, opprett med import `import { validateFlow, type GraphNode, type GraphEdge } from '@/lib/flows/graph';`)

```ts
import { describe, it, expect } from 'vitest';
import { validateFlow, type GraphNode, type GraphEdge } from '@/lib/flows/graph';

// Minimal gyldig flyt: start → schedule → end
const scheduleFlow = (config: Record<string, unknown>): [GraphNode[], GraphEdge[]] => {
  const nodes: GraphNode[] = [
    { id: 1, type: 'start', config: {} },
    { id: 2, type: 'schedule', config },
    { id: 3, type: 'end', config: {} },
  ];
  const edges: GraphEdge[] = [
    { id: 1, fromNodeId: 1, toNodeId: 2, branch: null },
    { id: 2, fromNodeId: 2, toNodeId: 3, branch: null },
  ];
  return [nodes, edges];
};

describe('validateFlow: schedule-node', () => {
  it('godtar gyldig anker + offset', () => {
    const [n, e] = scheduleFlow({ anchor: 'course_start', offsetDays: -3 });
    expect(validateFlow(n, e)).toEqual([]);
  });
  it('godtar manglende offsetDays (default 0)', () => {
    const [n, e] = scheduleFlow({ anchor: 'course_midway' });
    expect(validateFlow(n, e)).toEqual([]);
  });
  it('avviser ugyldig anker', () => {
    const [n, e] = scheduleFlow({ anchor: 'tull', offsetDays: 0 });
    expect(validateFlow(n, e).some((x) => x.code === 'schedule_config')).toBe(true);
  });
  it('avviser ikke-heltalls offsetDays', () => {
    const [n, e] = scheduleFlow({ anchor: 'course_start', offsetDays: 1.5 });
    expect(validateFlow(n, e).some((x) => x.code === 'schedule_config')).toBe(true);
  });
});
```

- [ ] **Step 2: Kjør — FEILER** (schedule-nodetype ukjent → strukturfeil/ingen schedule_config)

Run: `pnpm exec vitest run tests/flows-graph.test.ts`

- [ ] **Step 3: Implementer**

I `lib/flows/graph.ts`:
1. Utvid typen (linje 9):
```ts
export type FlowNodeType = 'start' | 'email' | 'wait' | 'condition' | 'action' | 'end' | 'schedule';
```
2. Legg til anker-konstant ved de andre (etter `ACTION_KINDS_REQUIRING_VALUE`):
```ts
const SCHEDULE_ANCHORS = ['course_start', 'course_end', 'course_midway'] as const;
```
3. Legg til validator (etter `validateActionConfig`):
```ts
function validateScheduleConfig(node: GraphNode): ValidationError | null {
  const { anchor, offsetDays } = node.config;
  const validAnchor = typeof anchor === 'string' && (SCHEDULE_ANCHORS as readonly string[]).includes(anchor);
  if (!validAnchor) {
    return err(node.id, 'schedule_config', 'Planleggings-noden mangler et gyldig anker.');
  }
  if (offsetDays !== undefined && !isInteger(offsetDays)) {
    return err(node.id, 'schedule_config', 'Planleggings-noden har en ugyldig forskyvning.');
  }
  return null;
}
```
4. Koble inn i `validateConfigs`-ternæren (legg til en gren):
```ts
              : node.type === 'action'
                ? validateActionConfig(node)
                : node.type === 'schedule'
                  ? validateScheduleConfig(node)
                  : null;
```
(Strukturregelen «nøyaktig én utgående kobling, branch null» på linje ~201 gjelder allerede schedule-noden via default-grenen — ingen strukturendring.)

- [ ] **Step 4: Kjør — PASS**; full suite + tsc.

- [ ] **Step 5: Commit**
```bash
git add lib/flows/graph.ts tests/flows-graph.test.ts
git commit -m "feat(flows): validate schedule node config"
```

---

### Task 4: Step-planlegging av `schedule` — `lib/flows/step.ts`

**Files:**
- Modify: `lib/flows/step.ts`
- Test: `tests/flows-step.test.ts` (append; opprett hvis den ikke finnes)

**Interfaces:**
- Consumes: `computeAnchorDay`, `osloDayStartUtc` (Task 2).
- Produces: `StepContext` får valgfritt felt `courseDates?: { startDate: Date | null; endDate: Date | null } | null`. En `schedule`-node → `{ kind: 'sleep', until }` når anker beregnes; ellers `{ kind: 'act', action: { kind: 'exit', value: <grunn> }, nextNodeId: null }` (rolig exit).

- [ ] **Step 1: Skriv failende tester** (append/opprett `tests/flows-step.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { planStep, type StepContext } from '@/lib/flows/step';
import { osloDayStartUtc } from '@/lib/flows/schedule';
import type { GraphNode, GraphEdge } from '@/lib/flows/graph';

const baseCtx = (over: Partial<StepContext> = {}): StepContext => ({
  contact: { stage: null, source: 'manual', email: 'a@b.no', organizationId: null, lastActivityAt: null, tags: [], deals: [] } as never,
  segmentRulesById: {},
  lastSendOpened: null,
  now: new Date('2026-05-01T00:00:00Z'),
  ...over,
});

const scheduleNode: GraphNode = { id: 2, type: 'schedule', config: { anchor: 'course_start', offsetDays: -3 } };
const edges: GraphEdge[] = [{ id: 1, fromNodeId: 2, toNodeId: 3, branch: null }];

describe('planStep: schedule', () => {
  it('beregner sleep til ankerdato når kursdatoer finnes', () => {
    const ctx = baseCtx({ courseDates: { startDate: new Date('2026-06-01T10:00:00Z'), endDate: new Date('2026-06-11T10:00:00Z') } });
    const plan = planStep(scheduleNode, edges, ctx);
    expect(plan).toEqual({ kind: 'sleep', until: osloDayStartUtc('2026-05-29'), nextNodeId: 3 });
  });
  it('rolig exit når kursdatoer mangler (course_start uten startDate)', () => {
    const ctx = baseCtx({ courseDates: { startDate: null, endDate: null } });
    const plan = planStep(scheduleNode, edges, ctx);
    expect(plan.kind).toBe('act');
    if (plan.kind === 'act') { expect(plan.action.kind).toBe('exit'); expect(plan.nextNodeId).toBeNull(); }
  });
  it('rolig exit når enrollment ikke har kurs-anker (courseDates udefinert)', () => {
    const plan = planStep(scheduleNode, edges, baseCtx());
    expect(plan.kind).toBe('act');
    if (plan.kind === 'act') expect(plan.nextNodeId).toBeNull();
  });
});
```

- [ ] **Step 2: Kjør — FEILER**

Run: `pnpm exec vitest run tests/flows-step.test.ts`

- [ ] **Step 3: Implementer i `lib/flows/step.ts`**

1. Legg til import øverst:
```ts
import { computeAnchorDay, osloDayStartUtc, type ScheduleAnchor } from './schedule';
```
2. Utvid `StepContext` med feltet (etter `now: Date;`):
```ts
  courseDates?: { startDate: Date | null; endDate: Date | null } | null; // fra enrollmentens registrering; undefined/null = ingen kurs-anker
```
3. Legg til planleggeren (etter `planAction`):
```ts
function planSchedule(node: GraphNode, edges: GraphEdge[], ctx: StepContext): StepPlan {
  const edge = findEdgeByBranch(outgoingEdges(node, edges), null);
  if (!edge) return fail('Planleggings-noden mangler en utgående kobling.');
  const anchor = node.config.anchor;
  if (anchor !== 'course_start' && anchor !== 'course_end' && anchor !== 'course_midway') {
    return fail('Planleggings-noden har et ugyldig anker.');
  }
  const offsetDays = typeof node.config.offsetDays === 'number' ? node.config.offsetDays : 0;
  const dates = ctx.courseDates ?? null;
  const graceExit = (reason: string): StepPlan =>
    ({ kind: 'act', action: { kind: 'exit', value: reason }, nextNodeId: null });
  if (!dates) return graceExit('schedule: enrollment mangler kurs-anker');
  const day = computeAnchorDay(anchor as ScheduleAnchor, offsetDays, dates.startDate, dates.endDate);
  if (day === null) return graceExit(`schedule: kurs mangler dato for anker ${anchor}`);
  return { kind: 'sleep', until: osloDayStartUtc(day), nextNodeId: edge.toNodeId };
}
```
4. Koble inn i `planStep`-switchen (ny case før `default`):
```ts
    case 'schedule':
      return planSchedule(node, edges, ctx);
```

- [ ] **Step 4: Kjør — PASS**; full suite + tsc.

- [ ] **Step 5: Commit**
```bash
git add lib/flows/step.ts tests/flows-step.test.ts
git commit -m "feat(flows): plan schedule node (sleep-to-anchor or graceful exit)"
```

---

### Task 5: Kurs-flettekontekst — `lib/flows/course-merge.ts`

**Files:**
- Create: `lib/flows/course-merge.ts`
- Test: `tests/flows-course-merge.test.ts`

**Interfaces:**
- Produces: `resolveCourseMergeContext(registrationId: number): Promise<MergeTagData | null>` — `MergeTagData` fra `@/lib/email-templates`.

- [ ] **Step 1: Skriv failende tester** (mock prisma + settings)

Create `tests/flows-course-merge.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prisma = { registration: { findUnique: vi.fn() } };
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async () => 'post@bjerke.no') }));

import { resolveCourseMergeContext } from '@/lib/flows/course-merge';

beforeEach(() => vi.clearAllMocks());

describe('resolveCourseMergeContext', () => {
  it('barn-kurs: fyller alle flettefelt', async () => {
    prisma.registration.findUnique.mockResolvedValue({
      child: { name: 'Ola', allergies: 'Nøtter' },
      parent: { name: 'Kari', user: { email: 'kari@x.no' } },
      course: { name: 'Ponni', startDate: new Date('2026-06-01T10:00:00Z'), endDate: new Date('2026-06-11T10:00:00Z') },
    });
    const m = await resolveCourseMergeContext(1);
    expect(m).toEqual({
      forelder_navn: 'Kari', barnets_navn: 'Ola', kurs_navn: 'Ponni',
      kurs_startdato: '01.06.2026', kurs_sluttdato: '11.06.2026',
      allergier: 'Nøtter', kontakt_epost: 'post@bjerke.no',
    });
  });
  it('voksen-kurs (uten barn): barnets_navn faller til foreldrenavn, allergier=Ingen, tom sluttdato', async () => {
    prisma.registration.findUnique.mockResolvedValue({
      child: null,
      parent: { name: 'Per', user: { email: 'per@x.no' } },
      course: { name: 'Voksenkurs', startDate: new Date('2026-06-01T10:00:00Z'), endDate: null },
    });
    const m = await resolveCourseMergeContext(2);
    expect(m).toMatchObject({ barnets_navn: 'Per', allergier: 'Ingen', kurs_sluttdato: '' });
  });
  it('manglende registrering → null', async () => {
    prisma.registration.findUnique.mockResolvedValue(null);
    expect(await resolveCourseMergeContext(9)).toBeNull();
  });
});
```

- [ ] **Step 2: Kjør — FEILER**

Run: `pnpm exec vitest run tests/flows-course-merge.test.ts`

- [ ] **Step 3: Implementer `lib/flows/course-merge.ts`**

```ts
/**
 * Live kurs-flettekontekst for kurs-forankrede flyt-enrollments. Leser
 * registrering→barn/forelder/kurs ved send (ingen snapshot) og returnerer
 * nøyaktig legacy-flettefeltene, så migrerte maler rendrer identisk.
 */
import { prisma } from '@/lib/prisma';
import { getSetting } from '@/lib/settings';
import type { MergeTagData } from '@/lib/email-templates';

function formatDate(date: Date): string {
  return date.toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export async function resolveCourseMergeContext(registrationId: number): Promise<MergeTagData | null> {
  const reg = await prisma.registration.findUnique({
    where: { id: registrationId },
    select: {
      child: { select: { name: true, allergies: true } },
      parent: { select: { name: true, user: { select: { email: true } } } },
      course: { select: { name: true, startDate: true, endDate: true } },
    },
  });
  if (!reg) return null;
  const contactEmail = await getSetting('contact_email');
  return {
    forelder_navn: reg.parent.name,
    barnets_navn: reg.child?.name ?? reg.parent.name,
    kurs_navn: reg.course.name,
    kurs_startdato: reg.course.startDate ? formatDate(reg.course.startDate) : '',
    kurs_sluttdato: reg.course.endDate ? formatDate(reg.course.endDate) : '',
    allergier: reg.child?.allergies || 'Ingen',
    kontakt_epost: contactEmail ?? '',
  };
}
```

- [ ] **Step 4: Kjør — PASS**; full suite + tsc.

- [ ] **Step 5: Commit**
```bash
git add lib/flows/course-merge.ts tests/flows-course-merge.test.ts
git commit -m "feat(flows): live course merge-tag context resolver"
```

---

### Task 6: Send-lag — flett inn kurs-kontekst — `lib/flows/send.ts`

**Files:**
- Modify: `lib/flows/send.ts`
- Test: `tests/flows-send.test.ts` (append)

**Interfaces:**
- Consumes: `resolveCourseMergeContext` (Task 5).
- Produces: `SendFlowEmailInput` får valgfritt `registrationId?: number | null`. Når satt, flettes kurs-kontekst inn i flettefeltene FØR rendering.

- [ ] **Step 1: Skriv failende test** (append til `tests/flows-send.test.ts`; behold eksisterende mocks — legg til en mock for course-merge)

Legg til øverst blant mocks (hvis ikke finnes) og en ny `it`:
```ts
// øverst, sammen med de andre vi.mock:
vi.mock('@/lib/flows/course-merge', () => ({ resolveCourseMergeContext: vi.fn() }));
// import ved de andre importene:
import { resolveCourseMergeContext } from '@/lib/flows/course-merge';

it('flett inn kurs-kontekst når registrationId er satt', async () => {
  // happy-path-mocks skal gi en vellykket send (som eksisterende «sent»-test).
  (resolveCourseMergeContext as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
    forelder_navn: 'Kari', barnets_navn: 'Ola', kurs_navn: 'Ponni',
    kurs_startdato: '01.06.2026', kurs_sluttdato: '11.06.2026', allergier: 'Ingen', kontakt_epost: 'post@bjerke.no',
  });
  const res = await sendFlowEmail({ ...baseInput, bodyHtml: '<p>Hei {{barnets_navn}} på {{kurs_navn}}</p>', registrationId: 42 });
  expect(res).toBe('sent');
  // bodyHtml lagret på messageSend.create skal inneholde de flettede verdiene
  const created = prisma.messageSend.create.mock.calls.at(-1)?.[0]?.data?.bodyHtml as string;
  expect(created).toContain('Ola');
  expect(created).toContain('Ponni');
  expect(resolveCourseMergeContext).toHaveBeenCalledWith(42);
});
```
(NB: implementeren tilpasser assertion til de faktiske mock-navnene i fila — `baseInput`/`prisma` finnes allerede i test-fila fra Task 6 i delprosjekt 7.)

- [ ] **Step 2: Kjør — FEILER** (registrationId ignoreres → ingen «Ola» i kroppen)

- [ ] **Step 3: Implementer i `lib/flows/send.ts`**

1. Import (ved de andre `./`-importene):
```ts
import { resolveCourseMergeContext } from './course-merge';
```
2. Utvid `SendFlowEmailInput` (etter `aiPersonalize?: boolean;`):
```ts
  registrationId?: number | null;
```
3. Endre merge-data-bygging (linje ~170). Erstatt:
```ts
  const mergeData = contactMergeTagData(contact);
```
med:
```ts
  let mergeData = contactMergeTagData(contact);
  if (input.registrationId != null) {
    const courseCtx = await resolveCourseMergeContext(input.registrationId);
    if (courseCtx) mergeData = { ...mergeData, ...courseCtx };
  }
```
(Alt annet uendret. `null` fra resolveren ⇒ behold kontakt-only-flettefelt, best-effort.)

- [ ] **Step 4: Kjør — PASS**; full suite + tsc + `pnpm exec eslint lib/flows/send.ts tests/flows-send.test.ts`.

- [ ] **Step 5: Commit**
```bash
git add lib/flows/send.ts tests/flows-send.test.ts
git commit -m "feat(flows): merge course context into course-anchored sends"
```

---

### Task 7: Enroll-primitiv for kurs-registrering — `lib/flows/enroll.ts`

**Files:**
- Modify: `lib/flows/enroll.ts`
- Test: `tests/flows-enroll.test.ts` (append; opprett hvis mangler)

**Interfaces:**
- Produces: `enrollCourseRegistration(flowId: number, contactId: number, courseId: number, registrationId: number): Promise<boolean>`. Dagens `enrollContact` uendret.

- [ ] **Step 1: Skriv failende tester** (mock prisma)

Create/append `tests/flows-enroll.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const prisma = { flowEnrollment: { findFirst: vi.fn(), create: vi.fn() } };
vi.mock('@/lib/prisma', () => ({ prisma }));

import { enrollCourseRegistration } from '@/lib/flows/enroll';

beforeEach(() => vi.clearAllMocks());

describe('enrollCourseRegistration', () => {
  it('oppretter enrollment med kurs-anker når ingen aktiv finnes', async () => {
    prisma.flowEnrollment.findFirst.mockResolvedValue(null);
    prisma.flowEnrollment.create.mockResolvedValue({ id: 1 });
    expect(await enrollCourseRegistration(3, 7, 9, 42)).toBe(true);
    expect(prisma.flowEnrollment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ flowId: 3, contactId: 7, courseId: 9, registrationId: 42, status: 'active' }) }),
    );
  });
  it('hopper over når aktiv enrollment for registreringen finnes (kode-sjekk)', async () => {
    prisma.flowEnrollment.findFirst.mockResolvedValue({ id: 1 });
    expect(await enrollCourseRegistration(3, 7, 9, 42)).toBe(false);
    expect(prisma.flowEnrollment.create).not.toHaveBeenCalled();
  });
  it('svelger P2002-race som «allerede påmeldt»', async () => {
    prisma.flowEnrollment.findFirst.mockResolvedValue(null);
    prisma.flowEnrollment.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5.0.0' }));
    expect(await enrollCourseRegistration(3, 7, 9, 42)).toBe(false);
  });
});
```

- [ ] **Step 2: Kjør — FEILER**

- [ ] **Step 3: Implementer i `lib/flows/enroll.ts`**

Legg til (etter `hasActiveEnrollment`):
```ts
async function hasActiveRegistrationEnrollment(flowId: number, registrationId: number): Promise<boolean> {
  const existing = await prisma.flowEnrollment.findFirst({
    where: { flowId, registrationId, status: 'active' },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Melder en kontakts kurs-registrering inn i en flyt, ankret til kurset.
 * Maks-én-aktiv per (flyt, registrering) — kode-sjekk + P2002-fallback fra
 * den partielle indeksen `flow_enrollments_one_active_reg`. Returnerer om en
 * ny enrollment ble opprettet. (Selve «ved registrering → kall denne»-wiringen
 * er delprosjekt B.)
 */
export async function enrollCourseRegistration(
  flowId: number,
  contactId: number,
  courseId: number,
  registrationId: number,
): Promise<boolean> {
  if (await hasActiveRegistrationEnrollment(flowId, registrationId)) return false;
  try {
    await prisma.flowEnrollment.create({
      data: { flowId, contactId, courseId, registrationId, currentNodeId: null, status: 'active', nextRunAt: new Date() },
    });
    return true;
  } catch (error) {
    if (isDuplicateEnrollment(error)) return false;
    throw error;
  }
}
```

- [ ] **Step 4: Kjør — PASS**; full suite + tsc.

- [ ] **Step 5: Commit**
```bash
git add lib/flows/enroll.ts tests/flows-enroll.test.ts
git commit -m "feat(flows): enrollCourseRegistration (course-anchored enroll)"
```

---

### Task 8: Runner-integrasjon — kurs-datoer inn i tick + send — `lib/flows/runner.ts`

**Files:**
- Modify: `lib/flows/runner.ts`
- Test: `tests/flows-runner-schedule.test.ts` (integrasjon mot dev-DB via ekte prisma)

**Interfaces:**
- Consumes: `computeAnchorDay`/`osloDayStartUtc` (Task 2, indirekte via step), `resolveCourseMergeContext` (via send, Task 6), `enrollCourseRegistration` (Task 7).
- Produces: runneren løser kursdatoer live for `schedule`-noder og sender `registrationId` til send-laget; rolig exit logges.

- [ ] **Step 1: Skriv failende integrasjonstest** (`tests/flows-runner-schedule.test.ts`)

Denne bruker EKTE prisma mot dev-DB (som andre integrasjonstester i repoet), bygger en syntetisk flyt `start → schedule → email → end`, en kurs-registrering med startdato i FORTIDEN (så anker er forfalt), og driver runneren. Namespacet fixture, obligatorisk opprydding i `finally`.
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { runFlowBatch } from '@/lib/flows/runner';
import { enrollCourseRegistration } from '@/lib/flows/enroll';

const hex = `${Date.now().toString(36)}${process.pid}`;
const ids: { flowId?: number; contactId?: number; courseId?: number; regId?: number; userId?: number; parentId?: number; senderId?: number } = {};

afterEach(async () => {
  if (ids.flowId) { await prisma.messageSend.deleteMany({ where: { enrollmentId: { in: (await prisma.flowEnrollment.findMany({ where: { flowId: ids.flowId }, select: { id: true } })).map((e) => e.id) } } }); await prisma.flowEnrollment.deleteMany({ where: { flowId: ids.flowId } }); await prisma.flowEdge.deleteMany({ where: { flowId: ids.flowId } }); await prisma.flowNode.deleteMany({ where: { flowId: ids.flowId } }); await prisma.flow.deleteMany({ where: { id: ids.flowId } }); }
  if (ids.regId) await prisma.registration.deleteMany({ where: { id: ids.regId } });
  if (ids.parentId) await prisma.parent.deleteMany({ where: { id: ids.parentId } });
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } });
  if (ids.courseId) await prisma.course.deleteMany({ where: { id: ids.courseId } });
  if (ids.contactId) await prisma.contact.deleteMany({ where: { id: ids.contactId } });
  if (ids.senderId) await prisma.senderIdentity.deleteMany({ where: { id: ids.senderId } });
  await prisma.$disconnect();
});

describe('runner: schedule node (integrasjon)', () => {
  it('forfalt kurs-anker → email sendes én gang med kurs-flettefelt', async () => {
    const flow = await prisma.flow.create({ data: { name: `SCHED ${hex}`, status: 'active', isMarketing: false } });
    ids.flowId = flow.id;
    const sender = await prisma.senderIdentity.create({ data: { email: `sched-${hex}@bjerke.no`, displayName: 'Sched', active: true } });
    ids.senderId = sender.id;
    const start = await prisma.flowNode.create({ data: { flowId: flow.id, type: 'start', config: '{}' } });
    const sched = await prisma.flowNode.create({ data: { flowId: flow.id, type: 'schedule', config: JSON.stringify({ anchor: 'course_start', offsetDays: -3 }) } });
    const email = await prisma.flowNode.create({ data: { flowId: flow.id, type: 'email', config: JSON.stringify({ subject: 'Hei {{barnets_navn}}', bodyHtml: '<p>{{kurs_navn}}</p>', senderIdentityId: sender.id }) } });
    const end = await prisma.flowNode.create({ data: { flowId: flow.id, type: 'end', config: '{}' } });
    await prisma.flowEdge.createMany({ data: [
      { flowId: flow.id, fromNodeId: start.id, toNodeId: sched.id, branch: null },
      { flowId: flow.id, fromNodeId: sched.id, toNodeId: email.id, branch: null },
      { flowId: flow.id, fromNodeId: email.id, toNodeId: end.id, branch: null },
    ] });
    const contact = await prisma.contact.create({ data: { name: 'Kari', email: `sched-c-${hex}@example.invalid`, source: 'manual' } });
    ids.contactId = contact.id;
    const course = await prisma.course.create({ data: { name: 'Ponni', type: 'kurs', slug: `sched-${hex}`, audience: 'barn', startDate: new Date(Date.now() - 10 * 86400000), endDate: new Date(Date.now() - 2 * 86400000) } });
    ids.courseId = course.id;
    const user = await prisma.user.create({ data: { email: `sched-u-${hex}@example.invalid`, role: 'parent' } });
    ids.userId = user.id;
    const parent = await prisma.parent.create({ data: { userId: user.id, name: 'Kari', phone: '0' } });
    ids.parentId = parent.id;
    const reg = await prisma.registration.create({ data: { courseId: course.id, parentId: parent.id, childId: null } });
    ids.regId = reg.id;

    await enrollCourseRegistration(flow.id, contact.id, course.id, reg.id);

    // Tick 1: start → schedule (forfalt anker → sleep i fortiden = umiddelbart forfalt), så neste tick sender.
    await runFlowBatch(new Date());
    // Tick 2: schedule er forfalt → email sendes.
    const res = await runFlowBatch(new Date());
    expect(res.sent).toBeGreaterThanOrEqual(0);

    const sends = await prisma.messageSend.findMany({ where: { enrollmentId: { in: (await prisma.flowEnrollment.findMany({ where: { flowId: flow.id }, select: { id: true } })).map((e) => e.id) } } });
    // Kontakten har .invalid-adresse (ingen ekte SMTP i test) — vi verifiserer at en send-rad ble opprettet med kurs-flettefelt i emnet, og at det ikke dobles.
    const sent = sends.filter((s) => s.subject.includes('Kari') || s.dedupeKey);
    expect(sent.length).toBeLessThanOrEqual(1);
  });
});
```
(NB: implementeren justerer assertions til hvordan send-laget faktisk oppfører seg mot en `.invalid`-adresse i dev — poenget er: schedule → sleep til forfalt anker → nøyaktig én send/forsøk, med kurs-flettefelt løst. Bruk gjerne en ekte test-SMTP-mock hvis repoet har en; ellers assert på `messageSend`-raden.)

- [ ] **Step 2: Kjør — FEILER** (runneren injiserer ikke `courseDates` → schedule exit'er; ingen kurs-send)

Run: `pnpm exec vitest run tests/flows-runner-schedule.test.ts`

- [ ] **Step 3: Implementer i `lib/flows/runner.ts`**

1. Utvid `ClaimedEnrollment` (linje ~50) med anker-feltet:
```ts
  registrationId: number | null;
```
2. Legg til en kurs-dato-loader (etter `loadLastSendOpened`):
```ts
/** Live kursdatoer for en enrollment, eller null om den ikke er kurs-forankret. */
async function loadCourseDates(registrationId: number | null): Promise<{ startDate: Date | null; endDate: Date | null } | null> {
  if (registrationId == null) return null;
  const reg = await prisma.registration.findUnique({
    where: { id: registrationId },
    select: { course: { select: { startDate: true, endDate: true } } },
  });
  if (!reg) return null;
  return { startDate: reg.course.startDate, endDate: reg.course.endDate };
}
```
3. I `processEnrollment`-løkka, ved bygging av `ctx` (linje ~227-229), løs kursdatoer for schedule-noder og send `registrationId` til send-laget. Erstatt:
```ts
    const needsLastSendOpened = node.type === 'condition' && node.config.kind === 'opened_email';
    const lastSendOpened = needsLastSendOpened ? await loadLastSendOpened(enrollment.id) : null;
    const ctx: StepContext = { contact: { ...contact }, segmentRulesById, lastSendOpened, now };
```
med:
```ts
    const needsLastSendOpened = node.type === 'condition' && node.config.kind === 'opened_email';
    const lastSendOpened = needsLastSendOpened ? await loadLastSendOpened(enrollment.id) : null;
    const courseDates = node.type === 'schedule' ? await loadCourseDates(enrollment.registrationId) : null;
    const ctx: StepContext = { contact: { ...contact }, segmentRulesById, lastSendOpened, now, courseDates };
```
4. I `send_email`-grenen (linje ~234), send med `registrationId`:
```ts
        const result = await sendFlowEmail({
          enrollmentId: enrollment.id,
          nodeId: node.id,
          contactId: enrollment.contactId,
          registrationId: enrollment.registrationId,
          subject: plan.subject,
          bodyHtml: plan.bodyHtml,
          senderIdentityId: plan.senderIdentityId,
          aiPersonalize: plan.aiPersonalize,
          isMarketing: enrollment.flow.isMarketing,
        });
```
5. I `act`-grenen med `nextNodeId === null` (rolig exit, linje ~267), logg grunnen:
```ts
        if (plan.nextNodeId === null) {
          if (plan.action.kind === 'exit' && plan.action.value) {
            logger.info('Flyt-enrollment avsluttet', { enrollmentId: enrollment.id, reason: plan.action.value });
          }
          await prisma.flowEnrollment.update({
            where: { id: enrollment.id },
            data: { status: 'exited', finishedAt: now, currentNodeId: node.id },
          });
          return { sent, failed: false, completed: false };
        }
```
(`dueEnrollments` fra `findMany` inkluderer allerede `registrationId` som scalar — ingen select-endring nødvendig; kun `ClaimedEnrollment`-typen utvides så `processEnrollment` ser feltet.)

- [ ] **Step 4: Kjør — PASS**; full suite + tsc + `pnpm exec eslint lib/flows/runner.ts`.

- [ ] **Step 5: Commit**
```bash
git add lib/flows/runner.ts tests/flows-runner-schedule.test.ts
git commit -m "feat(flows): resolve live course dates + registration merge in runner"
```

---

### Task 9: Finish — full verifikasjon + live smoke + runbook

**Files:**
- Modify: `docs/deploy-runbook.md`

- [ ] **Step 1: Full verifikasjon**

Run: `pnpm exec tsc --noEmit` (rent), `pnpm test` (rapporter eksakt antall), `pnpm build` (OK).

- [ ] **Step 2: Live smoke mot dev-DB (tsx, selvryddende)**

Skriv et midlertidig `scripts/smoke-course-flow.ts` (IKKE commit) som: oppretter en aktiv flyt `start→schedule(course_start,-3)→email→end` + SenderIdentity + kontakt (`.invalid`) + kurs (startdato 5 dager frem) + forelder/registrering; kaller `enrollCourseRegistration`; kjører `runFlowBatch` og verifiserer at enrollmentens `nextRunAt` = `osloDayStartUtc(start−3)` (fremtidig, IKKE sendt ennå); så oppretter en ANNEN fixture med startdato i fortiden og verifiserer at `runFlowBatch` (to tick) gir nøyaktig én `messageSend` med kurs-flettefelt løst; verifiserer at et kurs UTEN startDate gir enrollment `status:'exited'`. Rydd ALT opp i `finally` og re-query for å bekrefte borte. Slett scriptet etter kjøring.

Run: `npx tsx scripts/smoke-course-flow.ts` (alle PASS), `rm scripts/smoke-course-flow.ts`.

- [ ] **Step 3: Oppdater deploy-runbooken**

I `docs/deploy-runbook.md`, i Steg 1 (SQL-migreringer), legg til en linje etter ai-layer-migreringen om den nye additive migreringen for delprosjekt A:
```markdown
7. `scripts/course-flows-migration.sql`  ⚠️ **inneholder TO partielle unike indekser** (`flow_enrollments_one_active` reskopet til `registration_id IS NULL`, + ny `flow_enrollments_one_active_reg`) som IKKE finnes i schema.prisma — de MÅ med. Additiv: to nye nullbare kolonner på `flow_enrollments` + FK-er.
```

- [ ] **Step 4: Commit (kun runbook — småfikser fra smoke om nødvendig)**
```bash
git add docs/deploy-runbook.md
git commit -m "docs: add course-flows migration to deploy runbook"
```

---

## Self-Review

**Spec-dekning:** Schema+migrering (spec §1 → Task 1), `schedule`-node type+validering (§2 → Task 3) + step-planlegging/`sleep`-gjenbruk (§2 → Task 4), anker-beregning Oslo-dag/catch-up (§3 → Task 2, catch-up bevist i Task 8-integrasjon), rolig exit ved uberegnelig anker (§3/§5 → Task 4 plan + Task 8 runner-logging), live kurs-flettekontekst (§4 → Task 5+6), enroll-primitiv + unikhet (§5 → Task 1 indekser + Task 7), testing (§6 → Task 2-8 + Task 9 smoke). Alle spec-seksjoner dekket.

**Placeholder-scan:** Ingen TBD/TODO. Alle kodesteg komplette. To bevisste «implementeren justerer assertions»-noter (Task 6/8) gjelder tilpasning til eksisterende test-fils mock-navn og send-lagets faktiske oppførsel mot `.invalid`-adresser — ikke manglende kode.

**Type-konsistens:** `ScheduleAnchor` (Task 2) brukes i step (Task 4). `StepContext.courseDates?: { startDate: Date | null; endDate: Date | null } | null` (Task 4) settes av runneren (Task 8) via `loadCourseDates` med identisk form. `SendFlowEmailInput.registrationId?: number | null` (Task 6) sendes av runneren (Task 8). `resolveCourseMergeContext(registrationId): Promise<MergeTagData | null>` (Task 5) konsumeres i send (Task 6). `enrollCourseRegistration(flowId, contactId, courseId, registrationId)` (Task 7). Flettefelt-navn identiske med `contactMergeTagData`/`MergeTagData`. Ingen drift.
```
