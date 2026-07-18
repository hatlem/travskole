import { describe, it, expect, afterEach, vi } from 'vitest';
import { getBaseUrl } from '@/lib/site';

const PROD = 'https://registrering.bjerke.no';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getBaseUrl', () => {
  it('returnerer NEXTAUTH_URL når satt (ikke-localhost)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXTAUTH_URL', 'https://staging.bjerke.no');
    expect(getBaseUrl()).toBe('https://staging.bjerke.no');
  });

  it('faller tilbake til prod-domenet når NEXTAUTH_URL er usatt', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXTAUTH_URL', '');
    expect(getBaseUrl()).toBe(PROD);
  });

  it('nekter localhost i produksjon (build-tid) og bruker kanonisk domene', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3001');
    expect(getBaseUrl()).toBe(PROD);
  });

  it('nekter 127.0.0.1 i produksjon', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXTAUTH_URL', 'http://127.0.0.1:3001');
    expect(getBaseUrl()).toBe(PROD);
  });

  it('beholder localhost i lokal utvikling', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3001');
    expect(getBaseUrl()).toBe('http://localhost:3001');
  });
});
