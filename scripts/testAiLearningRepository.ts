import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { closePool, query } from '../src/db/pool';
import {
  claimAiQueryPreviewGeneration,
  claimAiPreviewJob,
  completeJob,
  createAiAnswerLabel,
  enqueueAiQueryPreview,
  ensureAiAnswerLabelDraft,
  findAiAnswerRule,
  listAiAnswerLabels,
  listAiQueryPreviewCandidates,
  listAiQueryLogs,
  markAiQueryAsNoise,
  recordAiQuery,
  reopenAiQuery,
  resolveAiQuery,
  saveAiAnswerRule,
  updateAiAnswerLabel,
  updateAiQueryPreview,
} from '../src/db/repository';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL es obligatorio para esta prueba aislada.');
  const marker = `qa-learning-${randomUUID().slice(0, 8)}`;
  const providerIds: string[] = [];
  const labelIds: string[] = [];
  try {
    const rejectedBlank = await ensureAiAnswerLabelDraft(`${marker}-sin-respuesta`, 'qa');
    assert.equal(rejectedBlank, null, 'Una etiqueta automática nunca puede nacer sin respuesta.');

    const initialDeliveryAnswer = 'Coordinamos cada envío con un comisionista.';
    const draft = await ensureAiAnswerLabelDraft(`${marker}-envios`, 'qa', initialDeliveryAnswer);
    assert.ok(draft?.id);
    assert.equal(draft?.answer, initialDeliveryAnswer);
    labelIds.push(draft!.id);

    const fillableDraft = await ensureAiAnswerLabelDraft(`${marker}-manual`, 'qa', 'Primera respuesta aprobada.');
    assert.ok(fillableDraft?.id);
    labelIds.push(fillableDraft!.id);
    const filledDraft = await createAiAnswerLabel({ name: fillableDraft!.name, answer: 'No debe sobrescribir.', actor: 'qa' });
    assert.equal(filledDraft?.answer, 'Primera respuesta aprobada.', 'Crear una etiqueta debe poder completar un borrador automático.');
    const reusedLabel = await createAiAnswerLabel({ name: fillableDraft!.name, answer: 'Tampoco debe sobrescribir.', actor: 'qa' });
    assert.equal(reusedLabel?.answer, 'Primera respuesta aprobada.', 'Reutilizar una etiqueta no debe pisar su respuesta canónica.');

    const automaticAnswer = 'No entendí la consulta. Contactá al asesor.';
    const unclearDraft = await ensureAiAnswerLabelDraft(`${marker}-pregunta-no-entendible`, 'qa', automaticAnswer);
    assert.equal(unclearDraft?.answer, automaticAnswer, 'La etiqueta segura puede nacer con una respuesta editable.');
    labelIds.push(unclearDraft!.id);
    const unclearReused = await ensureAiAnswerLabelDraft(`${marker}-pregunta-no-entendible`, 'qa', 'No debe sobrescribir.');
    assert.equal(unclearReused?.answer, automaticAnswer, 'Una clasificación posterior no debe pisar el texto configurado.');

    for (const question of [`${marker} traen a domicilio?`, `${marker} realizan entregas en zona sur?`]) {
      const providerMessageId = `${marker}-${providerIds.length}`;
      providerIds.push(providerMessageId);
      await recordAiQuery({ question, providerMessageId, outcome: 'disabled', source: 'production', reviewStatus: 'pending',
        suggestedLabelId: draft!.id, suggestedLabelName: draft!.name, classificationMethod: 'semantic', classificationConfidence: 0.94 });
    }
    const manualId = `${marker}-manual`;
    providerIds.push(manualId);
    await recordAiQuery({ question: `${marker} prueba manual`, providerMessageId: manualId, outcome: 'answered', source: 'manual' });

    const pending = await listAiQueryLogs({ reviewStatus: 'pending', q: marker });
    assert.equal(pending.total, 2);
    assert.ok(pending.items.every(item => item.suggestedLabelId === draft!.id));
    assert.equal((await listAiQueryLogs({ reviewStatus: 'ignored', q: marker })).total, 1);

    const canonical = 'Coordinamos cada envío con un comisionista.\n\n[[MENU]]';
    const resolved = await resolveAiQuery(pending.items[0].id, { labelId: draft!.id, answer: canonical }, 'qa');
    assert.equal(resolved?.reviewStatus, 'resolved');
    assert.equal((await listAiQueryLogs({ reviewStatus: 'pending', q: marker })).total, 0,
      'Resolver una etiqueta debe sacar de pendientes a todo su grupo sugerido.');

    for (const variant of [`${marker} traen a domicilio?`, `${marker} realizan entregas en zona sur?`]) {
      const rule = await findAiAnswerRule(variant);
      assert.equal(rule?.labelId, draft!.id);
      assert.equal(rule?.labelAnswer, canonical);
    }

    const changed = 'Nueva respuesta compartida para envíos.';
    await updateAiAnswerLabel(draft!.id, { name: draft!.name, answer: changed, actor: 'qa' });
    assert.equal((await findAiAnswerRule(`${marker} traen a domicilio?`))?.labelAnswer, changed,
      'Editar una etiqueta debe actualizar todas las variantes.');

    const labels = await listAiAnswerLabels(marker);
    const deliveryLabel = labels.find(label => label.id === draft!.id);
    assert.ok(deliveryLabel);
    assert.ok(deliveryLabel.aliases.some(alias => alias.includes('traen a domicilio')));
    assert.ok(deliveryLabel.aliases.some(alias => alias.includes('realizan entregas')));

    const fallback = await ensureAiAnswerLabelDraft('pregunta-no-entendible', 'ai-system', 'Mensaje sin consulta recuperable.');
    assert.ok(fallback?.id);
    await assert.rejects(
      saveAiAnswerRule({ question: `${marker} regla insegura`, answer: 'No entendí.', labelId: fallback!.id, actor: 'qa' }),
      /ruido no es una respuesta reutilizable/,
      'La categoría interna de ruido nunca puede transformarse en una regla aprobada.',
    );
    await assert.rejects(
      updateAiAnswerLabel(fallback!.id, { name: `${marker}-renombrada`, answer: 'No entendí.', actor: 'qa' }),
      /categoría interna de ruido/,
      'La categoría interna de ruido tampoco puede renombrarse como conocimiento comercial.',
    );
    const fallbackProviderOne = `${marker}-fallback-1`;
    const fallbackProviderTwo = `${marker}-fallback-2`;
    providerIds.push(fallbackProviderOne, fallbackProviderTwo);
    const fallbackOne = await recordAiQuery({ question: `${marker} pregunta distinta uno`, providerMessageId: fallbackProviderOne,
      outcome: 'disabled', source: 'production', reviewStatus: 'pending', suggestedLabelId: fallback!.id,
      suggestedLabelName: fallback!.name, classificationMethod: 'fallback' });
    await recordAiQuery({ question: `${marker} pregunta distinta dos`, providerMessageId: fallbackProviderTwo,
      outcome: 'disabled', source: 'production', reviewStatus: 'pending', suggestedLabelId: fallback!.id,
      suggestedLabelName: fallback!.name, classificationMethod: 'fallback' });
    await resolveAiQuery(fallbackOne.id, { labelId: draft!.id }, 'qa');
    assert.equal((await listAiQueryLogs({ reviewStatus: 'pending', q: `${marker} pregunta distinta dos` })).total, 1,
      'Resolver una consulta histórica del fallback nunca debe agrupar preguntas diferentes.');

    const remaining = (await listAiQueryLogs({ reviewStatus: 'pending', q: `${marker} pregunta distinta dos` })).items[0];
    assert.equal((await markAiQueryAsNoise(remaining.id, 'qa'))?.reviewStatus, 'ignored');
    const reopened = await reopenAiQuery(remaining.id, 'qa');
    assert.equal(reopened?.reviewStatus, 'pending');
    assert.equal(reopened?.suggestedLabelId, null, 'Volver a revisión debe quitar la categoría de ruido.');

    const unlabeledProvider = `${marker}-sin-etiqueta`;
    providerIds.push(unlabeledProvider);
    const unlabeled = await recordAiQuery({ question: `${marker} consulta entendible sin tema`, providerMessageId: unlabeledProvider,
      outcome: 'disabled', source: 'production', reviewStatus: 'pending' });
    assert.equal(unlabeled.suggestedLabelId, null, 'Una consulta entendible pendiente puede no tener etiqueta todavía.');

    const previewText = 'Esta es la respuesta privada que habría usado la IA.';
    const staleClaim = await claimAiQueryPreviewGeneration(unlabeled.id, true);
    const currentClaim = await claimAiQueryPreviewGeneration(unlabeled.id, true);
    assert.equal(staleClaim.status, 'claimed');
    assert.equal(currentClaim.status, 'claimed');
    const staleUpdate = await updateAiQueryPreview(unlabeled.id, { generationId: staleClaim.context!.generationId,
      answer: 'Una respuesta anterior que no debe ganar.', outcome: 'answered', source: 'generated' });
    assert.equal(staleUpdate, null, 'Una generación vieja nunca debe sobrescribir una vista previa más nueva.');
    await updateAiQueryPreview(unlabeled.id, { generationId: currentClaim.context!.generationId,
      answer: previewText, outcome: 'answered', source: 'generated',
      model: 'qa-preview', tokens: 12, elapsedMs: 34, suggestedLabelName: `${marker}-tema`,
      classificationMethod: 'semantic', classificationConfidence: .91 });
    const previewed = (await listAiQueryLogs({ reviewStatus: 'pending', q: marker })).items.find(item => item.id === unlabeled.id);
    assert.equal(previewed?.answer, '', 'La vista previa no debe fingir que el texto fue enviado al cliente.');
    assert.equal(previewed?.previewAnswer, previewText);
    assert.equal(previewed?.previewOutcome, 'answered');
    assert.equal(previewed?.previewSource, 'generated');
    assert.ok(previewed?.previewGeneratedAt);

    const failedClaim = await claimAiQueryPreviewGeneration(unlabeled.id, true);
    assert.equal(failedClaim.status, 'claimed');
    await updateAiQueryPreview(unlabeled.id, { generationId: failedClaim.context!.generationId,
      answer: 'Respuesta temporal de contingencia.', outcome: 'unavailable', source: 'generated',
      classificationMethod: 'none', classificationConfidence: 0, updateSuggestion: false });
    const afterFailure = (await listAiQueryLogs({ reviewStatus: 'pending', q: marker })).items.find(item => item.id === unlabeled.id);
    assert.equal(afterFailure?.suggestedLabelName, `${marker}-tema`,
      'Un fallo temporal no debe borrar una clasificación válida que ya existía.');

    const firstPreviewPage = await listAiQueryPreviewCandidates({ force: true, limit: 2 });
    assert.equal(firstPreviewPage.length, 2);
    const secondPreviewPage = await listAiQueryPreviewCandidates({ force: true, limit: 2,
      after: firstPreviewPage[firstPreviewPage.length - 1] });
    assert.equal(firstPreviewPage.some(first => secondPreviewPage.some(second => second.id === first.id)), false,
      'El cursor del reprocesamiento no debe volver a elegir el lote anterior.');

    await Promise.all([enqueueAiQueryPreview(unlabeled.id), enqueueAiQueryPreview(unlabeled.id)]);
    const activeJobs = await query<{ count: string }>(`SELECT count(*)::text AS count FROM jobs
      WHERE type='ai_preview' AND ai_query_log_id=$1 AND status IN ('queued','retrying','processing')`, [unlabeled.id]);
    assert.equal(Number(activeJobs.rows[0].count), 1, 'Una consulta no debe tener dos vistas previas activas.');
    const previewJob = await claimAiPreviewJob('qa-preview-worker');
    assert.equal(previewJob?.ai_query_log_id, unlabeled.id);
    await completeJob(previewJob!.id);

    console.log('AI learning repository tests: OK');
  } finally {
    await query('DELETE FROM ai_query_logs WHERE provider_message_id = ANY($1::text[])', [providerIds]);
    await query('DELETE FROM ai_answer_rules WHERE label_id = ANY($1::uuid[])', [labelIds]);
    await query('DELETE FROM ai_answer_labels WHERE id = ANY($1::uuid[])', [labelIds]);
    await closePool();
  }
}

main().catch(async error => { console.error(error); try { await closePool(); } catch { /* already closed */ } process.exitCode = 1; });
