import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import logger, { logRateLimitExceeded } from '@/lib/logger';
import { registrationLimiter, checkRateLimit, getClientIp } from '@/lib/rate-limiter';

const MAX_SIZE = 5 * 1024 * 1024; // 5MB

// Magiske byte-signaturer — verifiserer faktisk filinnhold, ikke klientens MIME-streng.
function sniffImageType(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limit selv for admin (stjålet sesjon / misbruk)
  const ip = getClientIp(request.headers);
  const rateLimit = await checkRateLimit(registrationLimiter, `upload:${ip}`);
  if (!rateLimit.allowed) {
    logRateLimitExceeded('/api/upload', ip);
    return NextResponse.json({ error: rateLimit.error }, { status: 429 });
  }

  // Avvis for store opplastinger FØR vi buffrer hele kroppen i minnet
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_SIZE + 1024) {
    return NextResponse.json({ error: 'Filen er for stor. Maks 5MB.' }, { status: 413 });
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

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'Filen er for stor. Maks 5MB.' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // SECURITY: verifiser faktisk filinnhold mot magiske byte — ikke stol på
    // klientens MIME-streng. Må også matche den oppgitte typen.
    const sniffed = sniffImageType(buffer);
    if (!sniffed || sniffed !== file.type) {
      return NextResponse.json({ error: 'Filinnholdet er ikke et gyldig bilde.' }, { status: 400 });
    }

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
