import { z } from 'zod';
import { normalizeText } from '../botMenu';
import { intentExampleScore } from './intentMatcher';
import { parseJson, type Complete } from './openRouter';
import { isUnintelligibleQuestion } from './inputQuality';

export type AiLabelCandidate = {
  id: string;
  name: string;
  answer: string;
  examples: string[];
};

export type AiLabelClassification = {
  existingLabelId: string | null;
  suggestedName: string | null;
  confidence: number;
  method: 'exact' | 'fuzzy' | 'semantic' | 'fallback' | 'ambiguous' | 'unintelligible' | 'none';
};

const resultSchema = z.object({
  existingLabelId: z.string().max(100),
  suggestedName: z.string().max(80),
  confidence: z.number().min(0).max(1),
});

const resultJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    existingLabelId: { type: 'string', maxLength: 100 },
    suggestedName: { type: 'string', maxLength: 80 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['existingLabelId', 'suggestedName', 'confidence'],
};

type SemanticFamily = { name: string; patterns: RegExp[] };

const semanticFamilies: SemanticFamily[] = [
  {
    name: 'pregunta-no-entendible',
    patterns: [
      /^(?:perdon\s*)?\d{3,}$/i,
      /^(?:asdf\w*|qwer\w*|zxcv\w*|hjkl\w*)$/i,
    ],
  },
  {
    name: 'envios',
    patterns: [
      /\b(envios?|enviar|envian|despach\w*|repart\w*|delivery)\b/i,
      /\b(hacen|realizan|coordinan)\b.{0,25}\bentregas?\b/i,
      /\bentreg\w*\b.{0,45}\b(domicilio|casa|zona|barrio|pedido|productos?|mercaderia)\b/i,
      /\b(traen?|llevan?|mandan?|acercan?)\b.{0,45}\b(domicilio|casa|zona|barrio|pedido|mercaderia)\b/i,
      /\b(domicilio|casa|zona|barrio)\b.{0,45}\b(traen?|llevan?|mandan?|acercan?|entregan?|reparten?)\b/i,
    ],
  },
  { name: 'pagos', patterns: [/\b(pagos?|abonar|efectivo|transferencia|tarjetas?|cuotas?|mercado pago)\b/i] },
  { name: 'horarios', patterns: [/\b(horarios?|abren|cierran|atienden|hasta que hora)\b/i] },
  { name: 'direccion', patterns: [/\b(direccion|ubicacion|donde (?:queda|estan|se encuentran)|domicilio (?:del|de el|de la) local)\b/i] },
  { name: 'catalogo', patterns: [/\b(catalogos?|listas? de precios?|productos y precios|precios mayoristas?)\b/i] },
  {
    name: 'minorista',
    patterns: [
      /\b(minorista|venta al publico|por menor|particulares?)\b/i,
      /\bpor mayor\b.{0,20}\b(?:por )?menor\b/i,
      /\bmenor\b.{0,25}\b(comprar|compra|venden)\b/i,
    ],
  },
  {
    name: 'compra-minima',
    patterns: [
      /\b(compra|minimo|monto)\b.{0,30}\b(minima|minimo)\b|\bminimo\b.{0,30}\b(compra|pedido)\b/i,
      /\b(hay que|tengo que|debo)\b.{0,20}\b(comprar|llevar)\b.{0,30}\b(precio|mayorista)\b/i,
      /\bcomprar\b.{0,12}\b\d+\b.{0,20}\b(hormas?|unidades?|cajas?|bultos?)\b/i,
    ],
  },
  {
    name: 'stock',
    patterns: [
      /\b(stock|disponibilidad|disponible)\b/i,
      /\b(hay|tenes|tienen)\b.{0,25}\b(cremoso|manteca|queso|fiambre|sardo|tybo|muzzarella|jamon|salame|panceta|ricota|cheddar)\b/i,
      /\b(consulta|busco|necesito|venden)\b.{0,35}\b(cremoso|manteca|queso|fiambre|sardo|tybo|muzzarella|jamon|salame|panceta|ricota|cheddar)\b/i,
    ],
  },
  {
    name: 'unidades-por-caja',
    patterns: [
      /\b(cuantas?|cantidad)\b.{0,30}\b(unidades?|piezas?|hormas?|kilos?|kg|bultos?)\b/i,
      /\b(cuant[oa]s?|cantas?)\b.{0,25}\b(trae|tre|viene|entran?)\b.{0,25}\b(caja|bulto)\b/i,
      /\b(unidades?|piezas?|hormas?|kilos?|kg|bultos?)\b.{0,30}\b(caja|cajas|bulto|trae|viene|contiene)\b/i,
      /\b(caja|cajas|bulto)\b.{0,30}\b(unidades?|piezas?|hormas?|kilos?|kg|trae|viene|contiene)\b/i,
      /\bfraccionado\b.{0,20}\bpor caja\b/i,
    ],
  },
  {
    name: 'proveedores',
    patterns: [
      /\b(te interesa|les interesa|quieren)\b.{0,45}\b(trabajar|vender|comercializar|distribuir)\b/i,
      /\b(somos|soy)\b.{0,25}\b(proveedores?|fabricantes?|distribuidores?)\b/i,
      /\b(proveedores?|fabricantes?|distribuidores?)\b.{0,40}\b(de|productos?)\b/i,
      /\bproductos?\b.{0,80}\b(cadena de distribucion|distribuidora mayorista)\b/i,
      /\bponer\b.{0,35}\bproductos?\b.{0,40}\bdistribuidora\b/i,
      /\b(ofrecerles?|presentarles?)\b.{0,35}\b(productos?|catalogo|lista)\b/i,
      /\barea de compras\b/i,
    ],
  },
];

export function semanticFamily(value: string) {
  const normalized = normalizeText(value);
  return semanticFamilies.find(family => family.patterns.some(pattern => pattern.test(normalized)))?.name ?? null;
}

export function normalizeSuggestedName(value: string) {
  return normalizeText(value)
    .split(' ')
    .filter(Boolean)
    .slice(0, 4)
    .join('-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function unclearFallback(candidates: AiLabelCandidate[], confidence: number): AiLabelClassification {
  const existing = candidates.filter(candidate => normalizeSuggestedName(candidate.name) === 'pregunta-no-entendible');
  return existing.length === 1
    ? { existingLabelId: existing[0].id, suggestedName: existing[0].name, confidence, method: 'fallback' }
    : { existingLabelId: null, suggestedName: 'pregunta-no-entendible', confidence, method: 'fallback' };
}

function localClassification(question: string, candidates: AiLabelCandidate[]): AiLabelClassification | null {
  const normalized = normalizeText(question);
  if (isUnintelligibleQuestion(question)) {
    return { ...unclearFallback(candidates, 0.96), method: 'unintelligible' };
  }
  if (!normalized) return { existingLabelId: null, suggestedName: null, confidence: 0, method: 'none' };

  for (const candidate of candidates) {
    const exact = [candidate.name, ...candidate.examples].some(example => normalizeText(example) === normalized);
    if (exact) return { existingLabelId: candidate.id, suggestedName: candidate.name, confidence: 1, method: 'exact' };
  }

  const queryFamily = semanticFamily(normalized);
  if (queryFamily) {
    const familyMatches = candidates.filter(candidate =>
      semanticFamily(candidate.name) === queryFamily || candidate.examples.some(example => semanticFamily(example) === queryFamily));
    if (familyMatches.length === 1) {
      return { existingLabelId: familyMatches[0].id, suggestedName: familyMatches[0].name, confidence: 0.96, method: 'semantic' };
    }
    if (familyMatches.length > 1) {
      return { existingLabelId: null, suggestedName: null, confidence: 0, method: 'ambiguous' };
    }
  }

  const scored = candidates.map(candidate => ({
    candidate,
    score: Math.max(0, ...[candidate.name, ...candidate.examples].map(example => intentExampleScore(normalized, example))),
  })).sort((a, b) => b.score - a.score);
  if (scored[0]?.score >= 0.72) {
    if (scored[1] && scored[1].score >= 0.72 && scored[0].score - scored[1].score < 0.08) {
      return { existingLabelId: null, suggestedName: null, confidence: scored[0].score, method: 'ambiguous' };
    }
    return { existingLabelId: scored[0].candidate.id, suggestedName: scored[0].candidate.name, confidence: scored[0].score, method: 'fuzzy' };
  }

  return queryFamily
    ? { existingLabelId: null, suggestedName: queryFamily, confidence: 0.9, method: 'semantic' }
    : null;
}

/**
 * Classifies only the topic/label of an unanswered question. It never writes a
 * customer answer. Existing labels are preferred and ambiguous matches abstain.
 */
export async function classifyQuestionLabel(
  question: string,
  candidates: AiLabelCandidate[],
  complete?: Complete,
): Promise<AiLabelClassification> {
  const local = localClassification(question, candidates);
  if (local) return local;
  if (!complete) return { existingLabelId: null, suggestedName: null, confidence: 0, method: 'none' };

  const compactCandidates = candidates.slice(0, 100).map(candidate => ({
    id: candidate.id,
    name: candidate.name,
    examples: candidate.examples.slice(0, 12),
  }));
  try {
    const completion = await complete([
      {
        role: 'system',
        content: [
          'Clasificás preguntas comerciales de clientes en etiquetas administradas por una persona.',
          'Elegí un existingLabelId únicamente cuando la intención sea la misma aunque cambien las palabras.',
          'Si no coincide, dejá existingLabelId vacío y proponé suggestedName en español, corto (1 a 3 palabras), estable y sin datos personales.',
          'No inventes respuestas. Ante empate o duda, devolvé ambos strings vacíos y confianza menor a 0.70.',
        ].join(' '),
      },
      { role: 'user', content: JSON.stringify({ question, existingLabels: compactCandidates }) },
    ], { schema: resultJsonSchema, maxTokens: 180, timeoutMs: 12_000 });
    const parsed = resultSchema.parse(parseJson(completion.content));
    const candidate = candidates.find(item => item.id === parsed.existingLabelId);
    if (candidate && parsed.confidence >= 0.78) {
      return { existingLabelId: candidate.id, suggestedName: candidate.name, confidence: parsed.confidence, method: 'semantic' };
    }
    const suggestedName = normalizeSuggestedName(parsed.suggestedName);
    if (!parsed.existingLabelId && suggestedName && parsed.confidence >= 0.74) {
      const sameName = candidates.find(item => normalizeSuggestedName(item.name) === suggestedName);
      return sameName
        ? { existingLabelId: sameName.id, suggestedName: sameName.name, confidence: parsed.confidence, method: 'semantic' }
        : { existingLabelId: null, suggestedName, confidence: parsed.confidence, method: 'semantic' };
    }
    return { existingLabelId: null, suggestedName: null, confidence: parsed.confidence, method: 'none' };
  } catch {
    return { existingLabelId: null, suggestedName: null, confidence: 0, method: 'none' };
  }
}

export const __testing = { semanticFamily, normalizeSuggestedName };
