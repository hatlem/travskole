import { RateLimiterMemory } from 'rate-limiter-flexible';

// Login rate limiter: 5 attempts per 15 minutes per client IP + email
export const loginLimiter = new RateLimiterMemory({
  points: 5,
  duration: 15 * 60, // 15 minutes
});

// Per-account cap independent of the client IP: 10 attempts per 15 minutes per
// email (unknown emails count too, so it reveals nothing); a successful login
// clears it. Without it, rotating addresses gives unlimited guesses.
export const loginAccountLimiter = new RateLimiterMemory({
  points: 10,
  duration: 15 * 60,
});

// Registration rate limiter: 10 registrations per hour per IP
export const registrationLimiter = new RateLimiterMemory({
  points: 10,
  duration: 60 * 60, // 1 hour
});

/*
 * Én limiter per handling, så f.eks. en innlogget passordbytting ikke spiser
 * kvoten for magic link. Minnebasert: tellerne er per prosess og nullstilles
 * ved omstart — tilstrekkelig for én instans, men må flyttes til en delt
 * lagring (Redis/Postgres) om appen skaleres ut.
 */
const HOUR = 60 * 60;

// Uautentiserte e-postutsendelser: stramt per IP+e-post (hindrer e-postbombing
// av én adresse), romsligere per IP (tak mot enumerering/spam på tvers).
export const magicLinkEmailLimiter = new RateLimiterMemory({ points: 3, duration: HOUR });
export const magicLinkIpLimiter = new RateLimiterMemory({ points: 10, duration: HOUR });
export const passwordResetEmailLimiter = new RateLimiterMemory({ points: 3, duration: HOUR });
export const passwordResetIpLimiter = new RateLimiterMemory({ points: 10, duration: HOUR });

// Innløsning av e-postbytte-token (tokenet er uforutsigbart): per IP.
export const confirmEmailLimiter = new RateLimiterMemory({ points: 10, duration: 15 * 60 });

// Innloggede kontohandlinger, nøklet på bruker-id. Passordbytte og sletting
// verifiserer nåværende passord → brems gjetting; e-postbytte sender e-post.
export const passwordChangeLimiter = new RateLimiterMemory({ points: 5, duration: 15 * 60 });
export const emailChangeLimiter = new RateLimiterMemory({ points: 5, duration: HOUR });
export const accountDeleteLimiter = new RateLimiterMemory({ points: 5, duration: 15 * 60 });

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

/** Nøkkel for per-IP+e-post-limitere (e-posten normaliseres). */
export function ipEmailKey(ip: string, email: string): string {
  return `${ip}:${email.trim().toLowerCase()}`;
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
