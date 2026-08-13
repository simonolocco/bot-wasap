import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';

const contacts = Math.max(1, Number.parseInt(process.env.SCALE_CONTACTS ?? '183000', 10) || 183_000);
const messagesPerContact = Math.max(1, Number.parseInt(process.env.SCALE_MESSAGES_PER_CONTACT ?? '20', 10) || 20);
const expectedMessages = contacts * messagesPerContact;

function requireQaDatabase() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL es obligatorio para test:scale.');
  const database = new URL(raw).pathname.replace(/^\//, '').toLowerCase();
  if (!/(qa|test|staging)/.test(database) || process.env.SCALE_TEST_RESET_DATABASE !== 'I_UNDERSTAND_QA_ONLY') {
    throw new Error('test:scale borra datos y sólo corre en qa/test/staging con SCALE_TEST_RESET_DATABASE=I_UNDERSTAND_QA_ONLY.');
  }
  return raw;
}

function percentile95(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))];
}

async function main() {
  const pool = new Pool({ connectionString: requireQaDatabase(), max: 4 });
  const started = Date.now();
  try {
    await pool.query(`TRUNCATE TABLE admin_audit_log, campaign_recipients, campaigns, support_tickets, orders, jobs,
      webhook_events, message_status_events, messages, media_assets, bot_sessions, app_sessions, worker_heartbeats,
      templates, contacts, backup_runs RESTART IDENTITY CASCADE`);
    await pool.query(`INSERT INTO contacts (phone,country_code,name,public_name,unread_count,last_incoming_at,last_outgoing_at,last_message_at,first_seen_at,updated_at)
      SELECT '54911' || lpad(g::text,8,'0'), '54', 'Cliente QA ' || g, 'Cliente ' || g, 10,
        now() - ((g % 365) || ' days')::interval, now() - ((g % 365) || ' days')::interval,
        now() - ((g % 365) || ' days')::interval, now() - ((g % 365) || ' days')::interval, now()
      FROM generate_series(1,$1) g`, [contacts]);
    await pool.query(`INSERT INTO bot_sessions (contact_id,display_name)
      SELECT id,name FROM contacts`);
    await pool.query(`INSERT INTO messages (contact_id,direction,body,message_type,provider_message_id,delivery_status,created_at,sent_at)
      SELECT c.id, CASE WHEN m % 2 = 0 THEN 'outgoing' ELSE 'incoming' END,
        'Mensaje histórico QA ' || m || ' de ' || c.phone, 'text',
        'qa-scale-' || c.phone || '-' || m,
        CASE WHEN m % 2 = 0 THEN 'sent' ELSE NULL END,
        c.first_seen_at + (m || ' minutes')::interval,
        CASE WHEN m % 2 = 0 THEN c.first_seen_at + (m || ' minutes')::interval ELSE NULL END
      FROM contacts c CROSS JOIN generate_series(1,$1) m`, [messagesPerContact]);
    await pool.query('ANALYZE contacts');
    await pool.query('ANALYZE messages');

    const measured: Record<string, number[]> = { inbox: [], search: [], history: [], deepPage: [] };
    const sample = await pool.query<{ id: string; phone: string }>('SELECT id,phone FROM contacts ORDER BY id OFFSET $1 LIMIT 1', [Math.floor(contacts / 2)]);
    for (let iteration = 0; iteration < 20; iteration++) {
      let at = performance.now();
      await pool.query(`SELECT c.id,m.body FROM contacts c LEFT JOIN LATERAL
        (SELECT body FROM messages WHERE contact_id=c.id ORDER BY created_at DESC LIMIT 1) m ON true
        WHERE c.last_message_at IS NOT NULL ORDER BY c.last_message_at DESC,c.id DESC LIMIT 31`);
      measured.inbox.push(performance.now() - at);
      at = performance.now();
      await pool.query(`SELECT id FROM contacts WHERE name ILIKE $1 OR public_name ILIKE $1 OR phone ILIKE $1 LIMIT 31`, [`%${sample.rows[0].phone.slice(-6)}%`]);
      measured.search.push(performance.now() - at);
      at = performance.now();
      await pool.query(`SELECT id,body FROM messages WHERE contact_id=$1 ORDER BY created_at DESC LIMIT 51`, [sample.rows[0].id]);
      measured.history.push(performance.now() - at);
      at = performance.now();
      await pool.query(`SELECT id FROM contacts ORDER BY last_message_at DESC NULLS LAST,id DESC LIMIT 50 OFFSET $1`, [Math.max(0, contacts - 100)]);
      measured.deepPage.push(performance.now() - at);
    }

    const counts = await pool.query<{ contacts: string; messages: string }>('SELECT (SELECT count(*) FROM contacts)::text AS contacts, (SELECT count(*) FROM messages)::text AS messages');
    assert.equal(Number(counts.rows[0].contacts), contacts);
    assert.equal(Number(counts.rows[0].messages), expectedMessages);
    const p95 = Object.fromEntries(Object.entries(measured).map(([name, values]) => [name, Math.round(percentile95(values))]));
    for (const [name, latency] of Object.entries(p95)) assert.ok(latency < 2000, `${name} p95=${latency}ms supera 2s`);
    const report = { contacts, messages: expectedMessages, p95Ms: p95, seedAndTestMs: Date.now() - started, generatedAt: new Date().toISOString() };
    const output = path.resolve('qa-artifacts', 'scale-results.json');
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(error => { console.error(error); process.exit(1); });
