import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

// Serves admin-uploaded images from UPLOAD_DIR (persistent storage on Azure).
// Static files in public/images are served by Next directly and never reach
// this route — it only handles uploads that live outside wwwroot.

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const uploadDir = process.env.UPLOAD_DIR;
  if (!uploadDir) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { filename } = await params;
  // Prevent path traversal — only bare filenames are valid
  const safeName = path.basename(filename);
  const contentType = CONTENT_TYPES[path.extname(safeName).toLowerCase()];
  if (safeName !== filename || !contentType) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const file = await readFile(path.join(uploadDir, safeName));
    return new NextResponse(new Uint8Array(file), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
