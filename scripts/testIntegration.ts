import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { closePool, query } from '../src/db/pool';
import { attachMediaAssetToMessage, listMessages, markOutgoingSent, prepareManualMessage, prepareOutgoingMessage, recordMessageStatus, storeIncomingEvent } from '../src/db/repository';
import { ensureMediaThumbnail, getMediaStoragePath, storeMedia } from '../src/services/mediaStorage';

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
  let storedImage: Awaited<ReturnType<typeof storeMedia>> | null = null;
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
    const manualReply = await prepareManualMessage(contact.rows[0].id, `${prefix}-manual-reply`, 'respuesta citada', 'text', undefined, outgoing.id);
    const storedManualQuote = await query<{ provider: string | null }>('SELECT quoted_provider_message_id AS provider FROM messages WHERE id=$1', [manualReply.id]);
    assert.equal(storedManualQuote.rows[0].provider, providerId, 'una respuesta manual debe conservar el id externo citado');
    await storeIncomingEvent({
      ...base,
      body: 'respuesta del cliente a un mensaje anterior',
      providerMessageId: `${prefix}-incoming-reply`,
      quotedProviderMessageId: providerId,
    });
    const history = await listMessages(contact.rows[0].id, undefined, 100);
    const incomingReply = history.items.find(message => message.providerMessageId === `${prefix}-incoming-reply`);
    assert.equal(incomingReply?.quoteMessageId, outgoing.id);
    assert.equal(incomingReply?.quotedMessage?.body, 'respuesta QA');
    assert.equal(incomingReply?.quotedMessage?.providerMessageId, providerId);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAYAAABr5z2BAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGklEQVQokWPgb8n5TwlmGDXg/2gY5AyHMAAA1xd+kP6IR7AAAAAASUVORK5CYII=', 'base64');
    storedImage = await storeMedia(png, 'image/png', `${prefix}.png`);
    await attachMediaAssetToMessage(outgoing.id, storedImage.id, 'ready');
    const thumbnailPath = await ensureMediaThumbnail(storedImage.storageKey, 240);
    const thumbnail = await sharp(thumbnailPath).metadata();
    assert.equal(thumbnail.format, 'webp');
    assert.equal(thumbnail.width, 16);
    assert.equal(thumbnail.height, 12);
    const historyWithImage = await listMessages(contact.rows[0].id, undefined, 100);
    const imageMessage = historyWithImage.items.find(message => message.id === outgoing.id);
    assert.equal(imageMessage?.mediaWidth, 16);
    assert.equal(imageMessage?.mediaHeight, 12);
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
    if (storedImage) {
      await query('DELETE FROM media_assets WHERE id=$1', [storedImage.id]).catch(() => undefined);
      await fs.rm(getMediaStoragePath(storedImage.storageKey), { force: true }).catch(() => undefined);
      await fs.rm(getMediaStoragePath(`.thumbnails/${storedImage.storageKey}.240.webp`), { force: true }).catch(() => undefined);
    }
    await closePool();
  }
}

main().catch(async error => { console.error(error); await closePool().catch(() => undefined); process.exit(1); });
