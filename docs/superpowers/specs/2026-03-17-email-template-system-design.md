# Email Template System — Design Spec

## Overview

Replace hardcoded email templates with a dynamic, admin-managed email template system. Superadmin can create email templates with merge tags, attach them to course lifecycle events (triggers), and preview before saving. Includes both fixed event slots and custom triggers with configurable timing.

## Data Model

### EmailTemplate

Stores reusable email templates with merge tag support.

```prisma
model EmailTemplate {
  id        Int      @id @default(autoincrement())
  name      String   // Internal name, e.g. "Påminnelse begynnerkurs"
  subject   String   // Email subject with merge tags
  body      String   @db.Text // HTML body with merge tags
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  triggers EmailTrigger[]

  @@map("email_templates")
}
```

### EmailTrigger

Links a template to a course event. Controls when and whether the email fires.

```prisma
model EmailTrigger {
  id          Int      @id @default(autoincrement())
  courseId    Int      @map("course_id")
  templateId Int      @map("template_id")
  triggerType String  @map("trigger_type") // enum-like, see below
  offsetDays Int      @default(0) @map("offset_days") // negative = before, positive = after
  enabled    Boolean  @default(true)
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  course   Course        @relation(fields: [courseId], references: [id], onDelete: Cascade)
  template EmailTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  logs     EmailLog[]

  @@map("email_triggers")
}
```

**triggerType values:**

Fixed slots (relative to course dates):
- `registration_confirmed` — immediate on registration confirmation
- `reminder_before` — relative to course start (default offset: -3)
- `welcome_start` — on course start day (offset: 0)
- `midway` — halfway through course duration
- `after_end` — relative to course end (default offset: +1)

Custom slots:
- `custom_before_start` — custom offset before course start
- `custom_after_start` — custom offset after course start
- `custom_before_end` — custom offset before course end
- `custom_after_end` — custom offset after course end

### EmailLog

Tracks sent emails for auditing and preventing duplicates.

```prisma
model EmailLog {
  id             Int      @id @default(autoincrement())
  triggerId      Int      @map("trigger_id")
  registrationId Int      @map("registration_id")
  recipientEmail String   @map("recipient_email")
  status         String   @default("sent") // sent, failed
  sentAt         DateTime @default(now()) @map("sent_at")

  trigger      EmailTrigger @relation(fields: [triggerId], references: [id], onDelete: Cascade)
  registration Registration @relation(fields: [registrationId], references: [id], onDelete: Cascade)

  @@unique([triggerId, registrationId]) // prevent duplicate sends
  @@map("email_logs")
}
```

### Relations to add

On `Course`:
```prisma
emailTriggers EmailTrigger[]
```

On `Registration`:
```prisma
emailLogs EmailLog[]
```

## Merge Tags

Available variables in subject and body:

| Tag | Value |
|-----|-------|
| `{{forelder_navn}}` | Parent full name |
| `{{barnets_navn}}` | Child full name |
| `{{kurs_navn}}` | Course name |
| `{{kurs_startdato}}` | Course start date (dd.mm.yyyy) |
| `{{kurs_sluttdato}}` | Course end date (dd.mm.yyyy) |
| `{{allergier}}` | Child allergies or "Ingen" |
| `{{kontakt_epost}}` | Site contact email from settings |

Implementation: Simple string replacement at send time. A `replaceMergeTags(template, data)` function in `lib/mail.ts`.

## Admin UI

### 1. Email Templates Page (`/admin/email-templates`)

**List view:**
- Table: name, subject, # triggers using it, last updated
- "Opprett ny mal" button

**Create/Edit view:**
- Name (internal reference)
- Subject line (text input, merge tags insertable)
- Body (textarea with HTML, merge tag toolbar above)
- Merge tag toolbar: clickable buttons that insert `{{tag}}` at cursor position
- Preview panel: renders template with example data (hardcoded sample: "Emma Nordmann", "Begynnerkurs", etc.)
- Save / Delete buttons

### 2. Course Email Tab (in course edit page)

New tab "E-poster" in `/admin/courses/[id]/edit`:

- Lists all triggers for this course (both fixed slots and custom)
- Each row: trigger type label, template name (dropdown to change), offset days, enabled toggle
- "Legg til trigger" button: opens inline form to add custom trigger
  - Select template
  - Select reference point (kursstart / kursslutt)
  - Set offset days
- "Send nå" button per trigger: manually fire the trigger for all active registrations (with confirmation dialog)

### 3. Default Slots

When a course is created, auto-create the 5 fixed trigger slots with `enabled: false` and no template assigned. Superadmin activates and assigns templates as needed.

## Email Sending

### Immediate triggers

`registration_confirmed`: When a registration status changes to "confirmed", check for an enabled trigger with a template. If found, send using that template. If not found, fall back to the current hardcoded confirmation email (backwards compatibility).

### Scheduled triggers

A daily cron endpoint (`/api/cron/email-triggers`) that:

1. Finds all enabled triggers where:
   - triggerType is time-based (not `registration_confirmed`)
   - The computed send date (course start/end + offset) equals today
   - No EmailLog exists for this trigger + registration combo
2. For each match: replace merge tags, send email, create EmailLog entry
3. Handles `midway` by computing: `startDate + Math.floor((endDate - startDate) / 2)`

Protected by a cron secret (`CRON_SECRET` env var) or called via Railway cron.

### Send function

```typescript
async function sendTemplatedEmail(
  trigger: EmailTrigger & { template: EmailTemplate },
  registration: Registration & { child: Child; parent: Parent & { user: User } },
  settings: { contact_email: string }
): Promise<void>
```

Replaces merge tags, sends via existing nodemailer transport, logs to EmailLog.

## Migration from Hardcoded Templates

- Current templates in `lib/mail.ts` become seed data: 5 default EmailTemplate records
- Existing send functions (`sendRegistrationConfirmation`, etc.) check for template-based trigger first
- If no trigger/template found, use current hardcoded HTML as fallback
- This ensures zero disruption during rollout

## File Changes

### New files
- `app/admin/email-templates/page.tsx` — template list
- `app/admin/email-templates/[id]/page.tsx` — template editor with preview
- `app/api/admin/email-templates/route.ts` — CRUD API
- `app/api/admin/email-templates/[id]/route.ts` — single template API
- `app/api/admin/email-triggers/route.ts` — trigger CRUD
- `app/api/admin/email-triggers/[id]/route.ts` — single trigger API
- `app/api/admin/email-triggers/[id]/send/route.ts` — manual send
- `app/api/cron/email-triggers/route.ts` — daily scheduled sender
- `lib/email-templates.ts` — merge tag replacement, template rendering

### Modified files
- `prisma/schema.prisma` — add 3 new models + relations
- `lib/mail.ts` — add `sendTemplatedEmail`, update existing functions for fallback
- `app/admin/courses/[id]/edit/page.tsx` — add "E-poster" tab
- `app/admin/layout.tsx` — add "E-postmaler" nav item (superadmin only)
- `prisma/seed.js` — add default templates + triggers

## Access Control

- Email template management: **superadmin only**
- Course trigger configuration: **superadmin only**
- Viewing email logs: **admin + superadmin**

## Error Handling

- Failed sends: logged with `status: "failed"` in EmailLog, no retry
- Missing template: fall back to hardcoded email
- Missing merge tag data: replace with empty string
- SMTP not configured: skip sending, log to console (existing behavior)
