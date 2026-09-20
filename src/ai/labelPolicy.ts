import { normalizeText } from '../botMenu';

export const AI_UNCLEAR_LABEL_NAME = 'pregunta-no-entendible';
export const AUTO_LABEL_MIN_CONFIDENCE = 0.8;
export const AUTO_LABEL_MIN_30D_EVENTS = 6;
export const AUTO_LABEL_MIN_30D_CONTACTS = 5;
export const AUTO_LABEL_MIN_7D_CONTACTS = 3;

const MAURICIO_URL = 'https://wa.me/5493517565641';

export const AI_UNCLEAR_LABEL_ANSWER = [
  'No llegué a reconocer una consulta en ese mensaje. ¿Podés escribirla de otra forma?',
  '',
  `Si preferís, podés hablar con Mauricio, nuestro asesor comercial: ${MAURICIO_URL}`,
].join('\n');

const MENU_OWNED_TOPICS = new Set(['catalogo', 'direccion', 'horarios', 'asesor']);

const CANONICAL_ANSWERS: Record<string, string> = {
  envios: [
    'Trabajamos con retiro coordinado. Podés enviarnos tu pedido con anticipación y retirarlo listo,',
    'o coordinar el traslado mediante un comisionista, servicio de traslado o transporte de confianza.',
    '',
    `Mauricio puede ayudarte a coordinarlo: ${MAURICIO_URL}`,
  ].join(' '),
  minorista: [
    'Atendemos tanto a clientes mayoristas como minoristas.',
    'La compra mínima es de 1/2 horma en adelante.',
  ].join(' '),
  'compra-minima': [
    'La compra mínima es de 1/2 horma en adelante.',
    'Podés indicarnos qué producto buscás para ayudarte con la presentación disponible.',
  ].join(' '),
  saludos: '¡Hola! Bienvenido/a a Distribuidora Abasto del Campo 👋 ¿En qué podemos ayudarte hoy?',
  agradecimientos: '¡Gracias por escribirnos! Estamos a tu disposición.',
  'consulta-general': '¿En qué podemos ayudarte? Podés consultar precios, catálogo, horarios, envíos o contactar a un asesor.',
  stock: [
    'El stock cambia durante el día y no puedo confirmarlo en tiempo real.',
    `Mauricio te confirma disponibilidad y presentación del producto: ${MAURICIO_URL}`,
  ].join(' '),
  'unidades-por-caja': [
    'La cantidad de unidades, kilos o piezas por caja cambia según el producto y la marca.',
    `Mauricio te confirma la presentación exacta: ${MAURICIO_URL}`,
  ].join(' '),
  proveedores: [
    'Este canal está destinado a consultas de clientes y ventas.',
    `Para propuestas de proveedores, comunicate con Mauricio, nuestro asesor comercial: ${MAURICIO_URL}`,
  ].join(' '),
  [AI_UNCLEAR_LABEL_NAME]: AI_UNCLEAR_LABEL_ANSWER,
};

export type AiLabelFrequencyStats = {
  events30d: number;
  contacts30d: number;
  contacts7d: number;
};

export type AiLabelPromotionDecision = {
  labelName: string;
  answer: string;
  promoted: boolean;
};

export function normalizeAiTopic(value: string | null | undefined) {
  return normalizeText(value).replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function canonicalAutoLabelAnswer(name: string | null | undefined) {
  return CANONICAL_ANSWERS[normalizeAiTopic(name)] ?? '';
}

export function isMenuOwnedAiTopic(name: string | null | undefined) {
  return MENU_OWNED_TOPICS.has(normalizeAiTopic(name));
}

export function decideAiLabelPromotion(input: {
  suggestedName: string | null | undefined;
  confidence: number;
  stats: AiLabelFrequencyStats;
}): AiLabelPromotionDecision {
  const topic = normalizeAiTopic(input.suggestedName);
  const frequent = input.stats.events30d >= AUTO_LABEL_MIN_30D_EVENTS
    && input.stats.contacts30d >= AUTO_LABEL_MIN_30D_CONTACTS;
  const recentSpike = input.stats.contacts7d >= AUTO_LABEL_MIN_7D_CONTACTS;
  const answer = canonicalAutoLabelAnswer(topic);
  const eligible = !!topic
    && topic !== AI_UNCLEAR_LABEL_NAME
    && !isMenuOwnedAiTopic(topic)
    && input.confidence >= AUTO_LABEL_MIN_CONFIDENCE
    && (frequent || recentSpike)
    && !!answer.trim();

  if (!eligible) {
    return { labelName: topic, answer: '', promoted: false };
  }
  return { labelName: topic, answer, promoted: true };
}
