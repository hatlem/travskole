// KI-leverandørvalg — konfigurasjonsstyrt (samme degraderingskontrakt som
// Stripe/Vipps): ingen nøkkel ⇒ null ⇒ alle KI-funksjoner er usynlige/no-op.
// All KI er server-side; nøkler når aldri klienten.
import { createAnthropicProvider } from './anthropic';
import { createOpenAiProvider } from './openai';

export interface LLMGenerateOpts { system?: string; maxTokens?: number; temperature?: number }
export interface LLMProvider {
  generateText(prompt: string, opts?: LLMGenerateOpts): Promise<string | null>;
}

export function getLLMProvider(): LLMProvider | null {
  const provider = process.env.AI_PROVIDER || 'anthropic';
  if (provider === 'openai') {
    if (!process.env.OPENAI_API_KEY) return null;
    return createOpenAiProvider({
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    });
  }
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return createAnthropicProvider({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
  });
}

export function isAiConfigured(): boolean {
  return getLLMProvider() !== null;
}
