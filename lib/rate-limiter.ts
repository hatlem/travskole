import { RateLimiterMemory } from 'rate-limiter-flexible';

// Login rate limiter: 5 attempts per 15 minutes
export const loginLimiter = new RateLimiterMemory({
  points: 5,
  duration: 15 * 60, // 15 minutes
});

// Registration rate limiter: 10 registrations per hour per IP
export const registrationLimiter = new RateLimiterMemory({
  points: 10,
  duration: 60 * 60, // 1 hour
});

// Password reset requests: 3 per hour per IP (email-bombing protection)
export const passwordResetLimiter = new RateLimiterMemory({
  points: 3,
  duration: 60 * 60,
});

// Account creation: 5 per hour per IP
export const signupLimiter = new RateLimiterMemory({
  points: 5,
  duration: 60 * 60,
});

// /api/track IP backstop: 300 requests per 5 min per IP. The per-visitor
// limiter in lib/events/rate-limit.ts is keyed by the (client-supplied)
// bjerke_vid cookie, which a hostile client can freely rotate — this IP-keyed
// limiter is the backstop that survives cookie rotation.
export const trackLimiter = new RateLimiterMemory({
  points: 300,
  duration: 5 * 60,
});

/** Best-effort client IP from proxy headers (Azure/Railway set x-forwarded-for). */
export function getClientIp(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    'unknown'
  );
}

/**
 * Check rate limit and return 429 if exceeded
 */
export async function checkRateLimit(
  limiter: RateLimiterMemory,
  key: string
): Promise<{ allowed: boolean; error?: string }> {
  try {
    await limiter.consume(key);
    return { allowed: true };
  } catch (rateLimiterRes) {
    const msBeforeNext = (rateLimiterRes as { msBeforeNext?: number }).msBeforeNext ?? 1000;
    const retryAfter = Math.round(msBeforeNext / 1000) || 1;
    return {
      allowed: false,
      error: `For mange forsøk. Prøv igjen om ${retryAfter} sekunder.`
    };
  }
}
