import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { closePool, query } from '../src/db/pool';
import { ensureAiAnswerLabelDraft, listAiAnswerLabels, recordAiQuery } from '../src/db/repository';

async function main() {
  if (!process.env.DATABASE_URL || !/(qa|test|staging)/i.test(new URL(process.env.DATABASE_URL).pathname)) {
    throw new Error('Esta prueba sólo puede usar una base QA/test/staging.');
  }
  const marker = `migration-026-${randomUUID().slice(0, 8)}`;
  const providers = [`${marker}-recovered`, `${marker}-noise`, `${marker}-meaningful`];
  try {
    const fallback = await ensureAiAnswerLabelDraft('pregunta-no-entendible', 'ai-system', 'Fallback histórico');
    assert.ok(fallback);
    const recovered = await recordAiQuery({ question: `${marker} ¿emiten factura A?`, providerMessageId: providers[0],
      outcome: 'disabled', source: 'production', reviewStatus: 'pending', suggestedLabelId: fallback!.id,
      suggestedLabelName: fallback!.name, classificationMethod: 'frequency-fallback', classificationConfidence: 0 });
    const noise = await recordAiQuery({ question: 'asdjkahsd', providerMessageId: providers[1],
      outcome: 'clarify', source: 'production', reviewStatus: 'pending', suggestedLabelId: fallback!.id,
      suggestedLabelName: fallback!.name, classificationMethod: 'fallback', classificationConfidence: 0 });
    const meaningful = await recordAiQuery({ question: `${marker} consulta coherente`, providerMessageId: providers[2],
      outcome: 'disabled', source: 'production', reviewStatus: 'pending', suggestedLabelId: fallback!.id,
      suggestedLabelName: fallback!.name, classificationMethod: 'fallback', classificationConfidence: 0 });

    await query(`INSERT INTO ai_label_candidates (normalized_name, display_name) VALUES ('facturacion','facturacion')
      ON CONFLICT (normalized_name) DO UPDATE SET display_name=EXCLUDED.display_name`);
    await query(`INSERT INTO ai_label_candidate_observations (normalized_name, provider_message_id, question, confidence)
      VALUES ('facturacion',$1,$2,0.91)
      ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL DO UPDATE SET normalized_name=EXCLUDED.normalized_name`,
    [providers[0], recovered.question]);
    const fallbackRule = await query<{ id: string }>(`INSERT INTO ai_answer_rules
      (question, normalized_question, intent_label, label_id, answer, active, manual, created_by)
      VALUES ($1,$2,'pregunta-no-entendible',$3,'fallback viejo',true,false,'ai-auto') RETURNING id`,
    [`${marker} regla`, `${marker}-regla`, fallback!.id]);

    await query(`ALTER TABLE ai_query_logs ADD CONSTRAINT ai_query_logs_pending_label_required
      CHECK (review_status <> 'pending' OR suggested_label_id IS NOT NULL)`);
    const sql = fs.readFileSync(path.resolve('db/migrations/026_ai_response_first.sql'), 'utf8');
    await query(sql);
    const previewSql = fs.readFileSync(path.resolve('db/migrations/027_ai_response_previews.sql'), 'utf8');
    await query(previewSql);

    const rows = await query<{ id: string; suggestedLabelId: string | null; suggestedLabelName: string | null; classificationMethod: string | null; reviewStatus: string }>(`
      SELECT id, suggested_label_id AS "suggestedLabelId", suggested_label_name AS "suggestedLabelName",
        classification_method AS "classificationMethod", review_status AS "reviewStatus"
      FROM ai_query_logs WHERE id=ANY($1::uuid[])`, [[recovered.id, noise.id, meaningful.id]]);
    const byId = new Map(rows.rows.map(row => [row.id, row]));
    assert.equal(byId.get(recovered.id)?.suggestedLabelName, 'facturacion');
    assert.equal(byId.get(recovered.id)?.classificationMethod, 'recovered-topic');
    assert.equal(byId.get(noise.id)?.reviewStatus, 'ignored');
    assert.equal(byId.get(noise.id)?.classificationMethod, 'unintelligible');
    assert.equal(byId.get(meaningful.id)?.suggestedLabelId, null);
    assert.equal(byId.get(meaningful.id)?.classificationMethod, 'needs-review');
    assert.equal((await query<{ active: boolean }>('SELECT active FROM ai_answer_rules WHERE id=$1', [fallbackRule.rows[0].id])).rows[0].active, false);
    assert.equal(Number((await query<{ count: string }>(`SELECT count(*)::text AS count FROM pg_constraint WHERE conname='ai_query_logs_pending_label_required'`)).rows[0].count), 0);
    assert.equal(Number((await query<{ count: string }>(`SELECT count(*)::text AS count FROM information_schema.columns
      WHERE table_name='ai_query_logs' AND column_name IN ('preview_answer','preview_outcome','preview_source','preview_generated_at','preview_generation_id')`)).rows[0].count), 5);
    assert.equal(Number((await query<{ count: string }>(`SELECT count(*)::text AS count FROM information_schema.columns
      WHERE table_name='jobs' AND column_name='ai_query_log_id'`)).rows[0].count), 1);
    assert.equal((await listAiAnswerLabels()).some(label => label.normalizedName === 'pregunta-no-entendible'), false,
      'La categoría interna no debe aparecer en el catálogo reutilizable.');
    console.log('AI response-first migration tests: OK');
  } finally {
    await query('DELETE FROM ai_query_logs WHERE provider_message_id=ANY($1::text[])', [providers]);
    await query('DELETE FROM ai_answer_rules WHERE normalized_question LIKE $1', [`${marker}%`]);
    await query(`DELETE FROM ai_label_candidate_observations WHERE provider_message_id=$1`, [providers[0]]);
    await query(`DELETE FROM ai_label_candidates WHERE normalized_name='facturacion'
      AND NOT EXISTS (SELECT 1 FROM ai_label_candidate_observations WHERE normalized_name='facturacion')`);
    await closePool();
  }
}

main().catch(async error => { console.error(error); try { await closePool(); } catch { /* closed */ } process.exitCode = 1; });
