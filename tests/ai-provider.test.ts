import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildAnthropicRequest, parseAnthropicResponse, createAnthropicProvider,
} from '@/lib/ai/anthropic';
import {
  buildOpenAiRequest, parseOpenAiResponse, createOpenAiProvider,
} from '@/lib/ai/openai';
import { getLLMProvider, isAiConfigured } from '@/lib/ai/provider';

afterEach(() => { vi.unstubAllEnvs(); });

describe('buildAnthropicRequest', () => {
  it('bygger korrekt Messages API-request', () => {
    const { url, init } = buildAnthropicRequest('Hei', { system: 'Sys', maxTokens: 500, temperature: 0.4 }, { apiKey: 'sk-a', model: 'claude-sonnet-5' });
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-a');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      model: 'claude-sonnet-5', max_tokens: 500, temperature: 0.4,
      system: 'Sys', messages: [{ role: 'user', content: 'Hei' }],
    });
  });
  it('utelater system/temperature når ikke satt, max_tokens default 1024', () => {
    const { init } = buildAnthropicRequest('Hei', {}, { apiKey: 'k', model: 'm' });
    const body = JSON.parse(init.body as string);
    expect(body.max_tokens).toBe(1024);
    expect('system' in body).toBe(false);
    expect('temperature' in body).toBe(false);
  });
});

describe('parseAnthropicResponse', () => {
  it('henter tekst fra content-blokker', () => {
    expect(parseAnthropicResponse({ content: [{ type: 'text', text: 'svar' }] })).toBe('svar');
  });
  it('null for ugyldig form', () => {
    expect(parseAnthropicResponse({ content: [] })).toBe(null);
    expect(parseAnthropicResponse(null)).toBe(null);
    expect(parseAnthropicResponse({ content: [{ type: 'tool_use' }] })).toBe(null);
  });
});

describe('buildOpenAiRequest', () => {
  it('bygger korrekt chat-completions-request med baseUrl', () => {
    const { url, init } = buildOpenAiRequest('Hei', { system: 'Sys' }, { apiKey: 'sk-o', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' });
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-o');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages).toEqual([{ role: 'system', content: 'Sys' }, { role: 'user', content: 'Hei' }]);
  });
  it('trimmer trailing slash i baseUrl', () => {
    const { url } = buildOpenAiRequest('x', {}, { apiKey: 'k', baseUrl: 'https://h/v1/', model: 'm' });
    expect(url).toBe('https://h/v1/chat/completions');
  });
});

describe('parseOpenAiResponse', () => {
  it('henter choices[0].message.content', () => {
    expect(parseOpenAiResponse({ choices: [{ message: { content: 'svar' } }] })).toBe('svar');
  });
  it('null for ugyldig form', () => {
    expect(parseOpenAiResponse({ choices: [] })).toBe(null);
    expect(parseOpenAiResponse(undefined)).toBe(null);
  });
});

describe('createAnthropicProvider (injisert fetch)', () => {
  it('returnerer tekst ved 200', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), { status: 200 }));
    const p = createAnthropicProvider({ apiKey: 'k', model: 'm' }, fetchFn as typeof fetch);
    expect(await p.generateText('hei')).toBe('ok');
  });
  it('null ved ikke-OK status', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{}', { status: 429 }));
    const p = createAnthropicProvider({ apiKey: 'k', model: 'm' }, fetchFn as typeof fetch);
    expect(await p.generateText('hei')).toBe(null);
  });
  it('null når fetch kaster', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('nett'));
    const p = createAnthropicProvider({ apiKey: 'k', model: 'm' }, fetchFn as typeof fetch);
    expect(await p.generateText('hei')).toBe(null);
  });
});

describe('getLLMProvider / isAiConfigured', () => {
  it('null/false uten nøkler', () => {
    vi.stubEnv('AI_PROVIDER', ''); vi.stubEnv('ANTHROPIC_API_KEY', ''); vi.stubEnv('OPENAI_API_KEY', '');
    expect(getLLMProvider()).toBe(null);
    expect(isAiConfigured()).toBe(false);
  });
  it('anthropic som standard når nøkkel finnes', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-a');
    expect(getLLMProvider()).not.toBe(null);
    expect(isAiConfigured()).toBe(true);
  });
  it('openai når AI_PROVIDER=openai og nøkkel finnes', () => {
    vi.stubEnv('AI_PROVIDER', 'openai'); vi.stubEnv('OPENAI_API_KEY', 'sk-o');
    expect(getLLMProvider()).not.toBe(null);
  });
  it('null når valgt leverandørs nøkkel mangler', () => {
    vi.stubEnv('AI_PROVIDER', 'openai'); vi.stubEnv('OPENAI_API_KEY', ''); vi.stubEnv('ANTHROPIC_API_KEY', 'sk-a');
    expect(getLLMProvider()).toBe(null);
  });
});
