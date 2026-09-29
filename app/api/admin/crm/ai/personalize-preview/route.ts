import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { getLLMProvider } from '@/lib/ai/provider';
import { previewPersonalization } from '@/lib/ai/preview';
import { sanitizeLegalHtml } from '@/lib/sanitize';
import { logActivity } from '@/lib/activity';

export const dynamic = 'force-dynamic';

const schema = z.object({
  flowId: z.number().int().positive(),
  contactId: z.number().int().positive(),
  subject: z.string().max(500),
  bodyHtml: z.string().min(1, 'Innhold er påkrevd').max(20000),
});

/** Kjører personaliseringen for én kontakt uten å sende noe. */
export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const provider = getLLMProvider();
  if (!provider) return NextResponse.json({ error: 'KI er ikke konfigurert' }, { status: 503 });

  const { flowId, contactId, subject, bodyHtml } = parsed.data;
  const preview = await previewPersonalization(provider, contactId, subject, bodyHtml);
  if (!preview) return NextResponse.json({ error: 'Kontakten finnes ikke' }, { status: 404 });

  logActivity({
    action: 'ai_personalize_preview', entity: 'flow', entityId: flowId,
    details: JSON.stringify({ contactId, ok: preview.verdict.ok }), userEmail: session.user.email,
  }).catch(() => {});

  return NextResponse.json({
    contact: preview.contact,
    subject: preview.subject,
    originalHtml: sanitizeLegalHtml(preview.originalBody),
    personalizedHtml: preview.personalizedBody !== null ? sanitizeLegalHtml(preview.personalizedBody) : null,
    verdict: preview.verdict,
    factLines: preview.factLines,
  });
}
