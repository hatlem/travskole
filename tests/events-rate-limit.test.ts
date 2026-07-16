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

  it('maxKeys: inserting maxKeys+1 distinct keys evicts the first', () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 1, maxKeys: 2 });
    expect(rl.allow('k1')).toBe(true); // k1 recorded, map size 1
    expect(rl.allow('k2')).toBe(true); // k2 recorded, map size 2 (at cap)
    expect(rl.allow('k3')).toBe(true); // 3rd distinct key at cap -> evicts oldest (k1)

    // k1 was evicted, so it comes back with a fresh quota (full limit available).
    expect(rl.allow('k1')).toBe(true);
  });

  it('maxKeys: existing-key updates never evict other keys', () => {
    const rl = createRateLimiter({ limit: 5, windowMs: 60_000, now: () => 1, maxKeys: 2 });
    rl.allow('k1'); // map size 1
    rl.allow('k2'); // map size 2 (at cap)

    // Repeatedly re-hit the existing key k1 while at cap — must never evict k2.
    for (let i = 0; i < 10; i++) rl.allow('k1');

    // k2's own hit history must be untouched: 1 hit so far, 4 more reach the
    // limit of 5, and the 6th is blocked — proving it was never reset/evicted.
    for (let i = 0; i < 4; i++) expect(rl.allow('k2')).toBe(true);
    expect(rl.allow('k2')).toBe(false);
  });
});
