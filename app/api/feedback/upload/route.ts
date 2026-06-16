import { NextRequest, NextResponse } from "next/server";
import logger, { logRateLimitExceeded } from "@/lib/logger";
import { registrationLimiter, checkRateLimit, getClientIp } from "@/lib/rate-limiter";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

const GETPLATFORM_URL = process.env.GETPLATFORM_URL || "https://control.getplatform.co";

export async function POST(req: NextRequest) {
  try {
    // SECURITY: anonym proxy — begrens misbruk med rate limit + type/størrelse
    const ip = getClientIp(req.headers);
    const rateLimit = await checkRateLimit(registrationLimiter, `feedback:${ip}`);
    if (!rateLimit.allowed) {
      logRateLimitExceeded("/api/feedback/upload", ip);
      return NextResponse.json({ error: rateLimit.error }, { status: 429 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(file.type) || file.size > MAX_SIZE) {
      return NextResponse.json({ error: "Invalid file" }, { status: 400 });
    }

    const gpFormData = new FormData();
    gpFormData.append("file", file);

    const response = await fetch(`${GETPLATFORM_URL}/api/feedback/upload`, {
      method: "POST",
      body: gpFormData,
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }

    const data = await response.json();
    return NextResponse.json({ url: `${GETPLATFORM_URL}${data.url}` });
  } catch (error) {
    logger.error("Upload error", error instanceof Error ? error : undefined);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
