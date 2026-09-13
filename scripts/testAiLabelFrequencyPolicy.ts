import assert from 'node:assert/strict';
import {
  AUTO_LABEL_MIN_30D_CONTACTS,
  AUTO_LABEL_MIN_30D_EVENTS,
  AUTO_LABEL_MIN_7D_CONTACTS,
  canonicalAutoLabelAnswer,
  decideAiLabelPromotion,
} from '../src/ai/labelPolicy';

type PromotionDecision = ReturnType<typeof decideAiLabelPromotion>;

const FREQUENT_LABELS = [
  'envios',
  'minorista',
  'compra-minima',
  'stock',
  'unidades-por-caja',
  'proveedores',
] as const;

function assertUsefulAnswer(labelName: string, answer: string) {
  assert.ok(answer.trim(), `La etiqueta ${labelName} debe nacer con una respuesta no vacía.`);
}

function assertNotPromoted(decision: PromotionDecision, expectedTopic: string, context: string) {
  assert.equal(decision.promoted, false, `${context}: no debe crear una etiqueta automática.`);
  assert.equal(decision.labelName, expectedTopic, `${context}: debe conservar el tema real para aprendizaje.`);
  assert.equal(decision.answer, '', `${context}: no debe inventar una respuesta ni convertirlo en ruido.`);
}

assert.equal(AUTO_LABEL_MIN_30D_EVENTS, 6, 'El umbral mensual debe requerir 6 consultas.');
assert.equal(AUTO_LABEL_MIN_30D_CONTACTS, 5, 'El umbral mensual debe requerir 5 contactos distintos.');
assert.equal(AUTO_LABEL_MIN_7D_CONTACTS, 3, 'El pico semanal debe requerir 3 contactos distintos.');

for (const labelName of FREQUENT_LABELS) {
  assertUsefulAnswer(labelName, canonicalAutoLabelAnswer(labelName));
}

const monthlyThreshold = decideAiLabelPromotion({
  suggestedName: 'envios',
  confidence: 0.8,
  stats: { events30d: 6, contacts30d: 5, contacts7d: 2 },
});
assert.equal(monthlyThreshold.promoted, true, 'El umbral mensual exacto debe promover la etiqueta.');
assert.equal(monthlyThreshold.labelName, 'envios');
assert.equal(monthlyThreshold.answer, canonicalAutoLabelAnswer('envios'));
assertUsefulAnswer(monthlyThreshold.labelName, monthlyThreshold.answer);

const weeklySpike = decideAiLabelPromotion({
  suggestedName: 'minorista',
  confidence: 0.95,
  stats: { events30d: 3, contacts30d: 3, contacts7d: 3 },
});
assert.equal(weeklySpike.promoted, true, 'Tres contactos en 7 días deben promover un tema recurrente.');
assert.equal(weeklySpike.labelName, 'minorista');
assert.equal(weeklySpike.answer, canonicalAutoLabelAnswer('minorista'));

assertNotPromoted(decideAiLabelPromotion({
  suggestedName: 'unidades-por-caja',
  confidence: 0.96,
  stats: { events30d: 1, contacts30d: 1, contacts7d: 1 },
}), 'unidades-por-caja', 'Una consulta aislada aunque sea comprensible');

assertNotPromoted(decideAiLabelPromotion({
  suggestedName: 'envios',
  confidence: 0.79,
  stats: { events30d: 20, contacts30d: 12, contacts7d: 8 },
}), 'envios', 'Una clasificación con confianza menor a 0.8');

for (const menuTopic of ['catalogo', 'direccion', 'horarios']) {
  assertNotPromoted(decideAiLabelPromotion({
    suggestedName: menuTopic,
    confidence: 0.99,
    stats: { events30d: 100, contacts30d: 80, contacts7d: 20 },
  }), menuTopic, `El tema de menú ${menuTopic}`);
}

assertNotPromoted(decideAiLabelPromotion({
  suggestedName: 'consulta-sello-roto',
  confidence: 0.99,
  stats: { events30d: 5, contacts30d: 4, contacts7d: 2 },
}), 'consulta-sello-roto', 'Un nombre arbitrario por debajo de todos los umbrales');

assertNotPromoted(decideAiLabelPromotion({
  suggestedName: 'tema-frecuente-sin-respuesta-canonica',
  confidence: 0.99,
  stats: { events30d: 20, contacts30d: 12, contacts7d: 8 },
}), 'tema-frecuente-sin-respuesta-canonica', 'Un tema sin respuesta canónica aunque supere los umbrales');

const fallbackAnswer = canonicalAutoLabelAnswer('pregunta-no-entendible');
assertUsefulAnswer('pregunta-no-entendible', fallbackAnswer);
assert.match(fallbackAnswer, /Mauricio/i, 'La respuesta canónica de fallback debe incluir a Mauricio.');

console.log('AI label frequency policy tests: OK');
