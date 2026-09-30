import { describe, it, expect } from 'vitest';
import { getSafeCallbackUrl, postLoginDestination } from '@/lib/auth-redirect';

describe('getSafeCallbackUrl', () => {
  it('godtar relative stier', () => {
    expect(getSafeCallbackUrl('/mine-bookinger')).toBe('/mine-bookinger');
    expect(getSafeCallbackUrl('/arrangementer/kurs/2026/x/pamelding?a=1')).toBe('/arrangementer/kurs/2026/x/pamelding?a=1');
  });

  it('avviser eksterne og protokoll-relative URL-er', () => {
    expect(getSafeCallbackUrl('https://evil.example')).toBeNull();
    expect(getSafeCallbackUrl('//evil.example')).toBeNull();
    expect(getSafeCallbackUrl('/\\evil.example')).toBeNull();
    expect(getSafeCallbackUrl(null)).toBeNull();
  });

  it('avviser /login for å unngå redirect-løkker', () => {
    expect(getSafeCallbackUrl('/login')).toBeNull();
    expect(getSafeCallbackUrl('/login?registered=true')).toBeNull();
  });
});

describe('postLoginDestination', () => {
  it('bruker callbackUrl når den er trygg', () => {
    expect(postLoginDestination('/mine-bookinger', 'user')).toBe('/mine-bookinger');
  });

  it('faller tilbake på rolle', () => {
    expect(postLoginDestination(null, 'user')).toBe('/dashboard');
    expect(postLoginDestination(null, 'admin')).toBe('/admin');
    expect(postLoginDestination('https://evil.example', 'superadmin')).toBe('/admin');
  });
});
