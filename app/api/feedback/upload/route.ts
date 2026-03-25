import { NextRequest, NextResponse } from "next/server";
import logger from "@/lib/logger";

const GETPLATFORM_URL = process.env.GETPLATFORM_URL || "https://control.getplatform.co";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
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
