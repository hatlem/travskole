import { describe, it, expect } from 'vitest';
import { isChunkLoadError, shouldReloadForChunkError } from '@/lib/chunk-error';

describe('isChunkLoadError', () => {
  it('recognises stale-deployment chunk failures across bundlers and browsers', () => {
    expect(isChunkLoadError({ name: 'ChunkLoadError', message: 'Loading chunk 123 failed.' })).toBe(true);
    expect(isChunkLoadError({ name: 'Error', message: 'Failed to load chunk /_next/static/chunks/abc.js' })).toBe(true);
    expect(isChunkLoadError({ name: 'TypeError', message: 'Failed to fetch dynamically imported module: https://x/a.js' })).toBe(true);
    expect(isChunkLoadError({ name: 'TypeError', message: 'Importing a module script failed.' })).toBe(true);
    expect(isChunkLoadError({ name: 'Error', message: 'Loading CSS chunk app-admin failed' })).toBe(true);
  });

  it('ignores ordinary errors', () => {
    expect(isChunkLoadError({ name: 'TypeError', message: "Cannot read properties of undefined (reading 'map')" })).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe('shouldReloadForChunkError', () => {
  const now = 1_000_000;
  it('reloads when there is no recent automatic reload', () => {
    expect(shouldReloadForChunkError(null, now)).toBe(true);
    expect(shouldReloadForChunkError('garbage', now)).toBe(true);
    expect(shouldReloadForChunkError(String(now - 31_000), now)).toBe(true);
  });

  it('does not reload again within the guard window (no reload loop)', () => {
    expect(shouldReloadForChunkError(String(now - 5_000), now)).toBe(false);
  });
});
