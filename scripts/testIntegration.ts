import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { closePool, query } from '../src/db/pool';
import { markOutgoingSent, prepareOutgoingMessage, recordMessageStatus, storeIncomingEvent } from '../src/db/repository';

function assertQaDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL es obligatorio para test:integration.');
  const parsed = new URL(url);
  const database = parsed.pathname.replace(/^\//, '').toLowerCase();
  if (!/(qa|test|staging)/.test(database) || process.env.QA_DATABASE_CONFIRM !== 'I_UNDERSTAND_QA_ONLY') {
    throw new Error('La integración sólo corre sobre una base qa/test/staging y requiere QA_DATABASE_CONFIRM=I_UNDERSTAND_QA_ONLY.');
  }
}

async function main() {
  assertQaDatabase();
  const run = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const phone = `549110${run.replace(/\D/g, '').padEnd(7, '7').slice(0, 7)}`;
  const prefix = `qa-int-${run}`;
  try {
    const base = { phone, profileName: `QA ${run}`, body: 'hola', messageType: 'text', payload: { qa: run } };
    const first = await storeIncomingEvent({ ...base, providerMessageId: `${prefix}-duplicate` });
    const duplicate = await storeIncomingEvent({ ...base, providerMessageId: `${prefix}-duplicate` });
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);

    const concurrent = await Promise.all(Array.from({ length: 20 }, () => storeIncomingEvent({ ...base, providerMessageId: `${prefix}-race` })));
    assert.equal(concurrent.filter(result => !result.duplicate).length, 1, 'un webhook concurrente debe persistirse una sola vez');

    await Promise.all(Array.from({ length: 20 }, (_, index) => storeIncomingEvent({ ...base, body: `mensaje ${index}`, providerMessageId: `${prefix}-${index}` })));
    await storeIncomingEvent({
      ...base,
      body: '[Mensaje video recibido]',
      messageType: 'video',
      providerMessageId: `${prefix}-video-message`,
      media: { id: `${prefix}-video-media`, mimeType: 'video/mp4', filename: 'evidencia.mp4' },
    });

    const counts = await query<{ contacts: string; messages: string; events: string; mediaJobs: string }>(`SELECT
      (SELECT count(*) FROM contacts WHERE phone=$1)::text AS contacts,
      (SELECT count(*) FROM messages WHERE provider_message_id LIKE $2)::text AS messages,
      (SELECT count(*) FROM webhook_events WHERE provider_message_id LIKE $2)::text AS events,
      (SELECT count(*) FROM jobs WHERE provider_media_id=$3 AND type='download_media')::text AS "mediaJobs"`,
      [phone, `${prefix}%`, `${prefix}-video-media`]);
    assert.equal(Number(counts.rows[0].contacts), 1);
    assert.equal(Number(counts.rows[0].messages), 23);
    assert.equal(Number(counts.rows[0].events), 23);
    assert.equal(Number(counts.rows[0].mediaJobs), 1, 'video debe generar un trabajo de descarga');

    const contact = await query<{ id: string; unread: number }>('SELECT id, unread_count AS unread FROM contacts WHERE phone=$1', [phone]);
    assert.equal(contact.rows[0].unread, 23);
    const outgoing = await prepareOutgoingMessage(contact.rows[0].id, `${prefix}-outgoing`, 'respuesta QA');
    const providerId = `${prefix}-provider-out`;
    await markOutgoingSent(outgoing.id, providerId);
    await recordMessageStatus(providerId, 'read', null, { qa: true });
    await recordMessageStatus(providerId, 'delivered', null, { qa: true });
    const delivery = await query<{ status: string }>('SELECT delivery_status AS status FROM messages WHERE id=$1', [outgoing.id]);
    assert.equal(delivery.rows[0].status, 'read', 'un estado tardío no debe degradar read a delivered');

    const orphans = await query<{ count: string }>(`SELECT count(*)::text AS count FROM messages m LEFT JOIN contacts c ON c.id=m.contact_id WHERE c.id IS NULL`);
    assert.equal(Number(orphans.rows[0].count), 0);
    console.log('integration tests: OK');
  } finally {
    await query('DELETE FROM contacts WHERE phone=$1', [phone]).catch(() => undefined);
    await query('DELETE FROM webhook_events WHERE provider_message_id LIKE $1', [`${prefix}%`]).catch(() => undefined);
    await closePool();
  }
}

main().catch(async error => { console.error(error); await closePool().catch(() => undefined); process.exit(1); });
