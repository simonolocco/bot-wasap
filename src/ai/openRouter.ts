export type Completion = { content: string; tokens: number; model: string };
export class AiProviderError extends Error {
  constructor(public code: 'credentials' | 'credit' | 'rate_limit' | 'daily_limit' | 'provider' | 'timeout', message: string) { super(message); }
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
    const timeoutMs = options.timeoutMs ?? config.timeoutMs ?? (options.pdf ? 45_000 : 25_000);
    const signal = AbortSignal.timeout(timeoutMs);
    const request = () => (config.fetcher ?? fetch)('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json', 'X-Title': 'AbastoBot - prueba local' },
      body: JSON.stringify({
        model: config.model, messages, temperature: 0,
        // Do not force a provider: the preview can use different OpenRouter
        // models (including Gemini) and each model has its own provider set.
        // OpenRouter will select a compatible provider and fall back if needed.
        provider: { allow_fallbacks: true, require_parameters: true },
        max_tokens: options.maxTokens ?? 1200,
        response_format: options.schema ? { type: 'json_schema', json_schema: { name: 'abasto_intent', strict: true, schema: options.schema } } : { type: 'json_object' },
        ...(options.pdf ? { plugins: [{ id: 'file-parser', pdf: { engine: 'cloudflare-ai' } }] } : {}),
      }),
    });
    // One retry for transient transport/provider failures, within the same
    // deadline. Never retry exhausted credit or rotate keys to evade limits.
    let response: Response;
    try {
      try { response = await request(); }
      catch (error) {
        if (signal.aborted) throw error;
        response = await request();
      }
      if ([502, 503, 504].includes(response.status)) {
        await response.body?.cancel();
        response = await request();
      }
    } catch {
      throw new AiProviderError(signal.aborted ? 'timeout' : 'provider', signal.aborted
        ? 'La consulta tardó demasiado. Reintentá en unos instantes.'
        : 'No se pudo conectar con la IA. Reintentá en unos instantes.');
    }
    // Inspect only the known quota discriminator; never expose provider bodies,
    // which can include request details or credentials.
    if (response.status === 429) {
      let daily = false;
      try {
        const body = await response.json() as any;
        daily = body.error?.metadata?.limit_source === 'openrouter_free_tier_daily'
          || String(body.error?.message ?? '').includes('free-models-per-day');
      } catch { /* Generic throttling remains actionable without a JSON body. */ }
      throw new AiProviderError(daily ? 'daily_limit' : 'rate_limit', daily
        ? 'Se agotó la cuota diaria del modelo gratuito. Esperá su renovación o configurá otro modelo.'
        : 'OpenRouter está limitando las consultas. Reintentá en unos instantes.');
    }
    // Do not expose provider bodies: errors can contain request details.
    if (!response.ok) throw new AiProviderError(response.status === 401 ? 'credentials' : response.status === 402 ? 'credit' : response.status === 429 ? 'rate_limit' : 'provider', response.status === 401 ? 'La clave de OpenRouter no fue aceptada.'
      : response.status === 402 ? 'OpenRouter necesita saldo disponible.'
      : response.status === 429 ? 'OpenRouter está limitando las consultas. Reintentá en unos instantes.'
      : `OpenRouter no pudo completar la consulta (${response.status}).`);
    let body: any;
    try { body = await response.json(); }
    catch { throw new AiProviderError(signal.aborted ? 'timeout' : 'provider', 'La IA no devolvió una respuesta completa.'); }
    const choice = body.choices?.[0];
    if (body.error || choice?.finish_reason !== 'stop' || typeof choice?.message?.content !== 'string') {
      throw new AiProviderError('provider', 'La IA no devolvió una respuesta completa.');
    }
    return { content: choice.message.content, tokens: Number(body.usage?.total_tokens ?? 0), model: body.model ?? config.model };
  };
}

export function parseJson(content: string): unknown {
  return JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
}
