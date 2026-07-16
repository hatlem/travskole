// Leser getcookies-samtykke fra localStorage-payloaden 'getcookies_consent'.
// Format (verifisert mot getcookies widget v2.3.x, src/core/storage.js):
//   { id, timestamp, categories: string[], interaction, version, expiry: epoch-ms }

export function hasAnalyticsConsent(raw: string | null, nowMs: number = Date.now()): boolean {
  if (!raw) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return false;
    const c = parsed as { categories?: unknown; expiry?: unknown };
    if (typeof c.expiry === 'number' && nowMs > c.expiry) return false;
    return Array.isArray(c.categories) && c.categories.includes('analytics');
  } catch {
    return false;
  }
}
