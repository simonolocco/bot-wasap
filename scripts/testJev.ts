import assert from 'node:assert/strict';
import {
  buildJevSimulationRequest,
  evaluateJevMessage,
  JEV_CURRENT_MESSAGE_MAX_CHARS,
  JEV_DECISIONS_URL,
  JEV_HISTORY_MAX_MESSAGE_CHARS,
  JEV_HISTORY_MAX_MESSAGES,
  JEV_HISTORY_MAX_TOTAL_CHARS,
  JEV_MODEL,
  JEV_RESPONSE_TYPES,
  JevServiceError,
  JevSimulationLimiter,
  normalizeJevHistory,
  shouldRouteToProductAdvisor,
  type JevHistoryMessage,
} from '../src/services/jevSimulator';
import { resolveJevCustomerResponse } from '../src/ai/jevResponse';

const completeOfficialResponse = {
  id: 'gen-dec-test',
  model: 'typesafe/jev-1.13-20260917',
  provider: 'TypeSafe',
  answers: {
    response_type: {
      type: 'choice',
      choice: 'shipping',
      probabilities: { shipping: .92, unclear: .08 },
      confidence: .88,
    },
    urgency: {
      type: 'score',
      score: .7,
      probabilities: { 0: .3, 1: .7, 2: 0 },
      confidence: .58,
      legend: { 0: 'Puede esperar', 1: 'Pronto', 2: 'Inmediato' },
    },
    human_attention: { type: 'noul', noul: .18 },
  },
  usage: { inputTokens: 420, outputTokens: 40, cost: .00001764 },
};

const minimalOfficialResponse = {
  model: 'typesafe/jev-1.13-20260917',
  answers: {
    response_type: { type: 'choice', choice: 'shipping' },
    urgency: { type: 'score', score: 1.25 },
    human_attention: { type: 'noul', noul: .35 },
  },
  usage: { inputTokens: 420, outputTokens: 40 },
};

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

async function main() {
  const history: JevHistoryMessage[] = [
    { role: 'user', content: 'Hola, hice un pedido ayer.' },
    { role: 'assistant', content: '¿En qué podemos ayudarte?' },
  ];
  const request = buildJevSimulationRequest('  Necesito saber cuándo llega.  ', history);
  assert.equal(request.model, JEV_MODEL);
  assert.equal(request.state.current_message, 'Necesito saber cuándo llega.');
  assert.deepEqual(request.state.recent_conversation, [
    { role: 'customer', content: 'Hola, hice un pedido ayer.' },
    { role: 'assistant', content: '¿En qué podemos ayudarte?' },
  ]);
  assert.equal(request.state.language, 'Spanish (Argentina)');
  assert.equal(request.questions.response_type.type, 'choice');
  assert.deepEqual(Object.keys(request.questions.response_type.criteria), [...JEV_RESPONSE_TYPES]);
  assert.equal(request.questions.urgency.type, 'score');
  assert.equal(request.questions.human_attention.type, 'noul');

  const oversizedHistory: JevHistoryMessage[] = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'customer',
    content: `${index}: ${'x'.repeat(1_200)}`,
  }));
  const boundedHistory = normalizeJevHistory(oversizedHistory);
  assert.ok(boundedHistory.length <= JEV_HISTORY_MAX_MESSAGES);
  assert.ok(boundedHistory.every(item => item.content.length <= JEV_HISTORY_MAX_MESSAGE_CHARS));
  assert.ok(boundedHistory.reduce((total, item) => total + item.content.length, 0) <= JEV_HISTORY_MAX_TOTAL_CHARS);
  assert.ok(boundedHistory[boundedHistory.length - 1]?.content.startsWith('19:'));
  assert.ok(!boundedHistory.some(item => item.content.startsWith('0:')));
  assert.equal(buildJevSimulationRequest('x'.repeat(5_000)).state.current_message.length, JEV_CURRENT_MESSAGE_MAX_CHARS);

  for (const productQuestion of [
    '¿Cuánto sale la mermelada de frutilla?',
    '¿Tienen stock de yerba Playadito?',
    '¿Qué dulce me recomendás para rellenar una torta?',
    '¿En qué presentación viene el queso?',
    '¿Este producto es apto para celíacos?',
    '¿Tienen Coca Cola de 2 litros?',
    '¿Tienen este producto?',
    '¿Qué productos sin TACC tienen?',
  ]) {
    assert.equal(shouldRouteToProductAdvisor(productQuestion), true, productQuestion);
  }
  for (const genericOrNonProductQuestion of [
    'Pasame el catálogo',
    'Quiero la lista de precios',
    '¿Quiero la lista de precios?',
    '¿Qué productos tienen?',
    '¿Productos venden?',
    'El catálogo no abre',
    '¿Cuánto sale el envío?',
    '¿Cuál es la compra mínima?',
    'Quiero pedir 3 cajas de galletitas',
  ]) {
    assert.equal(shouldRouteToProductAdvisor(genericOrNonProductQuestion), false, genericOrNonProductQuestion);
  }
  assert.equal(shouldRouteToProductAdvisor('¿Y cuánto sale?', [
    { role: 'customer', content: '¿Hacen envíos a Villa María?' },
    { role: 'assistant', content: 'Mauricio puede confirmar cobertura y costo.' },
  ]), false, 'Una repregunta sobre costo de envío no debe convertirse en consulta de producto.');
  assert.equal(shouldRouteToProductAdvisor('¿Y cuánto sale?', [
    { role: 'customer', content: '¿Llegan a Villa María?' },
    { role: 'assistant', content: 'Podemos revisar la cobertura.' },
  ]), false, 'Una repregunta ambigua debe conservar el contexto de envío aunque no diga “envío”.');
  assert.equal(shouldRouteToProductAdvisor('¿Y cuánto sale?', [
    { role: 'customer', content: '¿Aceptan tarjeta?' },
    { role: 'assistant', content: 'Sí, aceptamos tarjeta.' },
  ]), false, 'Una repregunta ambigua no debe convertir un contexto de pago en producto.');
  assert.equal(shouldRouteToProductAdvisor('¿Y cuánto sale?', [
    { role: 'customer', content: '¿Tienen queso cremoso La Paulina?' },
    { role: 'assistant', content: 'Puedo derivarte con un asesor.' },
  ]), true, 'Una repregunta de precio sobre un producto debe seguir derivando al asesor.');

  const limiter = new JevSimulationLimiter(2, 1_000);
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
  assert.equal(limiter.acquire('session-a', 1_001).allowed, true);

  let requestedUrl = '';
  let requestedInit: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedInit = init;
    return jsonResponse(completeOfficialResponse);
  };

  const result = await evaluateJevMessage(
    'Necesito saber cuándo llega.',
    history,
    { apiKey: 'test-key', fetchImpl, timeoutMs: 500 },
  );
  assert.equal(requestedUrl, JEV_DECISIONS_URL);
  assert.equal(requestedInit?.method, 'POST');
  assert.equal((requestedInit?.headers as Record<string, string>).Authorization, 'Bearer test-key');
  const postedRequest = JSON.parse(String(requestedInit?.body));
  assert.deepEqual(postedRequest.state.recent_conversation, request.state.recent_conversation);
  assert.equal(postedRequest.questions.response_type.type, 'choice');
  assert.equal(result.answers.response_type.choice, 'shipping');
  assert.equal(result.usage.input_tokens, 420);
  assert.equal(result.usage.output_tokens, 40);
  assert.ok(result.elapsedMs >= 0);

  // The old (message, options) call remains supported for the production route.
  const backwardsCompatibleResult = await evaluateJevMessage('¿Cuándo llega el envío?', {
    apiKey: 'test-key',
    timeoutMs: 500,
    fetchImpl: async () => jsonResponse(minimalOfficialResponse),
  });
  assert.equal(backwardsCompatibleResult.answers.response_type.choice, 'shipping');
  assert.equal(backwardsCompatibleResult.usage.cost, null);
  assert.equal(backwardsCompatibleResult.answers.response_type.confidence, null);
  assert.deepEqual(backwardsCompatibleResult.answers.response_type.probabilities, {});
  assert.deepEqual(backwardsCompatibleResult.answers.urgency.legend, {
    0: 'Puede esperar',
    1: 'Atender pronto',
    2: 'Atención inmediata',
  });

  // Official Responses use camelCase token fields; snake_case is accepted for
  // compatibility with the earlier experimental endpoint.
  const snakeCaseUsageResult = await evaluateJevMessage('Hola', {
    apiKey: 'test-key',
    timeoutMs: 500,
    fetchImpl: async () => jsonResponse({
      ...minimalOfficialResponse,
      usage: { input_tokens: 8, output_tokens: 2, cost: 0 },
    }),
  });
  assert.deepEqual(snakeCaseUsageResult.usage, { input_tokens: 8, output_tokens: 2, cost: 0 });

  // Product questions are always routed to a human product advisor, even if a
  // provider response is accidentally classified as catalog or order.
  const forcedProductAdvisor = await evaluateJevMessage('¿Cuánto sale la caja de dulce de leche?', {
    apiKey: 'test-key',
    timeoutMs: 500,
    fetchImpl: async () => jsonResponse({
      ...minimalOfficialResponse,
      answers: {
        ...minimalOfficialResponse.answers,
        response_type: { type: 'choice', choice: 'catalog', confidence: .8, probabilities: { catalog: .8, product_advisor: .2 } },
      },
    }),
  });
  assert.deepEqual(forcedProductAdvisor.answers.response_type, {
    type: 'choice',
    choice: 'product_advisor',
    probabilities: { product_advisor: 1 },
    confidence: 1,
  });
  assert.deepEqual(forcedProductAdvisor.answers.human_attention, { type: 'noul', noul: 1 });

  const genericCatalog = await evaluateJevMessage('Pasame la lista de precios', {
    apiKey: 'test-key',
    timeoutMs: 500,
    fetchImpl: async () => jsonResponse({
      ...minimalOfficialResponse,
      answers: {
        ...minimalOfficialResponse.answers,
        response_type: { type: 'choice', choice: 'catalog' },
      },
    }),
  });
  assert.equal(genericCatalog.answers.response_type.choice, 'catalog');

  const shippingFollowUp = await evaluateJevMessage('¿Y cuánto sale?', [
    { role: 'customer', content: '¿Llegan a Villa María?' },
    { role: 'assistant', content: 'Podemos revisar la cobertura.' },
  ], {
    apiKey: 'test-key',
    timeoutMs: 500,
    fetchImpl: async () => jsonResponse(minimalOfficialResponse),
  });
  assert.equal(shippingFollowUp.answers.response_type.choice, 'shipping');

  const productResolution = await resolveJevCustomerResponse({
    question: '¿Tienen queso cremoso y cuánto sale?',
    history: [{ role: 'user', content: 'Hola' }],
    labels: [{ id: 'product-label', name: 'consultas-productos', answer: 'CONSULTA PRODUCTO → MAURICIO', examples: [] }],
    clientOptions: {
      apiKey: 'test-key',
      timeoutMs: 500,
      fetchImpl: async () => jsonResponse(minimalOfficialResponse),
    },
  });
  assert.equal(productResolution.responseType, 'product_advisor');
  assert.equal(productResolution.answer?.text, 'CONSULTA PRODUCTO → MAURICIO');
  assert.equal(productResolution.answer?.outcome, 'handoff');
  assert.equal(productResolution.source, 'jev-template');
  assert.equal(productResolution.classification.method, 'jev');

  const lowConfidenceResolution = await resolveJevCustomerResponse({
    question: 'No sé bien qué necesito',
    labels: [],
    clientOptions: {
      apiKey: 'test-key',
      timeoutMs: 500,
      fetchImpl: async () => jsonResponse({
        ...minimalOfficialResponse,
        answers: {
          ...minimalOfficialResponse.answers,
          response_type: { type: 'choice', choice: 'shipping', confidence: .2, probabilities: { shipping: .2, unclear: .18 } },
        },
      }),
    },
  });
  assert.equal(lowConfidenceResolution.responseType, 'unclear');
  assert.equal(lowConfidenceResolution.answer?.outcome, 'clarify');

  const safeFailure = await resolveJevCustomerResponse({
    question: 'Necesito ayuda',
    labels: [],
    failSafe: true,
    clientOptions: {
      apiKey: 'test-key',
      timeoutMs: 500,
      fetchImpl: async () => { throw new TypeError('offline'); },
    },
  });
  assert.equal(safeFailure.responseType, 'human_advisor');
  assert.equal(safeFailure.answer?.outcome, 'unavailable');
  assert.match(safeFailure.answer?.text ?? '', /Mauricio|asesor/i);

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
          : jsonResponse(minimalOfficialResponse);
      },
    });
    assert.equal(transientAttempts, 2);
    assert.equal(retried.answers.response_type.choice, 'shipping');
  }

  let transportAttempts = 0;
  await evaluateJevMessage('Mensaje de prueba', {
    apiKey: 'test-key',
    timeoutMs: 500,
    fetchImpl: async () => {
      transportAttempts += 1;
      if (transportAttempts === 1) throw new TypeError('temporary connection failure');
      return jsonResponse(minimalOfficialResponse);
    },
  });
  assert.equal(transportAttempts, 2);

  await assert.rejects(
    () => evaluateJevMessage('Mensaje de prueba', {
      apiKey: 'test-key',
      timeoutMs: 500,
      fetchImpl: async () => jsonResponse({ error: { message: 'rate limited' } }, 429),
    }),
    (error: unknown) => error instanceof JevServiceError && error.status === 429 && /demasiadas solicitudes/i.test(error.message),
  );

  for (const malformedResponse of [
    { unexpected: true },
    {
      ...minimalOfficialResponse,
      answers: { ...minimalOfficialResponse.answers, response_type: { type: 'choice', choice: 'invented_type' } },
    },
    {
      ...minimalOfficialResponse,
      answers: { ...minimalOfficialResponse.answers, human_attention: { type: 'noul', noul: 1.2 } },
    },
    { ...minimalOfficialResponse, usage: { inputTokens: -1, outputTokens: 3 } },
  ]) {
    await assert.rejects(
      () => evaluateJevMessage('Mensaje de prueba', {
        apiKey: 'test-key',
        timeoutMs: 500,
        fetchImpl: async () => jsonResponse(malformedResponse),
      }),
      (error: unknown) => error instanceof JevServiceError && error.status === 502,
    );
  }

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

  console.log('Jev simulator tests passed');
}

void main();
