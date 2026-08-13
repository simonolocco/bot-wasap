/**
 * QA-only signed webhook load and integrity test.
 * Defaults: 1,000 contacts, 5 messages each, bursts of 50 contacts and 10% redelivery.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Pool } from 'pg';

const configuredUrl = process.env.LOAD_WEBHOOK_URL;
const secret = process.env.META_APP_SECRET;
if (!configuredUrl || !secret) throw new Error('Definí LOAD_WEBHOOK_URL y META_APP_SECRET.');
const url = new URL(configuredUrl);
const safeHost = ['localhost', '127.0.0.1'].includes(url.hostname) || /(qa|staging)/i.test(url.hostname);
if (!safeHost && process.env.LOAD_STAGING_CONFIRM !== 'I_UNDERSTAND_STAGING_ONLY') {
  throw new Error('La carga está bloqueada fuera de localhost/qa/staging. No la ejecutes en producción.');
}

const contactCount = Math.max(1, Number.parseInt(process.env.LOAD_CONTACTS ?? '1000', 10) || 1000);
const messagesPerContact = Math.max(1, Number.parseInt(process.env.LOAD_MESSAGES_PER_CONTACT ?? '5', 10) || 5);
const burst = Math.max(1, Number.parseInt(process.env.LOAD_BURST ?? '50', 10) || 50);
const duplicatePercent = Math.min(100, Math.max(0, Number.parseInt(process.env.LOAD_DUPLICATE_PERCENT ?? '10', 10) || 10));
const drainTimeoutMs = Math.max(10_000, Number.parseInt(process.env.LOAD_DRAIN_TIMEOUT_MS ?? '120000', 10) || 120_000);
const httpRetries = Math.max(0, Number.parseInt(process.env.LOAD_HTTP_RETRIES ?? '0', 10) || 0);
const p95LimitMs = Math.max(1, Number.parseInt(process.env.LOAD_P95_MAX_MS ?? '1000', 10) || 1000);
const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const idPrefix = `qa-load-${runId}`;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
const bodies = ['hola', '1', 'nuevo pedido', '2 cajas de queso cremoso', 'menu'];
let transientHttpFailures = 0;

function payloadFor(contact: number, message: number, sourceTimestamp = Math.floor(Date.now() / 1000)) {
  const providerId = `${idPrefix}-${contact}-${message}`;
  const phone = `54911${String(contact).padStart(8, '0')}`;
  return {
    providerId,
    body: JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: {
        contacts: [{ profile: { name: `QA Load ${runId} ${contact}` } }],
        messages: [{
          id: providerId,
          from: phone,
          timestamp: String(sourceTimestamp),
          type: 'text',
          text: { body: bodies[message % bodies.length] ?? `mensaje ${message}` },
        }],
      } }] }],
    }),
  };
}

async function send(body: string) {
  const signature = `sha256=${crypto.createHmac('sha256', secret!).update(body).digest('hex')}`;
  const started = performance.now();
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, body });
      if (response.ok) return performance.now() - started;
      if (attempt >= httpRetries) throw new Error(`Webhook respondió HTTP ${response.status}`);
    } catch (error) {
      if (attempt >= httpRetries) throw error;
    }
    transientHttpFailures += 1;
    await new Promise(resolve => setTimeout(resolve, Math.min(1000, 100 * (attempt + 1))));
  }
}

async function sendContact(contact: number) {
  const latencies: number[] = [];
  for (let message = 0; message < messagesPerContact; message++) {
    const payload = payloadFor(contact, message);
    latencies.push(await send(payload.body));
    if (message === 0 && contact < Math.ceil(contactCount * duplicatePercent / 100)) {
      latencies.push(await send(payload.body));
    }
  }
  return latencies;
}

async function assertIntegrity(expectedEvents: number) {
  if (!pool) throw new Error('DATABASE_URL es obligatorio para verificar pérdida, duplicados y cola.');
  const started = Date.now();
  let activeJobs = Number.POSITIVE_INFINITY;
  while (Date.now() - started < drainTimeoutMs) {
    const state = await pool.query<{ active: string }>(`SELECT count(*)::text AS active FROM jobs j
      LEFT JOIN webhook_events e ON e.id=j.webhook_event_id
      WHERE e.provider_message_id LIKE $1 AND j.status IN ('queued','processing','retrying')`, [`${idPrefix}%`]);
    activeJobs = Number(state.rows[0].active);
    if (activeJobs === 0) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(activeJobs, 0, `la cola no drenó en ${drainTimeoutMs}ms`);
  const result = await pool.query<{ events: string; messages: string; contacts: string; failedJobs: string; duplicateEvents: string; orphanMessages: string }>(`SELECT
    (SELECT count(*) FROM webhook_events WHERE provider_message_id LIKE $1)::text AS events,
    (SELECT count(*) FROM messages WHERE provider_message_id LIKE $1)::text AS messages,
    (SELECT count(DISTINCT contact_id) FROM messages WHERE provider_message_id LIKE $1)::text AS contacts,
    (SELECT count(*) FROM jobs j JOIN webhook_events e ON e.id=j.webhook_event_id WHERE e.provider_message_id LIKE $1 AND j.status='failed')::text AS "failedJobs",
    (SELECT count(*) FROM (SELECT provider_message_id FROM webhook_events WHERE provider_message_id LIKE $1 GROUP BY provider_message_id HAVING count(*) > 1) d)::text AS "duplicateEvents",
    (SELECT count(*) FROM messages m LEFT JOIN contacts c ON c.id=m.contact_id WHERE m.provider_message_id LIKE $1 AND c.id IS NULL)::text AS "orphanMessages"`, [`${idPrefix}%`]);
  const row = result.rows[0];
  assert.equal(Number(row.events), expectedEvents, 'eventos persistidos');
  assert.equal(Number(row.messages), expectedEvents, 'mensajes persistidos');
  assert.equal(Number(row.contacts), contactCount, 'contactos únicos');
  assert.equal(Number(row.failedJobs), 0, 'trabajos fallidos');
  assert.equal(Number(row.duplicateEvents), 0, 'eventos duplicados');
  assert.equal(Number(row.orphanMessages), 0, 'mensajes huérfanos');
  return Date.now() - started;
}

async function main() {
  const started = performance.now();
  const latencies: number[] = [];
  for (let start = 0; start < contactCount; start += burst) {
    const batch = await Promise.all(Array.from({ length: Math.min(burst, contactCount - start) }, (_, offset) => sendContact(start + offset)));
    latencies.push(...batch.flat());
  }
  const sorted = latencies.sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))];
  assert.ok(p95 < p95LimitMs, `p95 del webhook supera ${p95LimitMs}ms: ${Math.round(p95)}ms`);
  const drainMs = await assertIntegrity(contactCount * messagesPerContact);
  console.log(JSON.stringify({ runId, contacts: contactCount, messages: contactCount * messagesPerContact, duplicatePercent, burst, p95WebhookMs: Math.round(p95), transientHttpFailures, drainMs, totalMs: Math.round(performance.now() - started) }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool?.end());
