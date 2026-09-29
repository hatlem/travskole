// Én vei for per-mottaker-personalisering: brukes av utsending, forhåndsvisning
// og test-utsending, så admin ser nøyaktig det mottakeren ville fått.
// Kaster aldri: enhver feil blir { ok: false } og kalleren sender originalen.
import logger from '@/lib/logger';
import type { LLMProvider } from './provider';
import { personalizePrompt, stripCodeFences } from './prompts';
import { validateAiRewrite } from './guardrails';
import { buildRecipientContext } from './history';

export type PersonalizeOutcome =
  | { ok: true; body: string; factLines: string[] }
  | { ok: false; reason: string; factLines: string[] };

/** Kjører modellen på en ferdig rendret kropp med gitt kontekst og validerer svaret. */
export async function personalizeWithContext(
  provider: LLMProvider,
  renderedBody: string,
  contextText: string,
): Promise<{ ok: true; body: string } | { ok: false; reason: string }> {
  const raw = await provider.generateText(personalizePrompt(renderedBody, contextText), {
    maxTokens: 2000,
    temperature: 0.5,
  });
  if (!raw) return { ok: false, reason: 'ingen respons fra KI' };
  const body = stripCodeFences(raw);
  const verdict = validateAiRewrite(renderedBody, body, {
    requireContentPreserved: true,
    factSource: contextText,
  });
  return verdict.ok ? { ok: true, body } : { ok: false, reason: verdict.reason };
}

export async function personalizeForContact(
  provider: LLMProvider,
  contactId: number,
  renderedBody: string,
): Promise<PersonalizeOutcome> {
  let factLines: string[] = [];
  try {
    const context = await buildRecipientContext(contactId);
    if (!context) return { ok: false, reason: 'kontakten finnes ikke', factLines };
    factLines = context.factLines;
    const result = await personalizeWithContext(provider, renderedBody, context.contextText);
    return { ...result, factLines };
  } catch (error) {
    logger.error('KI-personalisering kastet feil', {
      contactId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: 'teknisk feil', factLines };
  }
}
