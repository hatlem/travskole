import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';

export const COURSE_SCHEMA_STATEMENTS = [
  'ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "start_time" TEXT',
  'ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "end_time" TEXT',
  'ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "location" TEXT',
  'ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "learning_points" TEXT',
  'ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "packing_list" TEXT',
];

export async function ensureSchema(): Promise<void> {
  try {
    for (const statement of COURSE_SCHEMA_STATEMENTS) {
      await prisma.$executeRawUnsafe(statement);
    }
  } catch (error) {
    logger.error('ensureSchema failed', { error });
  }
}
