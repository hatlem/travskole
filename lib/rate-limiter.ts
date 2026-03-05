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
  } catch (rateLimiterRes: any) {
    const retryAfter = Math.round(rateLimiterRes.msBeforeNext / 1000) || 1;
    return {
      allowed: false,
      error: `For mange forsøk. Prøv igjen om ${retryAfter} sekunder.`
    };
  }
}
