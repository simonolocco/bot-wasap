import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { closePool, query } from '../src/db/pool';
import { ensureAiAnswerLabelDraft, recordAiQuery } from '../src/db/repository';
import { login, openNavigationOnMobile } from './helpers';

const marker = `qa-ai-${randomUUID().slice(0, 8)}`;
const questions = {
  delivery: `Traen a domicilio? estoy en zona sur · ${marker}`,
  address: `En donde estan? · ${marker}`,
  catalog: `Quiero un catalogo con sus productos y precios · ${marker}`,
};
const labelName = `envios-${marker}`;
const canonicalAnswer = `Respuesta compartida ${marker}: coordinamos el traslado por zona.`;
let labelId = '';
const providerIds = [`${marker}-delivery`, `${marker}-address`, `${marker}-catalog`];

test.beforeAll(async () => {
  const database = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid').pathname.toLowerCase();
  if (!/(qa|test|staging)/.test(database)) throw new Error('Esta prueba sólo puede usar una base QA/test/staging.');
  const label = await ensureAiAnswerLabelDraft(labelName, 'qa-browser', canonicalAnswer);
  if (!label) throw new Error('No se pudo crear la etiqueta QA.');
  labelId = label.id;
  await recordAiQuery({ question: questions.delivery, providerMessageId: providerIds[0], outcome: 'disabled', source: 'production',
    reviewStatus: 'pending', suggestedLabelId: labelId, suggestedLabelName: labelName, classificationMethod: 'semantic', classificationConfidence: 0.95 });
  await recordAiQuery({ question: questions.address, providerMessageId: providerIds[1], answer: 'dirección', outcome: 'answered', source: 'production', reviewStatus: 'resolved' });
  await recordAiQuery({ question: questions.catalog, providerMessageId: providerIds[2], answer: 'catálogo', outcome: 'answered', source: 'production', reviewStatus: 'resolved' });
});

test.afterAll(async () => {
  await query('DELETE FROM ai_query_logs WHERE provider_message_id = ANY($1::text[]) OR question LIKE $2', [providerIds, `%${marker}%`]);
  await query('DELETE FROM ai_answer_rules WHERE label_id=$1', [labelId]);
  await query('DELETE FROM ai_answer_labels WHERE id=$1', [labelId]);
  await closePool();
});

test('aprende una etiqueta canónica sin mostrar preguntas ya respondidas', async ({ page }) => {
  await login(page);
  await openNavigationOnMobile(page);
  await page.getByRole('button', { name: 'IA', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Preguntas de clientes' })).toBeVisible();
  await page.getByPlaceholder('Buscar pregunta o contacto').fill(marker);

  const deliveryCard = page.getByRole('article').filter({
    has: page.getByRole('heading', { name: questions.delivery, exact: true }),
  });
  await expect(deliveryCard).toBeVisible();
  await expect(page.getByText(questions.address, { exact: true })).toHaveCount(0);
  await expect(page.getByText(questions.catalog, { exact: true })).toHaveCount(0);
  await expect(deliveryCard.getByLabel('Etiqueta')).toHaveValue(labelId);

  await expect(deliveryCard.getByLabel('Respuesta')).toHaveValue(canonicalAnswer);
  await deliveryCard.getByRole('button', { name: 'Guardar respuesta' }).click();
  await expect(page.getByText('Respuesta aprobada. La pregunta quedó asociada a la etiqueta elegida.')).toBeVisible();
  await expect(page.getByText('No hay consultas esperando revisión.')).toBeVisible();
  await page.getByRole('button', { name: 'Etiquetas', exact: true }).click();
  await expect(page.getByLabel('Respuesta compartida').last()).toHaveValue(canonicalAnswer);

  await page.getByRole('button', { name: 'Preguntas y respuestas', exact: true }).click();
  for (const variant of ['hacen envios?', 'envios hacen?', 'llevan pedidos hasta mi casa?']) {
    await page.getByPlaceholder('Ej.: ¿Hacen envíos a Villa María?').fill(variant);
    await page.getByRole('button', { name: 'Probar respuesta' }).click();
    await expect(page.getByText(canonicalAnswer, { exact: true })).toBeVisible();
  }

  const persisted = await query<{ labels: string; pending: string; aliases: string }>(`SELECT
    (SELECT count(*) FROM ai_answer_labels WHERE id=$1)::text AS labels,
    (SELECT count(*) FROM ai_query_logs WHERE question LIKE $2 AND review_status='pending')::text AS pending,
    (SELECT count(*) FROM ai_answer_rule_aliases a JOIN ai_answer_rules r ON r.id=a.answer_rule_id WHERE r.label_id=$1)::text AS aliases`,
  [labelId, `%${marker}%`]);
  expect(Number(persisted.rows[0].labels)).toBe(1);
  expect(Number(persisted.rows[0].pending)).toBe(0);
  expect(Number(persisted.rows[0].aliases)).toBeGreaterThanOrEqual(1);
});
