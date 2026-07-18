import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { getLLMProvider } from '@/lib/ai/provider';
import { validateAiRewrite } from '@/lib/ai/guardrails';
import {
  assistSystemPrompt, subjectVariantsPrompt, toneRewritePrompt, shortenPrompt, parseSubjectVariants,
} from '@/lib/ai/prompts';

const schema = z.object({
  kind: z.enum(['subject_variants', 'tone', 'shorten']),
  subject: z.string().max(500),
  bodyHtml: z.string().min(1, 'Innhold er påkrevd').max(20000),
  tone: z.enum(['formell', 'vennlig', 'kort']).optional(),
});

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
  const { kind, subject, bodyHtml, tone } = parsed.data;

  const provider = getLLMProvider();
  if (!provider) return NextResponse.json({ error: 'KI er ikke konfigurert' }, { status: 503 });

  const system = assistSystemPrompt();

  if (kind === 'subject_variants') {
    const raw = await provider.generateText(subjectVariantsPrompt(subject, bodyHtml), { system, maxTokens: 300, temperature: 0.8 });
    if (!raw) return NextResponse.json({ error: 'KI-tjenesten svarte ikke — prøv igjen' }, { status: 502 });
    const suggestions = parseSubjectVariants(raw);
    if (suggestions.length === 0) return NextResponse.json({ error: 'KI-tjenesten svarte ikke — prøv igjen' }, { status: 502 });
    return NextResponse.json({ suggestions });
  }

  const prompt = kind === 'tone' ? toneRewritePrompt(bodyHtml, tone ?? 'vennlig') : shortenPrompt(bodyHtml);
  const raw = await provider.generateText(prompt, { system, maxTokens: 2000, temperature: 0.4 });
  if (!raw) return NextResponse.json({ error: 'KI-tjenesten svarte ikke — prøv igjen' }, { status: 502 });
  const verdict = validateAiRewrite(bodyHtml, raw.trim());
  if (!verdict.ok) {
    return NextResponse.json({ error: 'KI-forslaget ble avvist av sikkerhetskontrollen — prøv igjen' }, { status: 422 });
  }
  return NextResponse.json({ result: raw.trim() });
}
