# Kurs-livssyklus-flyter — Implementasjonsplan (delprosjekt B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Koble kurs-påmeldinger inn i én delt, seedet «Kurs-livssyklus»-flyt via `registration.created`, gi schedule-noden canvas-UI, og la flyt + legacy sameksistere trygt (per-registrering-eierskap) til paritet er bevist.

**Architecture:** `Flow.anchorMode` skiller kontakt- fra kurs-forankrede flyter; `enrollFromEvent` enroller kurs-forankret (A's `enrollCourseRegistration`) når en aktiv `course`-flyt matcher et event med `registrationId`+`courseId` i meta. Legacy-cronen hopper over registreringer som allerede har en flyt-enrollment → per-registrering XOR, null dobbel-send. En idempotent seed oppretter livssyklus-flyten (`draft`).

**Tech Stack:** Next.js 16, Prisma 5/Postgres, Vitest, TypeScript strict, pnpm, React Flow.

## Global Constraints

- Ingen nye env-vars. Én ny additiv SQL-migrering (`scripts/course-lifecycle-migration.sql` — kun `ADD COLUMN`) + én idempotent seed.
- `Flow.anchorMode` default `'contact'` → ALLE eksisterende flyter og dagens markedsførings-atferd NØYAKTIG uendret.
- `registration_confirmed`-inline-stien (`app/api/registrations/route.ts`) er URØRT — kun de dato-baserte legacy-triggerne dekkes av flyten.
- Anker-vokabular EKSAKT (fra A): `course_start | course_midway | course_end`, `offsetDays: number` (heltall). «Før/etter» = fortegn på offset, ikke egne anker-valg.
- Parallelldrift-invariant: en registrering får dato-baserte e-poster fra NØYAKTIG ett system (legacy XOR flyt), håndhevet av `flowEnrollments: { none: {} }`-filteret + at `enrollFromEvent` kun matcher aktive flyter.
- Livssyklus-flyten seedes som `status: 'draft'` (aktiveres manuelt av admin). Seed er idempotent (no-op ved ny kjøring).
- Scope-grense: INGEN fjerning av `EmailTrigger`/legacy-cron (→ delprosjekt C), INGEN datamigrering av maltekst (→ C).

---

### Task 1: Schema + migrering — `Flow.anchorMode`

**Files:**
- Modify: `prisma/schema.prisma` (model `Flow`)
- Create: `scripts/course-lifecycle-migration.sql`

**Interfaces:**
- Produces: `Flow.anchorMode: string` (`'contact'` | `'course'`, default `'contact'`).

- [ ] **Step 1: Legg til kolonnen i `Flow`**

I `prisma/schema.prisma`, i `model Flow`, etter `isMarketing`-linjen:
```prisma
  anchorMode    String           @default("contact") @map("anchor_mode") // contact | course (kurs-forankret enrollment)
```

- [ ] **Step 2: Push + generer**

Run: `pnpm prisma db push && pnpm prisma generate`
Expected: «Your database is now in sync with your Prisma schema.»

- [ ] **Step 3: Skriv migrerings-SQL**

Create `scripts/course-lifecycle-migration.sql`:
```sql
-- Delprosjekt B: anchor_mode på flows (additiv). Basefarm, FØR kode-deploy.
ALTER TABLE flows ADD COLUMN IF NOT EXISTS anchor_mode TEXT NOT NULL DEFAULT 'contact';
```

- [ ] **Step 4: Bruk på dev-DB (bekreft idempotent)**

Run: `pnpm prisma db execute --file scripts/course-lifecycle-migration.sql --schema prisma/schema.prisma`
Expected: kjører uten feil (kolonnen finnes allerede fra `db push` → `IF NOT EXISTS` no-op).

- [ ] **Step 5: tsc + commit**

Run: `pnpm exec tsc --noEmit` (rent).
```bash
git add prisma/schema.prisma scripts/course-lifecycle-migration.sql
git commit -m "feat(flows): Flow.anchorMode (contact|course) + migration"
```

---

### Task 2: `enrollFromEvent` kurs-forankret gren — `lib/flows/enroll.ts`

**Files:**
- Modify: `lib/flows/enroll.ts` (`enrollFromEvent`)
- Test: `tests/flows-enroll.test.ts` (append)

**Interfaces:**
- Consumes: `enrollCourseRegistration` (A), `enrollContact`, `matchTriggers`.
- Produces: `enrollFromEvent` enroller kurs-forankret når en matchet flyt har `anchorMode==='course'` og meta bærer `registrationId`+`courseId`.

- [ ] **Step 1: Skriv failende tester** (append til `tests/flows-enroll.test.ts`; behold eksisterende mocks — utvid prisma-mocken med `flowTrigger.findMany` og spionér på begge enroll-veier via prisma.flowEnrollment)

```ts
describe('enrollFromEvent: kurs-forankret gren', () => {
  it('course-flyt + meta med ids → kurs-forankret enroll', async () => {
    prisma.flowTrigger.findMany.mockResolvedValue([
      { flowId: 3, eventType: 'registration.created', filter: '{}', flow: { anchorMode: 'course' } },
    ]);
    prisma.flowEnrollment.findFirst.mockResolvedValue(null); // ingen aktiv
    prisma.flowEnrollment.create.mockResolvedValue({ id: 1 });
    await enrollFromEvent({ type: 'registration.created', contactId: 7, meta: { registrationId: 42, courseId: 9 } });
    // kurs-forankret create bærer courseId + registrationId
    expect(prisma.flowEnrollment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ flowId: 3, contactId: 7, courseId: 9, registrationId: 42 }) }),
    );
  });
  it('contact-flyt → kontakt-enroll (ingen course/registration-felt)', async () => {
    prisma.flowTrigger.findMany.mockResolvedValue([
      { flowId: 5, eventType: 'registration.created', filter: '{}', flow: { anchorMode: 'contact' } },
    ]);
    prisma.flowEnrollment.findFirst.mockResolvedValue(null);
    prisma.flowEnrollment.create.mockResolvedValue({ id: 2 });
    await enrollFromEvent({ type: 'registration.created', contactId: 7, meta: { registrationId: 42, courseId: 9 } });
    const arg = prisma.flowEnrollment.create.mock.calls.at(-1)?.[0]?.data;
    expect(arg.courseId).toBeUndefined();
    expect(arg.registrationId).toBeUndefined();
  });
  it('course-flyt men meta mangler ids → faller til kontakt-enroll', async () => {
    prisma.flowTrigger.findMany.mockResolvedValue([
      { flowId: 3, eventType: 'x.happened', filter: '{}', flow: { anchorMode: 'course' } },
    ]);
    prisma.flowEnrollment.findFirst.mockResolvedValue(null);
    prisma.flowEnrollment.create.mockResolvedValue({ id: 3 });
    await enrollFromEvent({ type: 'x.happened', contactId: 7, meta: {} });
    const arg = prisma.flowEnrollment.create.mock.calls.at(-1)?.[0]?.data;
    expect(arg.registrationId).toBeUndefined();
  });
});
```
(NB: implementeren sørger for at prisma-mocken har `flowTrigger.findMany` og `flowEnrollment.findFirst/create`; gjenbruk `vi.hoisted`-mønsteret i fila.)

- [ ] **Step 2: Kjør — FEILER**

Run: `pnpm exec vitest run tests/flows-enroll.test.ts`

- [ ] **Step 3: Implementer** i `lib/flows/enroll.ts`. Legg til import øverst hvis mangler:
```ts
// (enrollCourseRegistration er allerede definert i denne fila fra delprosjekt A)
```
Erstatt kroppen i `enrollFromEvent` (linje ~113-127) sin trigger-henting + løkke med:
```ts
    const triggers = await prisma.flowTrigger.findMany({
      where: { flow: { status: 'active' } },
      select: { flowId: true, eventType: true, filter: true, flow: { select: { anchorMode: true } } },
    });

    const anchorByFlow = new Map(triggers.map((t) => [t.flowId, t.flow.anchorMode]));
    const event: EventLike = { type: input.type, meta: input.meta };
    const matchedFlowIds = matchTriggers(event, triggers);

    const registrationId = typeof input.meta.registrationId === 'number' ? input.meta.registrationId : null;
    const courseId = typeof input.meta.courseId === 'number' ? input.meta.courseId : null;

    for (const flowId of matchedFlowIds) {
      if (anchorByFlow.get(flowId) === 'course' && registrationId !== null && courseId !== null) {
        await enrollCourseRegistration(flowId, contactId, courseId, registrationId);
      } else {
        await enrollContact(flowId, contactId);
      }
    }
```
(`matchTriggers` tar `TriggerLike[]` = `{flowId,eventType,filter}` — det ekstra `flow`-feltet er strukturelt uskadelig. Alt annet i `enrollFromEvent` — try/catch, `if (!input.contactId) return` — uendret.)

- [ ] **Step 4: Kjør — PASS**; full suite + tsc.

- [ ] **Step 5: Commit**
```bash
git add lib/flows/enroll.ts tests/flows-enroll.test.ts
git commit -m "feat(flows): course-anchored enroll for anchorMode=course flows"
```

---

### Task 3: Legacy-cron parallelldrift-filter — `app/api/cron/email-triggers/route.ts`

**Files:**
- Modify: `app/api/cron/email-triggers/route.ts`
- Test: `tests/cron-email-triggers-where.test.ts`

**Interfaces:**
- Produces: eksportert ren hjelper `dueRegistrationsWhere(trigger: { id: number; courseId: number })` som bygger registrerings-spørringens `where`, INKLUDERT `flowEnrollments: { none: {} }` (hopp over flyt-eide registreringer).

- [ ] **Step 1: Skriv failende test** (`tests/cron-email-triggers-where.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { dueRegistrationsWhere } from '@/app/api/cron/email-triggers/route';

describe('dueRegistrationsWhere', () => {
  it('inkluderer courseId, status, emailLogs-none OG flowEnrollments-none', () => {
    const w = dueRegistrationsWhere({ id: 11, courseId: 3 });
    expect(w.courseId).toBe(3);
    expect(w.status).toEqual({ in: ['pending', 'confirmed'] });
    expect(w.emailLogs).toEqual({ none: { triggerId: 11 } });
    // Parallelldrift: flyt-eide registreringer utelates fra legacy.
    expect(w.flowEnrollments).toEqual({ none: {} });
  });
});
```

- [ ] **Step 2: Kjør — FEILER** (funksjonen finnes ikke)

Run: `pnpm exec vitest run tests/cron-email-triggers-where.test.ts`

- [ ] **Step 3: Implementer.** I `app/api/cron/email-triggers/route.ts`, legg til den eksporterte hjelperen (nær `computeSendDate`):
```ts
/**
 * WHERE for registreringer som er «forfalt» for en dato-basert trigger.
 * `flowEnrollments: { none: {} }` er parallelldrift-vakten (delprosjekt B):
 * en registrering som er meldt inn i en kurs-livssyklus-flyt eies av flyten —
 * legacy-cronen hopper over den, slik at ingen registrering får en dato-basert
 * e-post fra BÅDE legacy og flyt. Se docs/superpowers/specs/2026-07-23-course-lifecycle-flows-design.md §4.
 */
export function dueRegistrationsWhere(trigger: { id: number; courseId: number }) {
  return {
    courseId: trigger.courseId,
    status: { in: ['pending', 'confirmed'] },
    emailLogs: { none: { triggerId: trigger.id } },
    flowEnrollments: { none: {} },
  };
}
```
Så, i `GET`-handleren, erstatt det inline `where`-objektet i `prisma.registration.findMany` (linje ~132-138) med:
```ts
      const registrations = await prisma.registration.findMany({
        where: dueRegistrationsWhere(trigger),
        include: {
          child: true,
          parent: { include: { user: true } },
        },
      });
```
(Alt annet i ruta — auth, trigger-løkka, GDPR-passene, retur — uendret.)

- [ ] **Step 4: Kjør — PASS**; full suite + tsc + `pnpm exec eslint app/api/cron/email-triggers/route.ts`.

- [ ] **Step 5: Commit**
```bash
git add app/api/cron/email-triggers/route.ts tests/cron-email-triggers-where.test.ts
git commit -m "feat(flows): legacy cron skips flow-owned registrations (parallel-run safety)"
```

---

### Task 4: Seed livssyklus-flyten — `lib/flows/seed-lifecycle.ts` + script

**Files:**
- Create: `lib/flows/seed-lifecycle.ts` (idempotent seed-funksjon)
- Create: `scripts/seed-course-lifecycle-flow.ts` (tynn CLI-wrapper)
- Test: `tests/flows-seed-lifecycle.test.ts`

**Interfaces:**
- Produces: `seedCourseLifecycleFlow(): Promise<{ created: boolean; flowId: number }>` — oppretter «Kurs-livssyklus»-flyten hvis den ikke finnes; no-op ellers.

- [ ] **Step 1: Skriv failende idempotens-test** (mock prisma)

Create `tests/flows-seed-lifecycle.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prisma = vi.hoisted(() => ({
  flow: { findFirst: vi.fn(), create: vi.fn() },
  senderIdentity: { findFirst: vi.fn() },
  flowNode: { create: vi.fn(), findMany: vi.fn() },
  flowEdge: { createMany: vi.fn() },
  flowTrigger: { create: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));

import { seedCourseLifecycleFlow } from '@/lib/flows/seed-lifecycle';

beforeEach(() => vi.clearAllMocks());

describe('seedCourseLifecycleFlow', () => {
  it('no-op når flyten allerede finnes', async () => {
    prisma.flow.findFirst.mockResolvedValue({ id: 99 });
    const res = await seedCourseLifecycleFlow();
    expect(res).toEqual({ created: false, flowId: 99 });
    expect(prisma.flow.create).not.toHaveBeenCalled();
  });
  it('oppretter flyt + trigger + noder + kanter når den mangler', async () => {
    prisma.flow.findFirst.mockResolvedValue(null);
    prisma.senderIdentity.findFirst.mockResolvedValue({ id: 5 });
    prisma.flow.create.mockResolvedValue({ id: 100 });
    let nodeId = 200;
    prisma.flowNode.create.mockImplementation(async () => ({ id: ++nodeId }));
    const res = await seedCourseLifecycleFlow();
    expect(res.created).toBe(true);
    expect(res.flowId).toBe(100);
    expect(prisma.flow.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Kurs-livssyklus', anchorMode: 'course', status: 'draft', isMarketing: false }) }),
    );
    expect(prisma.flowTrigger.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ flowId: 100, eventType: 'registration.created' }) }),
    );
    expect(prisma.flowNode.create).toHaveBeenCalledTimes(10); // start + 4×(schedule+email) + end
    expect(prisma.flowEdge.createMany).toHaveBeenCalled();
  });
  it('kaster tydelig hvis ingen aktiv avsender finnes', async () => {
    prisma.flow.findFirst.mockResolvedValue(null);
    prisma.senderIdentity.findFirst.mockResolvedValue(null);
    await expect(seedCourseLifecycleFlow()).rejects.toThrow(/avsender/i);
  });
});
```

- [ ] **Step 2: Kjør — FEILER**

Run: `pnpm exec vitest run tests/flows-seed-lifecycle.test.ts`

- [ ] **Step 3: Implementer `lib/flows/seed-lifecycle.ts`**

```ts
/**
 * Idempotent seed av den delte «Kurs-livssyklus»-flyten (delprosjekt B, Model 1).
 * Lineær schedule→email-kjede i kronologisk ankerrekkefølge. Seedes som draft —
 * admin aktiverer når klar. No-op hvis flyten allerede finnes.
 */
import { prisma } from '@/lib/prisma';

const FLOW_NAME = 'Kurs-livssyklus';

// [anker, offsetDays, emne, kropp] i kronologisk rekkefølge.
const STEPS: { anchor: string; offsetDays: number; subject: string; bodyHtml: string }[] = [
  { anchor: 'course_start', offsetDays: -3, subject: 'Påminnelse: {{kurs_navn}} starter snart',
    bodyHtml: '<p>Hei {{forelder_navn}},</p><p>Vi minner om at {{kurs_navn}} starter {{kurs_startdato}}. Vi gleder oss til å se {{barnets_navn}}!</p>' },
  { anchor: 'course_start', offsetDays: 0, subject: 'Velkommen til {{kurs_navn}}',
    bodyHtml: '<p>Hei {{forelder_navn}},</p><p>I dag starter {{kurs_navn}}. Velkommen! Gi oss beskjed ved allergier: {{allergier}}.</p>' },
  { anchor: 'course_midway', offsetDays: 0, subject: 'Halvveis i {{kurs_navn}}',
    bodyHtml: '<p>Hei {{forelder_navn}},</p><p>{{barnets_navn}} er nå halvveis i {{kurs_navn}}. Håper det går bra!</p>' },
  { anchor: 'course_end', offsetDays: 1, subject: 'Takk for deltakelsen på {{kurs_navn}}',
    bodyHtml: '<p>Hei {{forelder_navn}},</p><p>Takk for at {{barnets_navn}} deltok på {{kurs_navn}}. Vi håper å se dere igjen!</p>' },
];

export async function seedCourseLifecycleFlow(): Promise<{ created: boolean; flowId: number }> {
  const existing = await prisma.flow.findFirst({ where: { name: FLOW_NAME, anchorMode: 'course' }, select: { id: true } });
  if (existing) return { created: false, flowId: existing.id };

  const sender = await prisma.senderIdentity.findFirst({ where: { active: true }, select: { id: true } });
  if (!sender) throw new Error('Kan ikke seede livssyklus-flyten: ingen aktiv avsender-identitet (SenderIdentity) funnet.');

  const flow = await prisma.flow.create({
    data: { name: FLOW_NAME, description: 'Automatiske kurs-livssyklus-e-poster (delprosjekt B).', anchorMode: 'course', isMarketing: false, status: 'draft' },
  });
  await prisma.flowTrigger.create({ data: { flowId: flow.id, eventType: 'registration.created', filter: '{}' } });

  // Bygg noder: start → (schedule,email)×4 → end. posY øker for lesbar layout.
  const startNode = await prisma.flowNode.create({ data: { flowId: flow.id, type: 'start', config: '{}', posX: 0, posY: 0 } });
  const chain: number[] = [startNode.id];
  let y = 120;
  for (const step of STEPS) {
    const sched = await prisma.flowNode.create({ data: { flowId: flow.id, type: 'schedule', config: JSON.stringify({ anchor: step.anchor, offsetDays: step.offsetDays }), posX: 0, posY: y } });
    y += 120;
    const email = await prisma.flowNode.create({ data: { flowId: flow.id, type: 'email', config: JSON.stringify({ subject: step.subject, bodyHtml: step.bodyHtml, senderIdentityId: sender.id }), posX: 0, posY: y } });
    y += 120;
    chain.push(sched.id, email.id);
  }
  const endNode = await prisma.flowNode.create({ data: { flowId: flow.id, type: 'end', config: '{}', posX: 0, posY: y } });
  chain.push(endNode.id);

  await prisma.flowEdge.createMany({
    data: chain.slice(0, -1).map((fromNodeId, i) => ({ flowId: flow.id, fromNodeId, toNodeId: chain[i + 1], branch: null })),
  });

  return { created: true, flowId: flow.id };
}
```

- [ ] **Step 4: Lag CLI-wrapperen `scripts/seed-course-lifecycle-flow.ts`**

```ts
import { prisma } from '../lib/prisma';
import { seedCourseLifecycleFlow } from '../lib/flows/seed-lifecycle';

seedCourseLifecycleFlow()
  .then((r) => console.log(r.created ? `Opprettet livssyklus-flyt id=${r.flowId} (draft)` : `Livssyklus-flyt finnes allerede id=${r.flowId} — ingen endring`))
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 5: Kjør — PASS**; full suite + tsc.

- [ ] **Step 6: Commit**
```bash
git add lib/flows/seed-lifecycle.ts scripts/seed-course-lifecycle-flow.ts tests/flows-seed-lifecycle.test.ts
git commit -m "feat(flows): idempotent course-lifecycle flow seed"
```

---

### Task 5: Schedule-node canvas-UI — palett + config-panel

**Files:**
- Modify: `app/admin/crm/flyter/[id]/node-types.tsx` (gjeninnfør palett-oppføring + `ScheduleNode` + registrering)
- Modify: `app/admin/crm/flyter/[id]/node-config-panel.tsx` (config-panel for schedule)

**Interfaces:**
- Consumes: `FlowNodeType` (inkluderer `'schedule'` fra A), `validateScheduleConfig` (A, via lagring/aktivering).

- [ ] **Step 1: Gjeninnfør schedule i `node-types.tsx`** (revertert i A's Task 3-fix — de 3 `Record`-oppføringene finnes allerede)

1. Legg `'schedule'` inn i `NODE_TYPE_ORDER` (før `'end'`):
```ts
export const NODE_TYPE_ORDER: FlowNodeType[] = ['start', 'email', 'wait', 'condition', 'action', 'schedule', 'end'];
```
2. Gjeninnfør `ScheduleNode`-komponenten (etter `ActionNode`):
```tsx
export function ScheduleNode({ data, selected }: NodeProps<FlowRFNode>) {
  const anchor = typeof data.config.anchor === 'string' ? data.config.anchor : undefined;
  const off = typeof data.config.offsetDays === 'number' ? data.config.offsetDays : undefined;
  const subtitle = anchor ? `${anchor}${off ? ` ${off > 0 ? '+' : ''}${off}d` : ''}` : undefined;
  return (
    <Card nodeType="schedule" selected={selected} hasError={data.hasError} subtitle={subtitle}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </Card>
  );
}
```
3. Registrer i `nodeTypes`:
```ts
  schedule: ScheduleNode,
```
(De 3 `Record<FlowNodeType,string>`-oppføringene — `NODE_LABELS.schedule='Planlegg'`, `NODE_ICONS.schedule='📅'`, `NODE_ACCENTS.schedule='border-t-cyan-500'` — er allerede på plass fra A.)

- [ ] **Step 2: Legg til config-panel i `node-config-panel.tsx`**

1. Legg til konstanten (ved de andre options-listene, f.eks. etter `ACTION_KIND_OPTIONS`):
```ts
const SCHEDULE_ANCHOR_OPTIONS = [
  { value: 'course_start', label: 'Kursstart' },
  { value: 'course_midway', label: 'Halvveis' },
  { value: 'course_end', label: 'Kursslutt' },
];
```
2. Utvid header-etiketten (i `<h3>`-ternæren) så `'schedule'` gir «Planlegg». Endre den innerste grenen fra `: 'Slutt'` til:
```tsx
                    : node.type === 'schedule'
                      ? 'Planlegg'
                      : node.type === 'start'
                        ? 'Start'
                        : 'Slutt'}
```
3. Legg til panel-blokken (etter `action`-blokken, før `start/end`-blokken):
```tsx
      {node.type === 'schedule' && (
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Anker (kursdato)</label>
            <select
              value={typeof config.anchor === 'string' ? config.anchor : ''}
              onChange={(e) => set({ anchor: e.target.value })}
              disabled={disabled}
              className={inputCls}
            >
              <option value="">Velg anker …</option>
              {SCHEDULE_ANCHOR_OPTIONS.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Forskyvning (dager)</label>
            <input
              type="number"
              value={typeof config.offsetDays === 'number' ? config.offsetDays : 0}
              onChange={(e) => set({ offsetDays: Math.trunc(Number(e.target.value)) || 0 })}
              disabled={disabled}
              className={inputCls}
            />
            <p className="mt-1 text-[11px] text-gray-500">Negativt = før ankeret, positivt = etter. F.eks. Kursstart med −3 = tre dager før kursstart.</p>
          </div>
        </div>
      )}
```

- [ ] **Step 3: Verifiser** `pnpm exec tsc --noEmit` (rent); `pnpm exec eslint 'app/admin/crm/flyter/[id]/node-types.tsx' 'app/admin/crm/flyter/[id]/node-config-panel.tsx'` (noter pre-eksisterende feil separat via git stash); full suite `pnpm test`; `pnpm build`.

- [ ] **Step 4: Commit**
```bash
git add "app/admin/crm/flyter/[id]/node-types.tsx" "app/admin/crm/flyter/[id]/node-config-panel.tsx"
git commit -m "feat(flows): schedule node in canvas palette + config panel"
```

---

### Task 6: Finish — full verifikasjon + live smoke + runbook

**Files:**
- Modify: `docs/deploy-runbook.md`

- [ ] **Step 1: Full verifikasjon:** `pnpm exec tsc --noEmit` (rent), `pnpm test` (rapporter eksakt antall), `pnpm build` (OK).

- [ ] **Step 2: Live smoke (tsx, selvryddende).** Skriv `scripts/smoke-course-lifecycle.ts` (IKKE commit) som:
  1. Kjører `seedCourseLifecycleFlow()`, aktiverer flyten (`status:'active'`), henter dens id.
  2. Oppretter en kontakt (`.invalid`) + forelder/kurs (startdato i FORTIDEN så første anker er forfalt) + registrering, og en tilsvarende `Contact` som matcher forelder-e-posten (så `enrollFromEvent`s contactId finnes).
  3. Kaller `emitEvent({ type:'registration.created', contactId, meta:{ registrationId, courseId, courseName } })` (eller `enrollFromEvent` direkte) → verifiser at en KURS-forankret `FlowEnrollment` ble opprettet (courseId+registrationId satt).
  4. Driver `runFlowBatch` noen ganger → verifiser at schedule-kjeden sender e-postene i kronologisk rekkefølge med kurs-flettefelt løst (minst påminnelsen sendes; `MessageSend`-rader finnes).
  5. Verifiser parallelldrift: `prisma.registration.findMany({ where: dueRegistrationsWhere({ id: <en enabled trigger.id>, courseId }) })` returnerer IKKE den flyt-eide registreringen (fordi den har en flyt-enrollment). (Bygg evt. en enabled EmailTrigger for kurset for å gjøre sjekken konkret.)
  6. Rydd ALT opp i `finally` (flyt+noder+kanter+trigger+enrollments+messageSends, registrering, forelder, bruker, kurs, kontakt, ev. EmailTrigger) og re-query for å bekrefte borte. Rapporter PASS/FAIL-oppsummering.

Run: `npx tsx scripts/smoke-course-lifecycle.ts` (alle PASS), deretter `rm scripts/smoke-course-lifecycle.ts`.

- [ ] **Step 3: Oppdater runbooken.** I `docs/deploy-runbook.md`, Steg 1 (SQL), legg til etter course-flows-migreringen:
```markdown
8. `scripts/course-lifecycle-migration.sql`  (additiv — `anchor_mode`-kolonne på `flows`; delprosjekt B).
```
Og legg til et nytt steg etter SQL-migreringene:
```markdown
## Steg 1b — Seed kurs-livssyklus-flyten (delprosjekt B)

Etter migreringene, kjør seeden ÉN gang (idempotent): `npx tsx scripts/seed-course-lifecycle-flow.ts`.
Den oppretter «Kurs-livssyklus»-flyten som **draft**. Aktivér den i admin (`/admin/crm/flyter`) FØRST når dere er klare til å la flyten overta dato-baserte kurs-e-poster — fra aktivering eier flyten nye påmeldinger og legacy-cronen hopper automatisk over dem (per-registrering-eierskap). Legacy fullfører påmeldinger fra før aktivering. Verifiser paritet før delprosjekt C fjerner legacy.
```

- [ ] **Step 4: Commit (kun runbook — smårettinger fra smoke om nødvendig)**
```bash
git add docs/deploy-runbook.md
git commit -m "docs: course-lifecycle migration + seed/activation in runbook"
```

---

## Self-Review

**Spec-dekning:** `Flow.anchorMode` + migrering (spec §2 → Task 1); event-drevet kurs-enroll (§1/§2 → Task 2); parallelldrift-filter (§4 → Task 3); seedet livssyklus-flyt (§3 → Task 4); schedule canvas-UI (§5 → Task 5); testing + runbook + live smoke (§6 → alle + Task 6). `registration_confirmed` inline urørt (bekreftet — ingen task rører `app/api/registrations/route.ts`). Alle spec-seksjoner dekket.

**Placeholder-scan:** Ingen TBD/TODO; alle kodesteg komplette (default e-postkopi, config-panel, seed-struktur, where-hjelper — alt fullt utskrevet). Live-smoke-steget (Task 6) beskriver eksakt fixtur/verifikasjon/opprydding — implementeren skriver scriptet, som er standard for finish-tasken (samme som delprosjekt A).

**Type-konsistens:** `anchorMode`-strengen `'course'`/`'contact'` identisk i schema (Task 1), enroll-grenen (Task 2) og seeden (Task 4). Anker-strengene `course_start/course_midway/course_end` identiske i seed (Task 4), config-panel-options (Task 5) og A's `schedule.ts`/validering. `dueRegistrationsWhere(trigger)` (Task 3) — `{id,courseId}`-signatur brukt både i ruta og testen. `seedCourseLifecycleFlow(): Promise<{created,flowId}>` (Task 4) konsumeres av CLI-wrapperen + smoke. `registration.created`-eventtype identisk i enroll (Task 2), seed-trigger (Task 4) og smoke (Task 6). Ingen drift.
