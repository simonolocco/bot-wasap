export const JEV_DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
export const JEV_MODEL = 'typesafe/jev-1.13';

export const JEV_RESPONSE_TYPES = [
  'greeting',
  'thanks',
  'business_info',
  'address',
  'hours',
  'shipping',
  'minimum_purchase',
  'retail',
  'payment',
  'catalog',
  'catalog_problem',
  'product_advisor',
  'order',
  'complaint',
  'human_advisor',
  'external_proposal',
  'unclear',
  'off_topic',
  'silence',
] as const;

export type JevResponseType = typeof JEV_RESPONSE_TYPES[number];
export type JevHistoryRole = 'customer' | 'user' | 'assistant';
export type JevHistoryMessage = Readonly<{
  role: JevHistoryRole;
  content: string;
}>;
export type JevNormalizedHistoryMessage = Readonly<{
  role: 'customer' | 'assistant';
  content: string;
}>;

export type JevChoiceAnswer = {
  type: 'choice';
  choice: JevResponseType;
  probabilities: Partial<Record<JevResponseType, number>>;
  confidence: number | null;
};

export type JevNoulAnswer = {
  type: 'noul';
  noul: number;
};

export type JevScoreAnswer = {
  type: 'score';
  score: number;
  probabilities: Record<string, number>;
  confidence: number | null;
  legend: Record<string, string>;
};

export type JevSimulationResponse = {
  model: string;
  answers: {
    response_type: JevChoiceAnswer;
    urgency: JevScoreAnswer;
    human_attention: JevNoulAnswer;
  };
  usage: {
    input_tokens: number;
    output_tokens: number;
    cost: number | null;
  };
  elapsedMs: number;
};

type RawJevChoiceAnswer = {
  type: 'choice';
  choice: string;
  probabilities?: Record<string, number>;
  confidence?: number;
};

type RawJevNoulAnswer = {
  type: 'noul';
  noul: number;
};

type RawJevScoreAnswer = {
  type: 'score';
  score: number;
  probabilities?: Record<string, number>;
  confidence?: number;
  legend?: Record<string, unknown>;
};

type RawJevUsage = {
  inputTokens?: number;
  outputTokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  cost?: number;
};

type RawJevSimulationResponse = {
  model: string;
  answers: {
    response_type: RawJevChoiceAnswer;
    urgency: RawJevScoreAnswer;
    human_attention: RawJevNoulAnswer;
  };
  usage: RawJevUsage;
};

const RESPONSE_TYPE_KEYS = new Set<string>(JEV_RESPONSE_TYPES);
const URGENCY_KEYS = new Set(['0', '1', '2']);
const URGENCY_LEGEND: Record<string, string> = {
  0: 'Puede esperar',
  1: 'Atender pronto',
  2: 'Atención inmediata',
};

export const JEV_HISTORY_MAX_MESSAGES = 12;
export const JEV_HISTORY_MAX_MESSAGE_CHARS = 1_000;
export const JEV_HISTORY_MAX_TOTAL_CHARS = 6_000;
export const JEV_CURRENT_MESSAGE_MAX_CHARS = 4_000;

export type JevClientOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type JevLimitState = {
  inFlight: boolean;
  timestamps: number[];
  lastTouched: number;
};

export type JevLimitClaim =
  | { allowed: false; reason: 'busy' | 'rate'; retryAfterSeconds: number }
  | { allowed: true; release: () => void };

export class JevSimulationLimiter {
  private readonly states = new Map<string, JevLimitState>();

  constructor(
    private readonly maximum = 12,
    private readonly windowMs = 60_000,
  ) {}

  acquire(key: string, now = Date.now()): JevLimitClaim {
    const current = this.states.get(key) ?? { inFlight: false, timestamps: [], lastTouched: now };
    current.timestamps = current.timestamps.filter(timestamp => timestamp > now - this.windowMs);
    current.lastTouched = now;
    this.states.set(key, current);

    if (current.inFlight) return { allowed: false, reason: 'busy', retryAfterSeconds: 2 };
    if (current.timestamps.length >= this.maximum) {
      const retryAfterSeconds = Math.max(1, Math.ceil((this.windowMs - (now - current.timestamps[0])) / 1000));
      return { allowed: false, reason: 'rate', retryAfterSeconds };
    }

    current.inFlight = true;
    current.timestamps.push(now);
    let released = false;
    return {
      allowed: true,
      release: () => {
        if (released) return;
        released = true;
        const latest = this.states.get(key);
        if (latest) {
          latest.inFlight = false;
          latest.lastTouched = Date.now();
        }
      },
    };
  }

  cleanup(now = Date.now()) {
    for (const [key, state] of this.states) {
      if (!state.inFlight && state.lastTouched <= now - this.windowMs) this.states.delete(key);
    }
  }
}

export class JevServiceError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'JevServiceError';
  }
}

function normalizeForMatching(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-AR')
    .replace(/\s+/g, ' ')
    .replace(/^[¿?¡!.,;:\s]+|[¿?¡!.,;:\s]+$/g, '')
    .trim();
}

const CATALOG_PROBLEM_PATTERN = /\b(?:catalogo|lista)(?:\s+de\s+(?:precios|productos))?.{0,48}\b(?:no\s+(?:abre|carga|funciona|anda)|error|caido|roto|problema|fall[ao]|vencid[oa])\b|\b(?:no\s+(?:abre|carga|funciona|anda)|error|problema).{0,48}\b(?:catalogo|lista)\b/;
const GENERIC_CATALOG_PATTERN = /^(?:(?:hola|buen(?:as|os)(?:\s+dias|\s+tardes|\s+noches)?)[,! ]*)?(?:(?:me|nos)\s+)?(?:pasa|pasan|pasame|paseme|manda|mandan|mandame|mandeme|envia|enviame|comparte|compartime|quiero|quisiera|necesito|puedo\s+ver|donde\s+veo|como\s+veo)?\s*(?:(?:el|la|los|las|un|una|su)\s+)?(?:catalogo|lista(?:do)?\s+de\s+(?:precios|productos)|precios|productos)(?:\s+(?:completo|actualizado|mayorista|por\s+mayor))?[?!. ]*$/;
const GENERIC_PRODUCTS_PATTERN = /^(?:(?:hola|buen(?:as|os)(?:\s+dias|\s+tardes|\s+noches)?)[,! ]*)?(?:(?:que|cuales)\s+)?productos\s+(?:tienen|venden|manejan|ofrecen|trabajan)(?:\s+ustedes)?[?!. ]*$/;
const FOOD_SAFETY_PATTERN = /\b(?:sin\s+tacc|gluten|celiac[oa]s?|alergen[oa]s?|lactosa|vegano|vegetariano|ingredientes?|vencimiento|vence|caducidad|conservacion|conservar|cadena\s+de\s+frio|refrigerad[oa]s?|congelad[oa]s?|apt[oa](?:\s+para)?|contiene\s+(?:mani|nueces|leche|soja)|kosher|halal)\b/;
const RECOMMENDATION_PATTERN = /\b(?:recomiend|recomend|suger|conviene|aconsej|mejor\s+para|diferencia\s+entre|cual\s+(?:elijo|elegir|me\s+conviene)|que\s+(?:me\s+)?recomendas|que\s+puedo\s+usar)\w*/;
const PACKAGING_PATTERN = /\b(?:presentacion(?:es)?|envase(?:s)?|formato(?:s)?|tamano(?:s)?|peso|gramos?|kilogramos?|kilos?|kg|unidades?\s+(?:trae|viene)|pack(?:s)?|bulto(?:s)?|caja\s+cerrada|cuanto\s+trae|cuantos?\s+(?:trae|vienen)|como\s+viene|en\s+que\s+(?:envase|presentacion|formato)|viene\s+en)\b/;
const STOCK_PATTERN = /\b(?:stock|disponib\w*|quedan?|les\s+queda|consegui[rs]|reposicion|reponer)\b/;
const PRICE_PATTERN = /\b(?:precio(?:s)?|cuanto\s+(?:sale|cuesta|vale)|a\s+cuanto|que\s+valor|valor\s+de)\b/;
const BARE_PRICE_FOLLOWUP_PATTERN = /^(?:(?:y|entonces)\s+)?(?:(?:cuanto\s+(?:sale|cuesta|vale))|(?:a\s+cuanto)|(?:que\s+(?:precio|valor))|precios?|valor)(?:\s+(?:es|seria|queda|esto|eso))?$/;
const DIRECT_AVAILABILITY_PATTERN = /\b(?:tienen|tenes|hay|trabajan|manejan|venden)\b/;
const NON_PRODUCT_AVAILABILITY_PATTERN = /\b(?:envio|entrega|flete|reparto|delivery|local|sucursal|horario|abiert[oa]s?|atencion|turno|estacionamiento|telefono|whatsapp|pago|transferencia|cuenta|mercado\s+pago|tarjeta|cuotas?|catalogo|lista|compra\s+minima|pedido\s+minimo|minimo|minorista|mayorista)\b/;
const NON_PRODUCT_PRICE_PATTERN = /\b(?:envios?|entregas?|fletes?|repartos?|delivery|compra\s+minima|pedido\s+minimo|minimo\s+de\s+compra|cuotas?|recargos?)\b/;

/**
 * Hard business rule: a concrete product question must be answered by a person,
 * never by an invented product lookup. Generic catalog/list requests stay in the
 * deterministic catalog flow.
 */
export function shouldRouteToProductAdvisor(message: string, history: readonly JevHistoryMessage[] = []) {
  const normalized = normalizeForMatching(message);
  if (!normalized || CATALOG_PROBLEM_PATTERN.test(normalized)) return false;
  if (GENERIC_CATALOG_PATTERN.test(normalized) || GENERIC_PRODUCTS_PATTERN.test(normalized)) return false;

  if (FOOD_SAFETY_PATTERN.test(normalized)) return true;
  if (RECOMMENDATION_PATTERN.test(normalized)) return true;
  if (PACKAGING_PATTERN.test(normalized)) return true;
  if (STOCK_PATTERN.test(normalized)) return true;
  if (PRICE_PATTERN.test(normalized)) {
    if (NON_PRODUCT_PRICE_PATTERN.test(normalized)) return false;
    if (BARE_PRICE_FOLLOWUP_PATTERN.test(normalized)) {
      let previousCustomerIndex = history.length - 1;
      while (previousCustomerIndex >= 0 && history[previousCustomerIndex]?.role === 'assistant') {
        previousCustomerIndex -= 1;
      }
      if (previousCustomerIndex < 0) return false;
      const previousCustomerTurn = history[previousCustomerIndex];
      return shouldRouteToProductAdvisor(previousCustomerTurn.content, history.slice(0, previousCustomerIndex));
    }
    return true;
  }

  return DIRECT_AVAILABILITY_PATTERN.test(normalized)
    && !NON_PRODUCT_AVAILABILITY_PATTERN.test(normalized);
}

export function normalizeJevHistory(history: readonly JevHistoryMessage[] = []): JevNormalizedHistoryMessage[] {
  const recent = history.slice(-JEV_HISTORY_MAX_MESSAGES);
  const normalized: JevNormalizedHistoryMessage[] = [];
  let remainingChars = JEV_HISTORY_MAX_TOTAL_CHARS;

  for (let index = recent.length - 1; index >= 0 && remainingChars > 0; index -= 1) {
    const item = recent[index];
    if (!item || !['customer', 'user', 'assistant'].includes(item.role) || typeof item.content !== 'string') continue;
    const content = item.content.trim().slice(0, Math.min(JEV_HISTORY_MAX_MESSAGE_CHARS, remainingChars));
    if (!content) continue;
    remainingChars -= content.length;
    normalized.unshift({ role: item.role === 'assistant' ? 'assistant' : 'customer', content });
  }

  return normalized;
}

export function buildJevSimulationRequest(message: string, history: readonly JevHistoryMessage[] = []) {
  const currentMessage = message.trim().slice(0, JEV_CURRENT_MESSAGE_MAX_CHARS);
  return {
    model: JEV_MODEL,
    state: {
      current_message: currentMessage,
      recent_conversation: normalizeJevHistory(history),
      language: 'Spanish (Argentina)',
      channel: 'WhatsApp',
      business: 'Distribuidora Abasto del Campo',
    },
    questions: {
      response_type: {
        type: 'choice',
        instructions: 'Choose the single response flow that should handle current_message. Use recent_conversation only to resolve context. The customer usually writes in Argentinian Spanish.',
        criteria: {
          greeting: 'A greeting or conversation opener with no other request.',
          thanks: 'A thank-you, acknowledgement, or friendly closing with no new request.',
          business_info: 'A general question about the company, its activity, contact channels, or how it works that is not an address, schedule, shipping, purchase minimum, retail, payment, or catalog request.',
          address: 'The customer asks for an address, location, branch, directions, or where the business is.',
          hours: 'The customer asks about opening hours, days open, holidays, or when they can contact or visit.',
          shipping: 'The customer asks whether, where, when, or at what cost deliveries or shipments are made, including the status or delay of a delivery.',
          minimum_purchase: 'The customer asks about the minimum order amount, minimum quantities, or conditions for a wholesale purchase.',
          retail: 'The customer asks whether the business sells retail, to end consumers, or in small quantities.',
          payment: 'The customer asks about payment methods, transfers, invoices, balances, receipts, or reports a payment.',
          catalog: 'A generic request for the catalog, price list, product list, or what products are sold, without asking about a particular product or attribute.',
          catalog_problem: 'The customer cannot open, load, access, or use the catalog or price list.',
          product_advisor: 'A question about a particular product, price, stock, availability, recommendation, comparison, packaging, presentation, ingredients, allergens, suitability, expiration, storage, or food safety. This flow hands the customer to a human and must not invent product data.',
          order: 'The customer clearly wants to place, repeat, add to, change, confirm, cancel, or check a concrete order. A direct purchase instruction is an order, not merely a product question.',
          complaint: 'The customer reports damaged, missing, wrong, late, poor-quality goods or service, or asks for resolution of a problem with an order.',
          human_advisor: 'The customer explicitly asks to speak with a person, representative, seller, or human advisor, without a more specific complaint or product question.',
          external_proposal: 'A supplier, salesperson, job applicant, agency, influencer, or other external party proposes a commercial relationship, service, product, employment, or collaboration.',
          unclear: 'There is meaningful text, but the request cannot be understood or confidently assigned to another response flow.',
          off_topic: 'Spam, abuse, advertising, or a request unrelated to the business and its customer service.',
          silence: 'The message is empty, contains only punctuation, an attachment placeholder, or no meaningful words.',
        },
      },
      urgency: {
        type: 'score',
        instructions: 'Rate the operational urgency of current_message in its conversation context.',
        criteria: [
          'It can wait without meaningful commercial or customer impact.',
          'It should receive attention soon, but it is not an immediate blocker.',
          'It needs immediate attention because a sale, delivery, payment, food-safety issue, or serious complaint is blocked now.',
        ],
      },
      human_attention: {
        type: 'noul',
        instructions: 'Does current_message require a human advisor instead of a safe deterministic response? Product-specific questions, complaints, uncertain cases, payment cases needing verification, and explicit requests for a person should be yes. Greetings, known business facts, and generic catalog flows should be no.',
        criteria: {
          true: 'A person must use judgment, verify changing information, inspect a specific case, or provide personalized attention.',
          false: 'A known static response or deterministic automated flow can resolve it safely without inventing information.',
        },
      },
    },
  } as const;
}

function publicErrorForStatus(status: number) {
  if (status === 400) return 'Jev no pudo interpretar esta simulación. Revisá el mensaje e intentá nuevamente.';
  if (status === 401 || status === 403) return 'La conexión con OpenRouter necesita revisar su credencial.';
  if (status === 402) return 'La cuenta de OpenRouter no tiene saldo disponible.';
  if (status === 413) return 'El mensaje es demasiado largo para procesarlo.';
  if (status === 429) return 'OpenRouter está recibiendo demasiadas solicitudes. Esperá unos segundos.';
  return 'Jev no está disponible en este momento. Intentá nuevamente.';
}

function isFiniteNumber(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isOptionalProbabilityRecord(value: unknown, allowedKeys: Set<string>) {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, item]) => allowedKeys.has(key) && isFiniteNumber(item, 0, 1));
}

function isOptionalConfidence(value: unknown) {
  return value === undefined || isFiniteNumber(value, 0, 1);
}

function readTokenCount(usage: RawJevUsage, camelKey: 'inputTokens' | 'outputTokens', snakeKey: 'input_tokens' | 'output_tokens') {
  const value = usage[camelKey] ?? usage[snakeKey];
  return Number.isInteger(value) && (value ?? -1) >= 0 ? value : undefined;
}

function isSimulationResponse(value: unknown): value is RawJevSimulationResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Partial<RawJevSimulationResponse>;
  const responseType = response.answers?.response_type;
  const urgency = response.answers?.urgency;
  const humanAttention = response.answers?.human_attention;
  const usage = response.usage;
  if (!usage) return false;
  return Boolean(
    typeof response.model === 'string' && response.model.length > 0
    && responseType?.type === 'choice'
    && RESPONSE_TYPE_KEYS.has(responseType.choice)
    && isOptionalConfidence(responseType.confidence)
    && isOptionalProbabilityRecord(responseType.probabilities, RESPONSE_TYPE_KEYS)
    && urgency?.type === 'score'
    && isFiniteNumber(urgency.score, 0, 2)
    && isOptionalConfidence(urgency.confidence)
    && isOptionalProbabilityRecord(urgency.probabilities, URGENCY_KEYS)
    && (urgency.legend === undefined || (urgency.legend !== null && typeof urgency.legend === 'object' && !Array.isArray(urgency.legend)))
    && humanAttention?.type === 'noul'
    && isFiniteNumber(humanAttention.noul, 0, 1)
    && readTokenCount(usage, 'inputTokens', 'input_tokens') !== undefined
    && readTokenCount(usage, 'outputTokens', 'output_tokens') !== undefined
    && (usage.cost === undefined || isFiniteNumber(usage.cost, 0, Number.MAX_VALUE))
  );
}

function normalizeResponseType(answer: RawJevChoiceAnswer, forceProductAdvisor: boolean): JevChoiceAnswer {
  if (forceProductAdvisor) {
    return {
      type: 'choice',
      choice: 'product_advisor',
      probabilities: { product_advisor: 1 },
      confidence: 1,
    };
  }
  return {
    type: 'choice',
    choice: answer.choice as JevResponseType,
    probabilities: answer.probabilities ?? {},
    confidence: answer.confidence ?? null,
  };
}

export function evaluateJevMessage(message: string, options?: JevClientOptions): Promise<JevSimulationResponse>;
export function evaluateJevMessage(message: string, history: readonly JevHistoryMessage[], options?: JevClientOptions): Promise<JevSimulationResponse>;
export async function evaluateJevMessage(
  message: string,
  historyOrOptions: readonly JevHistoryMessage[] | JevClientOptions = [],
  explicitOptions: JevClientOptions = {},
): Promise<JevSimulationResponse> {
  const hasHistory = Array.isArray(historyOrOptions);
  const history = hasHistory ? historyOrOptions as readonly JevHistoryMessage[] : [];
  const options = hasHistory ? explicitOptions : historyOrOptions as JevClientOptions;
  const apiKey = (options.apiKey ?? process.env.OPENROUTER_API_KEY ?? '').trim();
  if (!apiKey) throw new JevServiceError(503, 'OpenRouter todavía no está configurado para este panel.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  const startedAt = Date.now();

  try {
    const request = () => (options.fetchImpl ?? fetch)(JEV_DECISIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://abasto-bot.cloud',
        'X-OpenRouter-Title': 'AbastoBot · Simulador Jev',
      },
      body: JSON.stringify(buildJevSimulationRequest(message, history)),
      signal: controller.signal,
    });

    let response: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        response = await request();
      } catch (error) {
        if (controller.signal.aborted || attempt === 1) throw error;
        continue;
      }
      if ([502, 503, 504, 524, 529].includes(response.status) && attempt === 0) {
        await response.body?.cancel();
        continue;
      }
      break;
    }

    if (!response) throw new JevServiceError(502, 'No se pudo conectar con Jev. Intentá nuevamente.');
    if (!response.ok) throw new JevServiceError(response.status, publicErrorForStatus(response.status));

    const payload: unknown = await response.json();
    if (!isSimulationResponse(payload)) {
      throw new JevServiceError(502, 'Jev respondió con un resultado que no se pudo mostrar.');
    }

    const forceProductAdvisor = shouldRouteToProductAdvisor(message, history);
    return {
      model: payload.model,
      answers: {
        response_type: normalizeResponseType(payload.answers.response_type, forceProductAdvisor),
        urgency: {
          type: 'score',
          score: payload.answers.urgency.score,
          probabilities: payload.answers.urgency.probabilities ?? {},
          confidence: payload.answers.urgency.confidence ?? null,
          legend: URGENCY_LEGEND,
        },
        human_attention: forceProductAdvisor ? { type: 'noul', noul: 1 } : payload.answers.human_attention,
      },
      usage: {
        input_tokens: readTokenCount(payload.usage, 'inputTokens', 'input_tokens') ?? 0,
        output_tokens: readTokenCount(payload.usage, 'outputTokens', 'output_tokens') ?? 0,
        cost: typeof payload.usage.cost === 'number' ? payload.usage.cost : null,
      },
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error instanceof JevServiceError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new JevServiceError(504, 'Jev tardó demasiado en responder. Intentá nuevamente.');
    }
    throw new JevServiceError(502, 'No se pudo conectar con Jev. Intentá nuevamente.');
  } finally {
    clearTimeout(timeout);
  }
}
