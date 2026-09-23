import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { closePool, query } from '../src/db/pool';
import { listAiQueryLogs, recordAiQuery } from '../src/db/repository';
import { generateAndStoreAiQueryPreview } from '../src/services/aiPreviewProcessor';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL es obligatorio para esta prueba aislada.');
  const providerMessageId = `qa-preview-${randomUUID()}`;
  let createdDraftId = '';
  try {
    const log = await recordAiQuery({
      providerMessageId,
      question: '¿Eres de Río Cuarto?',
      answer: '',
      outcome: 'disabled',
      source: 'production',
      aiEnabled: false,
      reviewStatus: 'pending',
    });
    const result = await generateAndStoreAiQueryPreview(log.id, {
      force: true,
      dependencies: {
        labels: [],
        clientOptions: {
          apiKey: 'qa-preview-key',
          fetchImpl: async () => new Response(JSON.stringify({
            model: 'typesafe/jev-1.13-qa',
            answers: {
              response_type: {
                type: 'choice',
                choice: 'address',
                probabilities: { address: 0.96, business_info: 0.04 },
                confidence: 0.92,
              },
              urgency: {
                type: 'score',
                score: 0,
                probabilities: { 0: 1, 1: 0, 2: 0 },
                confidence: 1,
              },
              human_attention: { type: 'noul', noul: 0 },
            },
            usage: { inputTokens: 18, outputTokens: 3, cost: 0.000001 },
          }), { status: 200, headers: { 'content-type': 'application/json' } }),
        },
      },
    });
    assert.equal(result.status, 'processed');
    const stored = (await listAiQueryLogs({ q: 'Río Cuarto', view: 'all' })).items.find(item => item.id === log.id)!;
    assert.equal(stored.answer, '', 'La simulación privada no puede convertirse en un mensaje enviado.');
    assert.match(stored.previewAnswer ?? '', /Av\. Juan B\. Justo 5048|Córdoba Capital/);
    assert.equal(stored.previewOutcome, 'answered');
    assert.equal(stored.previewSource, 'jev-template');
    assert.equal(stored.suggestedLabelName, 'direccion');
    assert.ok(stored.suggestedLabelId, 'La IA debe crear y seleccionar un borrador de etiqueta para el tema nuevo.');
    const draft = (await query<{ id: string; active: boolean; createdBy: string | null }>(
      'SELECT id, active, created_by AS "createdBy" FROM ai_answer_labels WHERE id=$1', [stored.suggestedLabelId])).rows[0];
    if (draft?.createdBy === 'ai-auto-preview') {
      createdDraftId = draft.id;
      assert.equal(draft.active, false, 'El borrador automático no puede responder a clientes antes de aprobarse.');
    }
    assert.ok(stored.previewGeneratedAt);
    console.log('AI private preview pipeline tests: OK');
  } finally {
    await query('DELETE FROM ai_query_logs WHERE provider_message_id=$1', [providerMessageId]);
    if (createdDraftId) await query('DELETE FROM ai_answer_labels WHERE id=$1', [createdDraftId]);
    await closePool();
  }
}

main().catch(async error => { console.error(error); try { await closePool(); } catch { /* already closed */ } process.exitCode = 1; });
