import assert from 'node:assert/strict';
import { intentExampleScore, matchIntent } from '../src/ai/intentMatcher';

const intents = [
  { id: 'envios', label: 'envios', examples: ['hacen envios??', 'envios hacen??'] },
  { id: 'pagos', label: 'pagos', examples: ['formas de pago', 'medios de pago'] },
  { id: 'minorista', label: 'minorista', examples: ['minorista', 'vendemos por menor y también atendemos mayoristas'] },
];

for (const question of ['hacen envios??', 'envios hacen??', 'enviozz hacen??', '¿hacen envíos?']) {
  const result = matchIntent(question, intents);
  assert.equal(result?.intent.id, 'envios', `La variante debería resolver envios: ${question}`);
  assert.ok((result?.score ?? 0) >= 0.72, `Confianza insuficiente para ${question}`);
}

assert.equal(matchIntent('qué medios de pago tienen?', intents)?.intent.id, undefined,
  'Una pregunta nueva debe quedar para revisión si no hay un alias suficientemente claro.');
assert.equal(matchIntent('hacen pagos??', intents)?.intent.id, undefined,
  'No se debe cruzar una intención de envíos con pagos por compartir "hacen".');
assert.equal(matchIntent('venden por menor?', intents)?.intent.id, 'minorista',
  'Una pregunta equivalente debe reconocer la etiqueta por el ejemplo de respuesta.');
assert.ok(intentExampleScore('enviozz hacen??', 'hacen envios??') >= 0.72);

console.log('AI intent matcher tests: OK');
