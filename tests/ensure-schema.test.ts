import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeRawUnsafe = vi.hoisted(() => vi.fn());
vi.mock('@/lib/prisma', () => ({ prisma: { $executeRawUnsafe: executeRawUnsafe } }));
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn() } }));

import { COURSE_SCHEMA_STATEMENTS, UTSENDELSE_SCHEMA_STATEMENTS, ensureSchema } from '@/lib/ensure-schema';

describe('ensureSchema', () => {
  beforeEach(() => {
    executeRawUnsafe.mockReset();
  });

  it('runs only idempotent additive statements', async () => {
    executeRawUnsafe.mockResolvedValue(0);
    await ensureSchema();
    expect(executeRawUnsafe).toHaveBeenCalledTimes(COURSE_SCHEMA_STATEMENTS.length + UTSENDELSE_SCHEMA_STATEMENTS.length);
    for (const statement of COURSE_SCHEMA_STATEMENTS) {
      expect(statement).toMatch(/^ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS /);
    }
    for (const statement of UTSENDELSE_SCHEMA_STATEMENTS) {
      expect(statement).toMatch(/^CREATE (UNIQUE )?(TABLE|INDEX) IF NOT EXISTS /);
    }
  });

  it('never throws, and one failing statement does not skip the rest', async () => {
    executeRawUnsafe.mockRejectedValue(new Error('boom'));
    await expect(ensureSchema()).resolves.toBeUndefined();
    expect(executeRawUnsafe).toHaveBeenCalledTimes(COURSE_SCHEMA_STATEMENTS.length + UTSENDELSE_SCHEMA_STATEMENTS.length);
  });
});
