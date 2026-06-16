import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import logger from '@/lib/logger';

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'Ingen fil valgt' }, { status: 400 });
    }

    // SECURITY: utvidelsen avledes fra validert MIME-type — aldri fra klientens
    // filnavn (et «bilde» kalt x.html ville ellers blitt servert som HTML).
    const extByType: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
    };
    const ext = extByType[file.type];
    if (!ext) {
      return NextResponse.json({ error: 'Ugyldig filtype. Kun JPG, PNG og WebP er tillatt.' }, { status: 400 });
    }

    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      return NextResponse.json({ error: 'Filen er for stor. Maks 5MB.' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;

    // UPLOAD_DIR (e.g. /home/data/uploads on Azure) survives redeploys —
    // wwwroot is wiped by zipdeploy. Falls back to public/images for local dev.
    const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'public', 'images');
    await mkdir(uploadDir, { recursive: true });

    const filepath = path.join(uploadDir, filename);
    await writeFile(filepath, buffer);

    return NextResponse.json({ url: `/images/${filename}` }, { status: 201 });
  } catch (error) {
    logger.error('Upload error', { error });
    return NextResponse.json({ error: 'Kunne ikke laste opp fil' }, { status: 500 });
  }
}
