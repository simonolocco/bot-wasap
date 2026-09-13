import assert from 'node:assert/strict';
import { classifyQuestionLabel, type AiLabelCandidate } from '../src/ai/labelClassifier';
import type { Complete } from '../src/ai/openRouter';

const envios: AiLabelCandidate = {
  id: 'label-envios',
  name: 'envios',
  answer: 'Coordinamos el traslado con un comisionista.',
  examples: ['hacen envios?', 'envios hacen?'],
};
const pagos: AiLabelCandidate = {
  id: 'label-pagos',
  name: 'pagos',
  answer: 'Consultá los medios disponibles.',
  examples: ['qué medios de pago tienen?'],
};

async function main() {
  for (const question of [
    'Traen a domicilio? estoy en zona sur',
    'hacen envios?',
    'envios hacen?',
    'realizan entregas en zona sur?',
    'llevan pedidos hasta mi casa?',
  ]) {
    const result = await classifyQuestionLabel(question, [envios, pagos]);
    assert.equal(result.existingLabelId, envios.id, `Debe reutilizar envios: ${question}`);
    assert.ok(result.confidence >= 0.78);
  }

  assert.equal((await classifyQuestionLabel('¿qué medios de pago tienen?', [envios, pagos])).existingLabelId, pagos.id);
  assert.equal((await classifyQuestionLabel('¿dónde está el domicilio del local?', [envios, pagos])).existingLabelId, null,
    'El domicilio del local no debe confundirse con entregas.');
  assert.equal((await classifyQuestionLabel('¿Entregan factura A?', [envios, pagos])).existingLabelId, null,
    'Entregar una factura no debe confundirse con entregas a domicilio.');

  const newShipping = await classifyQuestionLabel('Traen a domicilio?', []);
  assert.equal(newShipping.suggestedName, 'envios');
  assert.equal(newShipping.method, 'semantic');

  assert.equal((await classifyQuestionLabel('pregunta es por mayor menor no se puede comprar', [])).suggestedName, 'minorista');
  assert.equal((await classifyQuestionLabel('Hay que comprar 24 hormas para que quede el precio?', [])).suggestedName, 'compra-minima');
  assert.equal((await classifyQuestionLabel('tenés cremoso?', [])).suggestedName, 'stock');
  assert.equal((await classifyQuestionLabel('¿Cuántos trae la caja?', [])).suggestedName, 'unidades-por-caja');
  assert.equal((await classifyQuestionLabel('Te interesa trabajar los lácteos de Arroyo Cabral?', [])).suggestedName, 'proveedores');
  assert.equal((await classifyQuestionLabel('Te hago una consulta: queso sardo?', [])).suggestedName, 'stock');
  for (const unclear of ['iaHWSASD', 'Perdón...7108', 'asdjkahsd', '???']) {
    const result = await classifyQuestionLabel(unclear, []);
    assert.equal(result.suggestedName, 'pregunta-no-entendible');
    assert.equal(result.method, 'unintelligible');
  }

  const ambiguous = await classifyQuestionLabel('hacen entrega?', [
    { ...envios, id: 'envios-a', name: 'envios zona norte' },
    { ...envios, id: 'envios-b', name: 'envios zona sur' },
  ]);
  assert.equal(ambiguous.method, 'ambiguous');
  assert.equal(ambiguous.existingLabelId, null);
  assert.equal(ambiguous.suggestedName, null,
    'Un empate debe quedar sin tema; no convierte una pregunta entendible en ruido.');

  let calls = 0;
  const model: Complete = async (_messages, options) => {
    calls += 1;
    assert.ok(options?.schema);
    return { content: JSON.stringify({ existingLabelId: '', suggestedName: 'facturacion', confidence: 0.91 }), model: 'test', tokens: 1 };
  };
  const semantic = await classifyQuestionLabel('¿hacen factura A?', [envios, pagos], model);
  assert.equal(calls, 1);
  assert.equal(semantic.suggestedName, 'facturacion');
  assert.equal(semantic.existingLabelId, null);

  const invalidIdModel: Complete = async () => ({
    content: JSON.stringify({ existingLabelId: 'invented-id', suggestedName: '', confidence: 0.99 }), model: 'test', tokens: 1,
  });
  const invalid = await classifyQuestionLabel('consulta desconocida', [envios], invalidIdModel);
  assert.equal(invalid.existingLabelId, null, 'El proveedor no puede inventar IDs de etiquetas.');
  assert.equal(invalid.suggestedName, null, 'Una consulta entendible puede quedar sin etiqueta sin tratarse como ruido.');
  assert.equal(invalid.method, 'none');

  console.log('AI label classifier tests: OK');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
