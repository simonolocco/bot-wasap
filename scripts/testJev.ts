import assert from 'node:assert/strict';
import { buildJevSimulationRequest, evaluateJevMessage, JEV_MODEL, JevServiceError, JevSimulationLimiter } from '../src/services/jevSimulator';

async function main() {
  const request = buildJevSimulationRequest('Necesito saber cuándo llega mi pedido.');
  assert.equal(request.model, 'typesafe/jev-1.13');
  assert.equal(request.state.language, 'Spanish (Argentina)');
  assert.equal(request.questions.intent.type, 'choice');
  assert.equal(request.questions.urgency.type, 'score');
  assert.equal(request.questions.human_attention.type, 'noul');
  assert.equal(JEV_MODEL, request.model);

  const limiter = new JevSimulationLimiter(2, 1000);
  const firstClaim = limiter.acquire('session-a', 0);
  assert.equal(firstClaim.allowed, true);
  const busyClaim = limiter.acquire('session-a', 1);
  assert.deepEqual(busyClaim, { allowed: false, reason: 'busy', retryAfterSeconds: 2 });
  if (firstClaim.allowed) firstClaim.release();
  const secondClaim = limiter.acquire('session-a', 10);
  assert.equal(secondClaim.allowed, true);
  if (secondClaim.allowed) secondClaim.release();
  const limitedClaim = limiter.acquire('session-a', 20);
  assert.deepEqual(limitedClaim, { allowed: false, reason: 'rate', retryAfterSeconds: 1 });
  assert.equal(limiter.acquire('session-a', 1001).allowed, true);

  let requestedUrl = '';
  let requestedInit: RequestInit | undefined;
  const mockResponse = {
    id: 'gen-dec-test',
    model: 'typesafe/jev-1.13-20260917',
    provider: 'TypeSafe',
    answers: {
      intent: { type: 'choice', choice: 'delivery', probabilities: { delivery: .92, other: .08 }, confidence: .88 },
      urgency: { type: 'score', score: .7, probabilities: { 0: .3, 1: .7, 2: 0 }, confidence: .58, legend: { 0: 'Puede esperar', 1: 'Pronto', 2: 'Inmediato' } },
      human_attention: { type: 'noul', noul: .18 },
    },
    usage: { input_tokens: 420, output_tokens: 40, cost: .00001764 },
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedInit = init;
    return new Response(JSON.stringify(mockResponse), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await evaluateJevMessage('Necesito saber cuándo llega mi pedido.', { apiKey: 'test-key', fetchImpl, timeoutMs: 500 });
  assert.equal(requestedUrl, 'https://openrouter.ai/api/v1/systemone');
  assert.equal(requestedInit?.method, 'POST');
  assert.equal((requestedInit?.headers as Record<string, string>).Authorization, 'Bearer test-key');
  assert.equal(result.answers.intent.choice, 'delivery');
  assert.equal(result.usage.input_tokens, 420);
  assert.ok(result.elapsedMs >= 0);

  const minimalOfficialResponse = {
    model: 'jev-1.13.0',
    answers: {
      intent: { type: 'choice', choice: 'delivery' },
      urgency: { type: 'score', score: 1.25 },
      human_attention: { type: 'noul', noul: .35 },
    },
    usage: { input_tokens: 420, output_tokens: 40 },
  };
  const minimalResult = await evaluateJevMessage('Mensaje de prueba', {
    apiKey: 'test-key',
    timeoutMs: 500,
    fetchImpl: async () => new Response(JSON.stringify(minimalOfficialResponse), { status: 200 }),
  });
  assert.equal(minimalResult.model, 'jev-1.13.0');
  assert.equal(minimalResult.usage.cost, null);
  assert.equal(minimalResult.answers.intent.confidence, null);
  assert.deepEqual(minimalResult.answers.intent.probabilities, {});
  assert.deepEqual(minimalResult.answers.urgency.legend, { 0: 'Puede esperar', 1: 'Atender pronto', 2: 'Atención inmediata' });

  await assert.rejects(
    () => evaluateJevMessage('Mensaje de prueba', { apiKey: '   ', fetchImpl }),
    (error: unknown) => error instanceof JevServiceError && error.status === 503,
  );

  for (const transientStatus of [502, 503, 504, 524, 529]) {
    let transientAttempts = 0;
    const retried = await evaluateJevMessage('Mensaje de prueba', {
      apiKey: 'test-key',
      timeoutMs: 500,
      fetchImpl: async () => {
        transientAttempts += 1;
        return transientAttempts === 1
          ? new Response('', { status: transientStatus })
          : new Response(JSON.stringify(minimalOfficialResponse), { status: 200 });
      },
    });
    assert.equal(transientAttempts, 2);
    assert.equal(retried.answers.intent.choice, 'delivery');
  }

  await assert.rejects(
    () => evaluateJevMessage('Mensaje de prueba', {
      apiKey: 'test-key',
      timeoutMs: 500,
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 }),
    }),
    (error: unknown) => error instanceof JevServiceError && error.status === 429 && /demasiadas solicitudes/i.test(error.message),
  );

  await assert.rejects(
    () => evaluateJevMessage('Mensaje de prueba', {
      apiKey: 'test-key',
      timeoutMs: 500,
      fetchImpl: async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
    }),
    (error: unknown) => error instanceof JevServiceError && error.status === 502,
  );

  await assert.rejects(
    () => evaluateJevMessage('Mensaje de prueba', {
      apiKey: 'test-key',
      timeoutMs: 5,
      fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      }),
    }),
    (error: unknown) => error instanceof JevServiceError && error.status === 504,
  );

  await assert.rejects(
    () => evaluateJevMessage('Mensaje de prueba', {
      apiKey: 'test-key',
      timeoutMs: 500,
      fetchImpl: async () => new Response(JSON.stringify({
        ...minimalOfficialResponse,
        answers: { ...minimalOfficialResponse.answers, human_attention: { type: 'noul', noul: 1.2 } },
      }), { status: 200 }),
    }),
    (error: unknown) => error instanceof JevServiceError && error.status === 502,
  );

  console.log('Jev simulator tests passed');
}

void main();
