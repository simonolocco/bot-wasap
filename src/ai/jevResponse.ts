import { BUSINESS_ADDRESS, BUSINESS_SCHEDULE, formatCatalogFollowUpMessage } from '../botMenu';
import {
  JEV_MODEL,
  JevServiceError,
  evaluateJevMessage,
  type JevClientOptions,
  type JevHistoryMessage,
  type JevResponseType,
  type JevSimulationResponse,
} from '../services/jevSimulator';
import { advisorUrl, catalogLinks, type Answer, type Turn } from './assistant';
import { renderSavedAnswer } from './answerTemplate';
import type { AiLabelCandidate, AiLabelClassification } from './labelClassifier';
import { normalizeAiTopic } from './labelPolicy';
import type { CustomerAiResolution } from './queryResolver';
import {
  claimJevBudget,
  type JevBudgetClaim,
  type JevBudgetSubject,
} from '../db/repository';

const RESPONSE_LABELS: Record<JevResponseType, string | null> = {
  greeting: 'saludos',
  thanks: 'agradecimientos',
  business_info: 'informacion',
  address: 'direccion',
  hours: 'horarios',
  shipping: 'envios',
  minimum_purchase: 'compra-minima',
  retail: 'minorista',
  payment: 'pagos',
  catalog: 'catalogo',
  catalog_problem: 'problema-catalogo',
  product_advisor: 'consultas-productos',
  order: 'pedidos',
  complaint: 'reclamos',
  human_advisor: 'asesor',
  external_proposal: 'proveedores',
  unclear: 'pregunta-no-entendible',
  off_topic: 'consulta-general',
  silence: null,
};

const HANDOFF_TYPES = new Set<JevResponseType>([
  'payment', 'catalog_problem', 'complaint', 'human_advisor', 'external_proposal',
]);

function catalogFirstMessages() {
  const catalogs = catalogLinks();
  if (!catalogs) return {
    text: `Para consultar productos y precios, escribile a Mauricio, nuestro asesor comercial: ${advisorUrl()}`,
    followUpText: undefined,
  };
  return {
    text: `Podés buscar el producto y consultar su precio en nuestros catálogos:\n\n${catalogs}`,
    followUpText: formatCatalogFollowUpMessage(advisorUrl()),
  };
}

function fallbackTemplate(type: JevResponseType) {
  const catalogs = catalogLinks();
  const templates: Record<JevResponseType, string> = {
    greeting: '¡Hola! Bienvenido/a a *Distribuidora Abasto del Campo* 👋 ¿En qué podemos ayudarte hoy?',
    thanks: '¡Gracias por escribirnos! Estamos a tu disposición.',
    business_info: 'Somos Distribuidora Abasto del Campo. Atendemos a mayoristas y particulares con quesos, fiambres y lácteos en Córdoba Capital.',
    address: BUSINESS_ADDRESS,
    hours: BUSINESS_SCHEDULE,
    shipping: `Estamos en Córdoba Capital. Los pedidos se retiran en el local o se despachan con un comisionista o transporte de tu confianza. Mauricio puede confirmar cobertura y costo: ${advisorUrl()}`,
    minimum_purchase: `La compra mínima es de 1/2 horma en adelante. Para confirmar una presentación o cantidad, consultale a Mauricio: ${advisorUrl()}`,
    retail: 'Atendemos tanto a clientes mayoristas como minoristas. La compra mínima es de 1/2 horma en adelante.',
    payment: `No tengo medios de pago ni planes de cuotas confirmados en este canal. Mauricio puede confirmarte las opciones disponibles: ${advisorUrl()}`,
    catalog: catalogs
      ? `Te comparto nuestros catálogos vigentes:\n\n${catalogs}\n\nPara consultar un producto puntual, escribile a Mauricio: ${advisorUrl()}`
      : `Mauricio puede facilitarte la lista vigente: ${advisorUrl()}`,
    catalog_problem: `Probá abrir el catálogo desde Chrome o Safari. Si sigue sin abrir, Mauricio puede enviarte la lista por otra vía: ${advisorUrl()}`,
    product_advisor: catalogFirstMessages().text,
    order: 'Para armar tu pedido, elegí «Nuevo Pedido» (opción 4) y enviá la lista completa con cantidades, productos y marcas. La compra mínima es de 1/2 horma en adelante.',
    complaint: `Lamentamos el inconveniente y entendemos tu molestia. Para revisar tu caso y solucionarlo, comunicate directamente con Mauricio: ${advisorUrl()}`,
    human_advisor: `¡Por supuesto! Podés comunicarte directamente con Mauricio, nuestro asesor comercial: ${advisorUrl()}`,
    external_proposal: `Este canal es exclusivo para atención a clientes y ventas. Para propuestas comerciales, postulaciones o solicitudes institucionales, comunicate con Mauricio: ${advisorUrl()}`,
    unclear: `No llegué a comprender bien tu consulta. ¿Podés escribirla de otra forma?\n\nSi preferís, podés hablar con Mauricio: ${advisorUrl()}`,
    off_topic: 'Este canal atiende consultas de Distribuidora Abasto del Campo. Puedo ayudarte con horarios, ubicación, envíos, catálogo, pedidos o derivarte con un asesor comercial.',
    silence: '',
  };
  return templates[type];
}

function labelFor(type: JevResponseType, labels: AiLabelCandidate[]) {
  const normalizedName = RESPONSE_LABELS[type];
  if (!normalizedName) return null;
  return labels.find(label => normalizeAiTopic(label.name) === normalizedName) ?? null;
}

function answerOutcome(type: JevResponseType): Answer['outcome'] {
  if (type === 'silence') return 'silence';
  if (type === 'unclear' || type === 'off_topic') return 'clarify';
  return HANDOFF_TYPES.has(type) ? 'handoff' : 'answered';
}

function toJevHistory(history: Turn[] = []): JevHistoryMessage[] {
  return history.slice(-12).map(turn => ({
    role: turn.role === 'user' ? 'customer' : 'assistant',
    content: turn.content.slice(0, 2500),
  }));
}

function selectedConfidence(decision: JevSimulationResponse, type: JevResponseType) {
  return decision.answers.response_type.confidence
    ?? decision.answers.response_type.probabilities[type]
    ?? 0.75;
}

export type JevCustomerResolution = CustomerAiResolution & {
  source: 'jev-template';
  responseType: JevResponseType;
  responseLabel: string | null;
  decision: JevSimulationResponse | null;
};

export type JevBudgetClaimFunction = (subject: JevBudgetSubject) => Promise<JevBudgetClaim>;

export class JevBudgetError extends JevServiceError {
  constructor(
    public readonly reason: 'global' | 'subject',
    public readonly retryAfterSeconds: number,
  ) {
    super(429, 'Se alcanzó la cuota segura de Jev. La consulta fue derivada a un asesor.');
    this.name = 'JevBudgetError';
  }
}

export async function resolveJevCustomerResponse(input: {
  question: string;
  history?: Turn[];
  labels?: AiLabelCandidate[];
  failSafe?: boolean;
  clientOptions?: JevClientOptions;
  budgetSubject?: JevBudgetSubject;
  budgetClaim?: JevBudgetClaimFunction;
}): Promise<JevCustomerResolution> {
  const labels = input.labels ?? [];
  try {
    const callerBeforeRequest = input.clientOptions?.beforeRequest;
    const budgetClaim = input.budgetClaim ?? claimJevBudget;
    const clientOptions: JevClientOptions = input.budgetSubject
      ? {
          ...input.clientOptions,
          beforeRequest: async context => {
            const claim = await budgetClaim(input.budgetSubject!);
            if (!claim.allowed) throw new JevBudgetError(claim.reason, claim.retryAfterSeconds);
            await callerBeforeRequest?.(context);
          },
        }
      : input.clientOptions ?? {};
    const decision = await evaluateJevMessage(input.question, toJevHistory(input.history), clientOptions);
    const chosen = decision.answers.response_type.choice;
    const confidence = selectedConfidence(decision, chosen);
    const responseType: JevResponseType = confidence < 0.55
      && !['product_advisor', 'complaint', 'human_advisor', 'external_proposal'].includes(chosen)
      ? 'unclear'
      : chosen;
    const matchedLabel = labelFor(responseType, labels);
    const catalogFirst = responseType === 'product_advisor' || responseType === 'catalog'
      ? catalogFirstMessages() : null;
    // Catalog URLs are live configuration; an older approved label must not
    // replace them with an immediate advisor referral.
    const rendered = renderSavedAnswer(catalogFirst?.text || matchedLabel?.answer?.trim() || fallbackTemplate(responseType));
    const text = responseType === 'silence' ? '' : rendered.text;
    const responseLabel = RESPONSE_LABELS[responseType];
    const classification: AiLabelClassification = {
      existingLabelId: matchedLabel?.id ?? null,
      suggestedName: responseLabel,
      confidence,
      method: 'jev',
    };
    const answer: Answer = {
      text,
      outcome: answerOutcome(responseType),
      sources: catalogFirst ? ['Catálogos vigentes de Jev']
        : matchedLabel ? [`Plantilla aprobada: ${matchedLabel.name}`] : ['Plantilla segura de Jev'],
      products: [],
      model: decision.model,
      tokens: decision.usage.input_tokens + decision.usage.output_tokens,
      elapsedMs: decision.elapsedMs,
    };
    return {
      source: 'jev-template',
      answer,
      sendMenuAfter: Boolean(text.trim()) && !catalogFirst,
      followUpText: catalogFirst?.followUpText,
      classification,
      matchedRuleId: null,
      matchedLabel,
      responseType,
      responseLabel,
      decision,
    };
  } catch (error) {
    const budgetExceeded = error instanceof JevBudgetError;
    if (!budgetExceeded && !input.failSafe) throw error;
    const responseType: JevResponseType = 'human_advisor';
    const matchedLabel = labelFor(responseType, labels);
    const rendered = renderSavedAnswer(matchedLabel?.answer?.trim() || fallbackTemplate(responseType));
    const responseLabel = RESPONSE_LABELS[responseType];
    return {
      source: 'jev-template',
      answer: {
        text: rendered.text,
        outcome: 'unavailable',
        sources: ['Contingencia segura de Jev'],
        products: [],
        model: JEV_MODEL,
        tokens: 0,
        elapsedMs: 0,
        errorCode: budgetExceeded ? 'jev-budget'
          : error instanceof JevServiceError ? `jev-${error.status}` : 'jev-provider',
      },
      sendMenuAfter: true,
      classification: {
        existingLabelId: matchedLabel?.id ?? null,
        suggestedName: responseLabel,
        confidence: 0,
        method: 'jev',
      },
      matchedRuleId: null,
      matchedLabel,
      responseType,
      responseLabel,
      decision: null,
    };
  }
}

export const __testing = { RESPONSE_LABELS, fallbackTemplate, answerOutcome, toJevHistory };
