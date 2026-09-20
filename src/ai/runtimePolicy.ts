import type { Answer } from './assistant';
import type { AiLabelClassification } from './labelClassifier';
import { AI_UNCLEAR_LABEL_NAME, normalizeAiTopic } from './labelPolicy';

const TOPIC_NAMES: Record<string, string> = {
  shipping: 'envios',
  address: 'direccion',
  hours: 'horarios',
  minimum: 'compra-minima',
  retail: 'minorista',
  payments: 'pagos',
  holiday: 'feriados',
  catalog_problem: 'problema-catalogo',
  information: 'informacion',
};

export function deriveSuggestedAiTopic(classification: AiLabelClassification, answer: Answer | null) {
  const classified = normalizeAiTopic(classification.suggestedName);
  if (classified && classified !== AI_UNCLEAR_LABEL_NAME) return classified;

  const intent = answer?.intent;
  if (!intent) return null;
  if (intent.complaint) return 'reclamos';
  if (intent.externalProposal) return 'proveedores';
  if (intent.order) return 'pedidos';
  if (intent.stock) return 'stock';
  if (intent.catalog) return 'catalogo';
  if (intent.productQuery) return 'productos';
  const topic = intent.topics.map(value => TOPIC_NAMES[value]).find(Boolean);
  if (topic) return topic;
  if (intent.human) return 'asesor';
  if (intent.social === 'greeting') return 'saludos';
  if (intent.social === 'thanks' || intent.social === 'goodbye') return 'agradecimientos';
  if (intent.unknown) return 'consulta-general';
  return answer?.text.trim() ? 'consulta-general' : null;
}

export function learningConfidence(classification: AiLabelClassification, answer: Answer | null) {
  if (classification.suggestedName && normalizeAiTopic(classification.suggestedName) !== AI_UNCLEAR_LABEL_NAME) {
    return classification.confidence;
  }
  return answer?.intent ? 0.9 : 0;
}

export function aiReviewStatus(input: {
  source: 'production' | 'manual';
  aiEnabled: boolean;
  outcome: string;
  responseSent: boolean;
  unintelligible: boolean;
}): 'pending' | 'resolved' | 'ignored' {
  if (input.source === 'manual' || input.unintelligible || input.outcome === 'silence') return 'ignored';
  if (!input.aiEnabled || input.outcome === 'disabled') return 'pending';
  if (input.responseSent || ['answered', 'clarify', 'handoff', 'unavailable', 'paused'].includes(input.outcome)) return 'resolved';
  return 'pending';
}
