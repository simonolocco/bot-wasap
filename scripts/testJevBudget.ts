import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { previewBudgetSubject } from '../src/services/aiPreviewProcessor';

const root = path.resolve(__dirname, '..');
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf8');

const migration = read('db/migrations/031_jev_usage_budget.sql');
assert.match(migration, /CREATE TABLE IF NOT EXISTS jev_usage_buckets/i);
assert.match(migration, /PRIMARY KEY \(bucket_start, scope, subject_key\)/i);
assert.match(migration, /scope IN \('global', 'contact', 'admin', 'system'\)/i);

const repository = read('src/db/repository.ts');
const claimStart = repository.indexOf('export async function claimJevBudget');
const claimEnd = repository.indexOf('\ntype AiRuleDbRow', claimStart);
const claimSource = repository.slice(claimStart, claimEnd);
assert.ok(claimStart >= 0 && claimEnd > claimStart, 'Debe existir el claim persistente de presupuesto Jev.');
assert.match(claimSource, /transaction\(async client/);
assert.match(claimSource, /ON CONFLICT \(bucket_start, scope, subject_key\) DO UPDATE/);
assert.ok(claimSource.indexOf("reserve('global'") < claimSource.indexOf('reserve(subject.type'),
  'El breaker global debe bloquearse antes del bucket del sujeto.');
assert.match(claimSource, /throw new JevBudgetDenied\('subject'\)/,
  'El rechazo del sujeto debe abortar la transacción y revertir el cupo global.');
assert.match(repository, /AI_PREVIEW_MAX_ACTIVE_PER_CONTACT/);

const simulator = read('src/services/jevSimulator.ts');
assert.match(simulator, /beforeRequest\?:/);
assert.ok(simulator.indexOf('await options.beforeRequest?.') < simulator.indexOf("(options.fetchImpl ?? fetch)(JEV_DECISIONS_URL"),
  'La reserva debe ocurrir antes de cada request al proveedor.');

const response = read('src/ai/jevResponse.ts');
assert.match(response, /errorCode: budgetExceeded \? 'jev-budget'/);
assert.match(response, /if \(!budgetExceeded && !input\.failSafe\) throw error/,
  'La cuota agotada debe usar el fallback seguro incluso cuando otros errores se propagan.');

const bot = read('src/services/botProcessor.ts');
assert.match(bot, /budgetSubject: \{ type: 'contact', key: job\.contact_id \}/);

const preview = read('src/services/aiPreviewProcessor.ts');
assert.match(preview, /previewBudgetSubject\(context\.contactId, options\.budgetSubject\)/);
assert.match(preview, /type: 'system', key: 'ai-preview'/);
assert.deepEqual(previewBudgetSubject('contact-1'), { type: 'contact', key: 'contact-1' });
assert.deepEqual(previewBudgetSubject(null), { type: 'system', key: 'ai-preview' });
assert.deepEqual(previewBudgetSubject('contact-1', { type: 'admin', key: 'session-1' }),
  { type: 'admin', key: 'session-1' }, 'La regeneración manual no debe consumir el cupo productivo del contacto.');

const server = read('src/server.ts');
assert.ok((server.match(/budgetSubject: \{ type: 'admin', key: req\.sessionID/g) ?? []).length >= 2,
  'Simulador y prueba manual deben compartir la cuota de la sesión administrativa.');
assert.match(server, /generateAndStoreAiQueryPreview\([\s\S]*budgetSubject: \{ type: 'admin'/,
  'La regeneración sin contacto debe quedar asociada a la sesión administrativa.');

console.log('Jev persistent budget structural tests passed');
