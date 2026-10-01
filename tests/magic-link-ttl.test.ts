import { describe, it, expect } from 'vitest';
import { MAGIC_LINK_TTL_HOURS, MAGIC_LINK_TTL_MS } from '@/lib/magic-link-ttl';

describe('innloggingslenkens levetid', () => {
  it('varer i 12 timer', () => {
    expect(MAGIC_LINK_TTL_HOURS).toBe(12);
    expect(MAGIC_LINK_TTL_MS).toBe(12 * 60 * 60 * 1000);
  });
});
