// Tynn fetch-basert OpenAI-kompatibel chat-completions-klient. baseUrl kan
// overstyres, så enhver OpenAI-kompatibel vert dekkes. Aldri throw: null ved feil.
import logger from '@/lib/logger';
import type { LLMGenerateOpts, LLMProvider } from './provider';

export interface OpenAiConfig { apiKey: string; baseUrl: string; model: string }

const TIMEOUT_MS = 10_000;

export function buildOpenAiRequest(
  prompt: string, opts: LLMGenerateOpts, config: OpenAiConfig,
): { url: string; init: RequestInit } {
  const messages: { role: string; content: string }[] = [];
  if (opts.system !== undefined) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content: prompt });
  const body: Record<string, unknown> = { model: config.model, messages };
  if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  return {
    url: `${config.baseUrl.replace(/\/$/, '')}/chat/completions`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(body),
    },
  };
}

export function parseOpenAiResponse(json: unknown): string | null {
  if (json === null || typeof json !== 'object') return null;
  const choices = (json as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: { content?: unknown } })?.message;
  return typeof message?.content === 'string' ? message.content : null;
}

export function createOpenAiProvider(config: OpenAiConfig, fetchFn: typeof fetch = fetch): LLMProvider {
  return {
    async generateText(prompt, opts = {}) {
      try {
        const { url, init } = buildOpenAiRequest(prompt, opts, config);
        const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) {
          logger.error('OpenAI-kall feilet', { status: res.status });
          return null;
        }
        return parseOpenAiResponse(await res.json());
      } catch (error) {
        logger.error('OpenAI-kall kastet feil', { error: error instanceof Error ? error.message : String(error) });
        return null;
      }
    },
  };
}
