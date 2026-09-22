const OPENROUTER_JEV_URL = 'https://openrouter.ai/api/v1/systemone';

export const JEV_MODEL = 'typesafe/jev-1.13';

type JevChoiceAnswer = {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence: number | null;
};

type JevNoulAnswer = {
  type: 'noul';
  noul: number;
};

type JevScoreAnswer = {
  type: 'score';
  score: number;
  probabilities: Record<string, number>;
  confidence: number | null;
  legend: Record<string, string>;
};

export type JevSimulationResponse = {
  model: string;
  answers: {
    intent: JevChoiceAnswer;
    urgency: JevScoreAnswer;
    human_attention: JevNoulAnswer;
  };
  usage: {
    input_tokens: number;
    output_tokens: number;
    cost: number | null;
  };
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

type RawJevSimulationResponse = {
  model: string;
  answers: {
    intent: RawJevChoiceAnswer;
    urgency: RawJevScoreAnswer;
    human_attention: RawJevNoulAnswer;
  };
  usage: {
    input_tokens: number;
    output_tokens: number;
    cost?: number;
  };
};

const INTENT_KEYS = new Set(['order', 'product_info', 'delivery', 'complaint', 'payment', 'advisor', 'other']);
const URGENCY_LEGEND: Record<string, string> = {
  0: 'Puede esperar',
  1: 'Atender pronto',
  2: 'Atención inmediata',
};

type JevClientOptions = {
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

export function buildJevSimulationRequest(message: string) {
  return {
    model: JEV_MODEL,
    state: {
      customer_message: message,
      language: 'Spanish (Argentina)',
      channel: 'WhatsApp',
      business: 'Distribuidora Abasto del Campo',
    },
    questions: {
      intent: {
        type: 'choice',
        instructions: 'Identify the primary intent of this customer message. The message is usually written in Argentinian Spanish.',
        criteria: {
          order: 'The customer wants to place, repeat, modify, or check a product order.',
          product_info: 'The customer asks about products, prices, promotions, stock, or availability.',
          delivery: 'The customer asks about delivery timing, delays, delivery areas, or shipment status.',
          complaint: 'The customer reports damage, missing goods, an incorrect order, poor service, or another problem.',
          payment: 'The customer asks about a payment, transfer, invoice, balance, or payment receipt.',
          advisor: 'The main request is to speak with a person and no more specific business intent is stated.',
          other: 'The message does not clearly fit any of the other categories.',
        },
      },
      urgency: {
        type: 'score',
        instructions: 'Rate the operational urgency expressed by the customer.',
        criteria: [
          'It can wait without meaningful commercial or customer impact.',
          'It should receive attention soon, but it is not an immediate blocker.',
          'It needs immediate attention because a sale, delivery, payment, or serious complaint is blocked now.',
        ],
      },
      human_attention: {
        type: 'noul',
        instructions: 'Does this case require a human advisor rather than a safe automated menu or standard answer?',
        criteria: {
          true: 'A person must exercise judgment, resolve a complaint, inspect a specific case, or provide personalized attention.',
          false: 'A standard menu, known fact, or deterministic automated flow can resolve it safely.',
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

function isSimulationResponse(value: unknown): value is RawJevSimulationResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Partial<RawJevSimulationResponse>;
  const intent = response.answers?.intent;
  const urgency = response.answers?.urgency;
  const humanAttention = response.answers?.human_attention;
  const usage = response.usage;
  if (!usage) return false;
  return Boolean(
    typeof response.model === 'string' && response.model.length > 0
    && intent?.type === 'choice'
    && INTENT_KEYS.has(intent.choice)
    && isOptionalConfidence(intent.confidence)
    && isOptionalProbabilityRecord(intent.probabilities, INTENT_KEYS)
    && urgency?.type === 'score'
    && isFiniteNumber(urgency.score, 0, 2)
    && isOptionalConfidence(urgency.confidence)
    && isOptionalProbabilityRecord(urgency.probabilities, new Set(['0', '1', '2']))
    && (urgency.legend === undefined || (urgency.legend !== null && typeof urgency.legend === 'object' && !Array.isArray(urgency.legend)))
    && humanAttention?.type === 'noul'
    && isFiniteNumber(humanAttention.noul, 0, 1)
    && Number.isInteger(usage?.input_tokens) && usage.input_tokens >= 0
    && Number.isInteger(usage.output_tokens) && usage.output_tokens >= 0
    && (usage.cost === undefined || isFiniteNumber(usage.cost, 0, Number.MAX_VALUE))
  );
}

export async function evaluateJevMessage(message: string, options: JevClientOptions = {}) {
  const apiKey = (options.apiKey ?? process.env.OPENROUTER_API_KEY ?? '').trim();
  if (!apiKey) throw new JevServiceError(503, 'OpenRouter todavía no está configurado para este panel.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  const startedAt = Date.now();

  try {
    const request = () => (options.fetchImpl ?? fetch)(OPENROUTER_JEV_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://abasto-bot.cloud',
        'X-OpenRouter-Title': 'AbastoBot · Simulador Jev',
      },
      body: JSON.stringify(buildJevSimulationRequest(message)),
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

    return {
      model: payload.model,
      answers: {
        intent: {
          type: 'choice',
          choice: payload.answers.intent.choice,
          probabilities: payload.answers.intent.probabilities ?? {},
          confidence: payload.answers.intent.confidence ?? null,
        },
        urgency: {
          type: 'score',
          score: payload.answers.urgency.score,
          probabilities: payload.answers.urgency.probabilities ?? {},
          confidence: payload.answers.urgency.confidence ?? null,
          legend: URGENCY_LEGEND,
        },
        human_attention: payload.answers.human_attention,
      },
      usage: {
        input_tokens: payload.usage.input_tokens,
        output_tokens: payload.usage.output_tokens,
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
