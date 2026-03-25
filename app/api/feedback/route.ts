import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import logger from "@/lib/logger";

const GETPLATFORM_URL = process.env.GETPLATFORM_URL || "https://control.getplatform.co";
const GETPLATFORM_API_KEY = process.env.GETPLATFORM_API_KEY;

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    const { message, screenshots, pageUrl: bodyPageUrl } = await req.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const pageUrl = bodyPageUrl || req.headers.get("referer") || undefined;

    if (GETPLATFORM_API_KEY) {
      const response = await fetch(`${GETPLATFORM_URL}/api/feedback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": GETPLATFORM_API_KEY,
        },
        body: JSON.stringify({
          message: message.trim(),
          platform: "ponniskolen",
          pageUrl,
          userEmail: session?.user?.email || undefined,
          userId: session?.user?.id || undefined,
          userName: session?.user?.name || undefined,
          screenshots: Array.isArray(screenshots) ? screenshots : [],
        }),
      });

      if (!response.ok) {
        logger.error("Failed to send feedback", { responseText: await response.text() });
        return NextResponse.json({ error: "Failed to send feedback" }, { status: 500 });
      }

      const data = await response.json();
      return NextResponse.json({ success: true, id: data.id });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Feedback error", error instanceof Error ? error : undefined);
    return NextResponse.json({ error: "Failed to send feedback" }, { status: 500 });
  }
}
