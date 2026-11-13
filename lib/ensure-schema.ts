import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';

export const COURSE_SCHEMA_STATEMENTS = [
  'ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "start_time" TEXT',
  'ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "end_time" TEXT',
  'ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "location" TEXT',
  'ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "learning_points" TEXT',
  'ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "packing_list" TEXT',
];

/** Egen tekst per mottaker og utsendelsesvalg per mottaker (én og én). */
export const UTSENDELSE_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "flow_message_overrides" (
    "id" SERIAL NOT NULL,
    "node_id" INTEGER NOT NULL,
    "contact_id" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "body_html" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "flow_message_overrides_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "flow_message_overrides_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "flow_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "flow_message_overrides_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS "flow_message_overrides_contact_id_idx" ON "flow_message_overrides"("contact_id")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "flow_message_overrides_node_id_contact_id_key" ON "flow_message_overrides"("node_id", "contact_id")',
  `CREATE TABLE IF NOT EXISTS "utsendelse_recipients" (
    "utsendelse_id" TEXT NOT NULL,
    "contact_id" INTEGER NOT NULL,
    "group_id" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "utsendelse_recipients_pkey" PRIMARY KEY ("utsendelse_id", "contact_id"),
    CONSTRAINT "utsendelse_recipients_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS "utsendelse_recipients_contact_id_idx" ON "utsendelse_recipients"("contact_id")',
  'ALTER TABLE "utsendelse_recipients" ADD COLUMN IF NOT EXISTS "excluded" BOOLEAN NOT NULL DEFAULT false',
  // Første versjon lagret «tatt ut» som group_id = null. Slike rader finnes ikke ellers, så dette er trygt å kjøre hver gang.
  'UPDATE "utsendelse_recipients" SET "excluded" = true WHERE "group_id" IS NULL AND "excluded" = false',
  // Sendetaket teller nylig sendte e-poster.
  'CREATE INDEX IF NOT EXISTS "message_sends_status_created_at_idx" ON "message_sends"("status", "created_at")',
];

/** Idempotent DDL ved oppstart (prod-databasen er stengt utenfra). Én feil stopper ikke resten. */
export async function ensureSchema(): Promise<void> {
  for (const statement of [...COURSE_SCHEMA_STATEMENTS, ...UTSENDELSE_SCHEMA_STATEMENTS]) {
    try {
      await prisma.$executeRawUnsafe(statement);
    } catch (error) {
      logger.error('ensureSchema failed', { statement: statement.slice(0, 80), error });
    }
  }
}
