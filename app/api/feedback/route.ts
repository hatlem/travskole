import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { sendFeedbackFallbackEmail } from "@/lib/mail";
import { checkRateLimit, feedbackLimiter } from "@/lib/rate-limiter";
import { getClientIpBucket } from "@/lib/client-ip";
import logger from "@/lib/logger";

// Direct Railway origin by default: Cloudflare strips the X-API-Key header on
// control.getplatform.co, which would silently 401 every forwarded submission.
const DEFAULT_GETPLATFORM_URL = "https://get-platform-production.up.railway.app";
const DEFAULT_FALLBACK_EMAIL = "andreas@admirate.no";
const MAX_MESSAGE_LENGTH = 5000;
const MAX_SCREENSHOTS = 5;
// Opplastingen gir en data-URI (GetPlatform lagrer bildet inline); 5 MB bilde ≈ 7 MB base64.
const MAX_SCREENSHOT_LENGTH = 7_500_000;

function isScreenshotUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_SCREENSHOT_LENGTH &&
    (value.startsWith("https://") || value.startsWith("data:image/"))
  );
}

/** Leverer til GetPlatform. Returnerer årsaken hvis det ikke gikk, ellers null. */
async function forwardToGetPlatform(payload: Record<string, unknown>): Promise<string | null> {
  const apiKey = process.env.GETPLATFORM_API_KEY;
  if (!apiKey) return "GETPLATFORM_API_KEY mangler";
  try {
    const response = await fetch(`${process.env.GETPLATFORM_URL || DEFAULT_GETPLATFORM_URL}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return null;
    return `HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`;
  } catch (error) {
    return error instanceof Error ? error.message : "ukjent feil";
  }
}

export async function POST(req: NextRequest) {
  const rl = await checkRateLimit(feedbackLimiter, `feedback:${getClientIpBucket(req.headers)}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: rl.error ?? "For mange forsøk. Prøv igjen senere." }, { status: 429 });
  }

  let body: { message?: unknown; screenshots?: unknown; pageUrl?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE_LENGTH) : "";
  if (!message) {
    return NextResponse.json({ error: "Skriv en tilbakemelding først." }, { status: 400 });
  }
  const screenshots = Array.isArray(body.screenshots)
    ? body.screenshots.filter(isScreenshotUrl).slice(0, MAX_SCREENSHOTS)
    : [];
  const pageUrl =
    (typeof body.pageUrl === "string" && body.pageUrl.trim()) || req.headers.get("referer") || undefined;

  const session = await getServerSession();
  const user = session?.user;

  const failure = await forwardToGetPlatform({
    message,
    platform: "ponniskolen",
    pageUrl,
    userEmail: user?.email || undefined,
    userId: user?.id || undefined,
    userName: user?.name || undefined,
    screenshots,
  });
  if (!failure) return NextResponse.json({ success: true });

  // Feil oppsett hos oss skal aldri koste brukeren tilbakemeldingen: logg høyt og send den på e-post.
  logger.error("Feedback not delivered to GetPlatform, falling back to email", { reason: failure });
  try {
    await sendFeedbackFallbackEmail({
      to: process.env.FEEDBACK_FALLBACK_EMAIL || DEFAULT_FALLBACK_EMAIL,
      message,
      pageUrl,
      screenshots,
      reporterEmail: user?.email || undefined,
      reporterName: user?.name || undefined,
      reason: failure,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Feedback fallback email failed", error instanceof Error ? error : undefined);
    return NextResponse.json({ error: "Tilbakemeldingen ble ikke sendt. Prøv igjen." }, { status: 500 });
  }
}
