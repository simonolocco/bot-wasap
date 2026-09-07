export type Completion = { content: string; tokens: number; model: string };
export class AiProviderError extends Error {
  constructor(public code: 'credentials' | 'credit' | 'rate_limit' | 'provider', message: string) { super(message); }
}
export type Complete = (messages: Array<{ role: string; content: unknown }>, options?: {
  maxTokens?: number; pdf?: boolean; schema?: Record<string, unknown>; timeoutMs?: number;
}) => Promise<Completion>;

/** No SDK globals or database imports: the preview can run without WhatsApp credentials. */
export function createOpenRouterClient(config: {
  key: string; model: string; timeoutMs?: number; fetcher?: typeof fetch;
}): Complete {
  return async (messages, options = {}) => {
    if (!config.key.trim()) throw new AiProviderError('credentials', 'Falta configurar OPENROUTER_API_KEY.');
    const response = await (config.fetcher ?? fetch)('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(config.timeoutMs ?? options.timeoutMs ?? (options.pdf ? 180_000 : 25_000)),
      headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json', 'X-Title': 'AbastoBot - prueba local' },
      body: JSON.stringify({
        model: config.model, messages, temperature: 0,
        provider: { order: ['Groq'], allow_fallbacks: true, require_parameters: true },
        max_tokens: options.maxTokens ?? 1200,
        reasoning: { effort: 'low', exclude: true },
        response_format: options.schema ? { type: 'json_schema', json_schema: { name: 'abasto_intent', strict: true, schema: options.schema } } : { type: 'json_object' },
        ...(options.pdf ? { plugins: [{ id: 'file-parser', pdf: { engine: 'cloudflare-ai' } }] } : {}),
      }),
    });
    // Do not expose provider bodies: errors can contain request details.
    if (!response.ok) throw new AiProviderError(response.status === 401 ? 'credentials' : response.status === 402 ? 'credit' : response.status === 429 ? 'rate_limit' : 'provider', response.status === 401 ? 'La clave de OpenRouter no fue aceptada.'
      : response.status === 402 ? 'OpenRouter necesita saldo disponible.'
      : response.status === 429 ? 'OpenRouter está limitando las consultas. Reintentá en unos instantes.'
      : `OpenRouter no pudo completar la consulta (${response.status}).`);
    const body = await response.json() as any;
    const choice = body.choices?.[0];
    if (body.error || choice?.finish_reason !== 'stop' || typeof choice?.message?.content !== 'string') {
      throw new Error('La IA no devolvió una respuesta completa.');
    }
    return { content: choice.message.content, tokens: Number(body.usage?.total_tokens ?? 0), model: body.model ?? config.model };
  };
}

export function parseJson(content: string): unknown {
  return JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
}
