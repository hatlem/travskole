// Tynn fetch-basert Anthropic Messages API-klient — ingen SDK-avhengighet
// (samme mønster som lib/payments/vipps.ts). Aldri throw utad: null ved feil.
import logger from '@/lib/logger';
import type { LLMGenerateOpts, LLMProvider } from './provider';

export interface AnthropicConfig { apiKey: string; model: string }

const TIMEOUT_MS = 10_000;

export function buildAnthropicRequest(
  prompt: string, opts: LLMGenerateOpts, config: AnthropicConfig,
): { url: string; init: RequestInit } {
  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: opts.maxTokens ?? 1024,
    messages: [{ role: 'user', content: prompt }],
  };
  if (opts.system !== undefined) body.system = opts.system;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  return {
    url: 'https://api.anthropic.com/v1/messages',
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    },
  };
}

export function parseAnthropicResponse(json: unknown): string | null {
  if (json === null || typeof json !== 'object') return null;
  const content = (json as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const block = content.find(
    (b): b is { type: string; text: string } =>
      b !== null && typeof b === 'object' && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string',
  );
  return block?.text ?? null;
}

export function createAnthropicProvider(config: AnthropicConfig, fetchFn: typeof fetch = fetch): LLMProvider {
  return {
    async generateText(prompt, opts = {}) {
      try {
        const { url, init } = buildAnthropicRequest(prompt, opts, config);
        const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) {
          logger.error('Anthropic-kall feilet', { status: res.status });
          return null;
        }
        return parseAnthropicResponse(await res.json());
      } catch (error) {
        logger.error('Anthropic-kall kastet feil', { error: error instanceof Error ? error.message : String(error) });
        return null;
      }
    },
  };
}
