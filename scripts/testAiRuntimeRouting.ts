import assert from 'node:assert/strict';
import { emptyCatalog } from '../src/ai/catalog';
import type { Complete } from '../src/ai/openRouter';
import { AiProviderError } from '../src/ai/openRouter';
import { resolveCustomerAiResponse } from '../src/ai/queryResolver';
import { aiReviewStatus, deriveSuggestedAiTopic } from '../src/ai/runtimePolicy';
import type { Intent } from '../src/ai/assistant';

const catalog = emptyCatalog();
const intent = {
  topics: [] as string[], productQuery: '', tier: 'unknown', catalog: false,
  human: false, order: false, stock: false, social: 'none', unknown: true,
};

async function main() {
  let providerCalls = 0;
  const unknownComplete: Complete = async () => {
    providerCalls += 1;
    return { content: JSON.stringify(intent), model: 'routing-test', tokens: 4 };
  };

  const meaningful = await resolveCustomerAiResponse({
    question: '¿Emiten factura A?', catalog, complete: unknownComplete,
    allowCustomerResponse: true, labels: [],
  });
  assert.equal(meaningful.source, 'generated');
  assert.ok(meaningful.answer?.text.trim(), 'Una pregunta entendible siempre debe recibir texto.');
  assert.equal(meaningful.sendMenuAfter, true, 'Toda respuesta generada con texto debe terminar con el menú.');
  assert.equal(meaningful.answer?.outcome, 'clarify');
  assert.equal(providerCalls, 1);

  const location = await resolveCustomerAiResponse({
    question: '¿Eres de Río Cuarto?', catalog,
    complete: async () => { throw new Error('La pregunta de ubicación debe resolverse aun sin proveedor.'); },
    allowCustomerResponse: true, labels: [],
  });
  assert.match(location.answer?.text ?? '', /Av\. Juan B\. Justo 5048|Córdoba Capital/,
    'La consulta de la captura debe mostrar la respuesta concreta de ubicación.');

  const fallbackRule = await resolveCustomerAiResponse({
    question: '¿Emiten factura A?', catalog, complete: unknownComplete, allowCustomerResponse: true, labels: [],
    savedRule: { id: 'bad-rule', answer: 'No entendí', label: 'pregunta-no-entendible', labelId: 'fallback' },
  });
  assert.equal(fallbackRule.source, 'generated', 'Una regla fallback histórica nunca debe bloquear la respuesta real.');
  assert.equal(providerCalls, 2);

  const approved = await resolveCustomerAiResponse({
    question: '¿Aceptan transferencia?', catalog, complete: unknownComplete, allowCustomerResponse: true,
    labels: [{ id: 'pagos', name: 'pagos', answer: 'Aceptamos transferencia.', examples: ['medios de pago'] }],
  });
  assert.equal(approved.source, 'approved-label');
  assert.equal(approved.answer?.text, 'Aceptamos transferencia.');
  assert.equal(approved.sendMenuAfter, true, 'Una etiqueta aprobada no necesita marcador para enviar el menú.');
  assert.equal(providerCalls, 2, 'Una etiqueta aprobada no debe consumir una llamada al proveedor.');

  const approvedWhileOff = await resolveCustomerAiResponse({
    question: '¿Aceptan transferencia?', catalog, complete: unknownComplete, allowCustomerResponse: false,
    labels: [{ id: 'pagos', name: 'pagos', answer: 'Aceptamos transferencia.', examples: ['medios de pago'] }],
  });
  assert.equal(approvedWhileOff.source, 'disabled');
  assert.equal(approvedWhileOff.answer, null, 'Con la IA apagada una etiqueta aprobada no responde al cliente.');
  assert.equal(approvedWhileOff.matchedLabel?.id, 'pagos', 'La coincidencia se conserva para preparar la vista previa privada.');
  assert.equal(providerCalls, 2, 'El modo apagado tampoco llama al proveedor al reconocer una etiqueta.');

  const savedWhileOff = await resolveCustomerAiResponse({
    question: '¿Hacen envíos?', catalog, complete: unknownComplete, allowCustomerResponse: false, labels: [],
    savedRule: { id: 'envios-rule', answer: 'Coordinamos el traslado.', label: 'envios', labelId: 'envios' },
  });
  assert.equal(savedWhileOff.source, 'disabled');
  assert.equal(savedWhileOff.answer, null, 'Con la IA apagada una regla exacta tampoco responde al cliente.');
  assert.equal(savedWhileOff.matchedRuleId, 'envios-rule', 'La regla se conserva para la vista previa privada.');
  assert.equal(providerCalls, 2);

  const savedWhileOn = await resolveCustomerAiResponse({
    question: '¿Hacen envíos?', catalog, complete: unknownComplete, allowCustomerResponse: true, labels: [],
    savedRule: { id: 'envios-rule', answer: 'Coordinamos el traslado.', label: 'envios', labelId: 'envios' },
  });
  assert.equal(savedWhileOn.source, 'saved-rule');
  assert.equal(savedWhileOn.sendMenuAfter, true, 'Toda respuesta exacta guardada debe terminar con el menú.');

  const disabled = await resolveCustomerAiResponse({
    question: '¿Emiten factura A?', catalog, complete: unknownComplete, allowCustomerResponse: false, labels: [],
  });
  assert.equal(disabled.source, 'disabled');
  assert.equal(disabled.answer, null);
  assert.equal(disabled.sendMenuAfter, false);
  assert.equal(providerCalls, 2, 'El interruptor apagado no debe llamar al proveedor.');

  const garbage = await resolveCustomerAiResponse({
    question: 'asdjkahsd', catalog, complete: unknownComplete, allowCustomerResponse: true, labels: [],
  });
  assert.equal(garbage.classification.method, 'unintelligible');
  assert.equal(garbage.answer?.outcome, 'clarify');
  assert.ok(garbage.answer?.text.trim());
  assert.equal(providerCalls, 2, 'El ruido claro se resuelve localmente.');

  const contextComplete: Complete = async () => ({
    content: JSON.stringify({ ...intent, unknown: false, catalog: true }), model: 'routing-test', tokens: 3,
  });
  const contextual = await resolveCustomerAiResponse({
    question: 'Sí', history: [{ role: 'assistant', content: '¿Querés que te pase el catálogo?' }],
    catalog, complete: contextComplete, allowCustomerResponse: true, labels: [],
  });
  assert.notEqual(contextual.answer?.outcome, 'silence', 'Sí debe usar el contexto de la pregunta anterior.');
  assert.ok(contextual.answer?.text.trim());

  const failingComplete: Complete = async () => { throw new AiProviderError('rate_limit', 'limited'); };
  const unavailable = await resolveCustomerAiResponse({
    question: '¿Trabajan con cuenta corriente?', catalog, complete: failingComplete, allowCustomerResponse: true, labels: [],
  });
  assert.equal(unavailable.answer?.outcome, 'unavailable');
  assert.equal(unavailable.answer?.errorCode, 'rate_limit');
  assert.ok(unavailable.answer?.text.trim(), 'Una caída del proveedor también debe dejar una respuesta al cliente.');
  assert.equal(unavailable.sendMenuAfter, true, 'La respuesta de contingencia también debe devolver el menú.');

  assert.equal(aiReviewStatus({ source: 'production', aiEnabled: true, outcome: 'answered', responseSent: true, unintelligible: false }), 'resolved');
  assert.equal(aiReviewStatus({ source: 'production', aiEnabled: true, outcome: 'unavailable', responseSent: true, unintelligible: false }), 'resolved');
  assert.equal(aiReviewStatus({ source: 'production', aiEnabled: false, outcome: 'disabled', responseSent: false, unintelligible: false }), 'pending');
  assert.equal(aiReviewStatus({ source: 'production', aiEnabled: true, outcome: 'clarify', responseSent: true, unintelligible: true }), 'ignored');
  assert.equal(deriveSuggestedAiTopic({ existingLabelId: null, suggestedName: 'pagos', confidence: .9, method: 'semantic' }, meaningful.answer), 'pagos');
  assert.equal(deriveSuggestedAiTopic({ existingLabelId: null, suggestedName: null, confidence: 0, method: 'none' }, {
    ...meaningful.answer!, intent: { ...intent, social: 'greeting', unknown: false } as Intent,
  }), 'saludos');
  assert.equal(deriveSuggestedAiTopic({ existingLabelId: null, suggestedName: null, confidence: 0, method: 'none' }, meaningful.answer), 'consulta-general');

  console.log('AI runtime routing tests: OK');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
