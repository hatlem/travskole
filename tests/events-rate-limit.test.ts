import { describe, it, expect } from 'vitest';
import { createRateLimiter } from '@/lib/events/rate-limit';

describe('createRateLimiter', () => {
  it('allows up to limit within the window, then blocks', () => {
    let t = 1_000_000;
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => t });
    expect(rl.allow('a')).toBe(true);
    expect(rl.allow('a')).toBe(true);
    expect(rl.allow('a')).toBe(true);
    expect(rl.allow('a')).toBe(false);
  });

  it('window slides: old hits expire', () => {
    let t = 1_000_000;
    const rl = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => t });
    expect(rl.allow('a')).toBe(true);
    expect(rl.allow('a')).toBe(true);
    expect(rl.allow('a')).toBe(false);
    t += 60_001;
    expect(rl.allow('a')).toBe(true);
  });

  it('keys are independent', () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 5 });
    expect(rl.allow('a')).toBe(true);
    expect(rl.allow('b')).toBe(true);
    expect(rl.allow('a')).toBe(false);
  });
});
