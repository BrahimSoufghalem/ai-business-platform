import { describe, expect, it } from 'vitest';
import type { AiProviderRequest } from '../src/index.js';
import { OpenAiCompatibleProvider } from '../src/index.js';

const request: AiProviderRequest = {
  runId: 'run-1',
  tenantId: 'tenant-1',
  task: 'compose',
  intent: 'faq',
  model: 'model-a',
  prompt: {
    id: 'faq',
    task: 'compose',
    version: 'v3',
    systemInstruction: 'Answer only from grounded facts.',
  },
  input: {
    trust: 'untrusted_content',
    value: { question: 'When do you open?' },
  },
  toolResults: [],
  tools: [
    {
      name: 'find_knowledge',
      description: 'Find published knowledge.',
      kind: 'read',
      inputJsonSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
      },
    },
  ],
  outputSchemaName: 'faq_reply',
  outputJsonSchema: {
    type: 'object',
    properties: { reply: { type: 'string' } },
  },
  maximumOutputTokens: 200,
};

describe('OpenAI-compatible provider adapter', () => {
  it('maps provider-neutral contracts to JSON schema mode without leaking the key', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const provider = new OpenAiCompatibleProvider({
      name: 'primary',
      baseUrl: 'http://localhost:4000/v1',
      apiKey: 'test-provider-secret',
      fetchImplementation: async (url, init) => {
        capturedUrl = String(url);
        capturedInit = init;
        return new Response(
          JSON.stringify({
            id: 'provider-request-1',
            choices: [{ message: { content: '{"reply":"We open at 09:00."}' } }],
            usage: { prompt_tokens: 41, completion_tokens: 9 },
          }),
          { status: 200 },
        );
      },
    });
    const response = await provider.complete(request, new AbortController().signal);
    expect(response).toEqual({
      kind: 'output',
      output: { reply: 'We open at 09:00.' },
      providerRequestId: 'provider-request-1',
      usage: { inputTokens: 41, outputTokens: 9 },
    });
    expect(capturedUrl).toBe('http://localhost:4000/v1/chat/completions');
    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'model-a',
      response_format: {
        type: 'json_schema',
      },
    });
    expect(String(capturedInit?.body)).not.toContain('test-provider-secret');
    expect((capturedInit?.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-provider-secret',
    );
  });

  it('returns tool calls as data for registry validation', async () => {
    const provider = new OpenAiCompatibleProvider({
      baseUrl: 'http://localhost:4000/v1',
      apiKey: 'secret',
      fetchImplementation: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      id: 'call-1',
                      function: {
                        name: 'find_knowledge',
                        arguments: '{"query":"hours"}',
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 20, completion_tokens: 5 },
          }),
          { status: 200 },
        ),
    });
    expect(await provider.complete(request, new AbortController().signal)).toEqual({
      kind: 'tool_calls',
      calls: [{ id: 'call-1', name: 'find_knowledge', arguments: { query: 'hours' } }],
      providerRequestId: null,
      usage: { inputTokens: 20, outputTokens: 5 },
    });
  });

  it('reports only a safe status code for provider HTTP failures', async () => {
    const provider = new OpenAiCompatibleProvider({
      baseUrl: 'http://localhost:4000/v1',
      apiKey: 'never-log-me',
      fetchImplementation: async () =>
        new Response('upstream includes never-log-me', { status: 429 }),
    });
    await expect(provider.complete(request, new AbortController().signal)).rejects.toThrow(
      'provider_http_429',
    );
  });
});
