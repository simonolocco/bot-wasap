import type { PoolClient } from 'pg';
import { query, transaction } from './pool';

export type ConsentStatus = 'unknown' | 'opted_in' | 'opted_out';
export type Contact = {
  id: string; phone: string; countryCode: string; name: string; publicName: string;
  consentStatus: ConsentStatus; consentSource: string | null; consentAt: string | null; optOutAt: string | null;
  notes: string; labels: string[]; pipelineStatus: string; assignedTo: string | null; followUpAt: string | null;
  unreadCount: number; lastIncomingAt: string | null; lastOutgoingAt: string | null; lastReadAt: string | null;
  botPaused: boolean; botPausedAt: string | null; botPausedBy: string | null;
  firstSeenAt: string; lastMessageAt: string | null; updatedAt: string;
};
export type Message = {
  id: string; direction: 'incoming' | 'outgoing'; body: string; messageType: string; createdAt: string;
  providerMessageId: string | null; deliveryStatus?: 'pending' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | null; mediaId?: string | null;
  mediaAssetId?: string | null; mediaStatus?: 'pending' | 'ready' | 'failed' | null; quoteMessageId?: string | null; quotedProviderMessageId?: string | null;
  mediaMimeType?: string | null; mediaFilename?: string | null; mediaSize?: number | null; mediaCaption?: string | null; mediaWidth?: number | null; mediaHeight?: number | null; error?: string | null;
  quotedMessage?: {
    id: string | null; providerMessageId: string | null; direction: 'incoming' | 'outgoing' | null;
    body: string | null; messageType: string | null; mediaMimeType: string | null; mediaFilename: string | null;
    mediaCaption: string | null; mediaStatus: 'pending' | 'ready' | 'failed' | null; mediaWidth: number | null; mediaHeight: number | null;
  } | null;
};
export type MediaAsset = {
  id: string; providerMediaId: string | null; storageKey: string; mimeType: string; filename: string;
  sizeBytes: number | null; sha256: string | null; status: 'pending' | 'ready' | 'failed'; error: string | null;
  width: number | null; height: number | null; durationMs: number | null;
};
export type SupportTicket = {
  id: string; contactId: string; status: 'open' | 'closed'; subject: string; question: string;
  ticketType: 'question' | 'order'; orderId: number | null;
  questionMessageId: string | null; answeredBy: string | null; answeredAt: string | null;
  createdBy: string; createdAt: string; updatedAt: string; closedAt: string | null;
  closureReason: 'answered' | 'no_customer_question' | 'no_operator_response' | 'fallback_sent' | 'order_completed' | 'question_answered' | 'customer_no_reply' | 'operator_cancelled' | null;
  closedBy: string | null;
  fallbackClaimedAt: string | null; fallbackSentAt: string | null; fallbackError: string | null;
};

const contactColumns = `id, phone, country_code AS "countryCode", name, public_name AS "publicName",
  consent_status AS "consentStatus", consent_source AS "consentSource", consent_at AS "consentAt", opt_out_at AS "optOutAt",
  notes, labels, pipeline_status AS "pipelineStatus", assigned_to AS "assignedTo", follow_up_at AS "followUpAt",
  unread_count AS "unreadCount", last_incoming_at AS "lastIncomingAt", last_outgoing_at AS "lastOutgoingAt", last_read_at AS "lastReadAt",
  bot_paused AS "botPaused", bot_paused_at AS "botPausedAt", bot_paused_by AS "botPausedBy",
  first_seen_at AS "firstSeenAt", last_message_at AS "lastMessageAt", updated_at AS "updatedAt"`;
const ticketColumns = `id, contact_id AS "contactId", status, subject, question,
  ticket_type AS "ticketType", order_id AS "orderId",
  question_message_id AS "questionMessageId", answered_by AS "answeredBy", answered_at AS "answeredAt",
  created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", closed_at AS "closedAt",
  closure_reason AS "closureReason", closed_by AS "closedBy", fallback_claimed_at AS "fallbackClaimedAt",
  fallback_sent_at AS "fallbackSentAt", fallback_error AS "fallbackError"`;
const ticketColumnsQualified = `st.id, st.contact_id AS "contactId", st.status, st.subject, st.question,
  st.ticket_type AS "ticketType", st.order_id AS "orderId",
  st.question_message_id AS "questionMessageId", st.answered_by AS "answeredBy", st.answered_at AS "answeredAt",
  st.created_by AS "createdBy", st.created_at AS "createdAt", st.updated_at AS "updatedAt", st.closed_at AS "closedAt",
  st.closure_reason AS "closureReason", st.closed_by AS "closedBy", st.fallback_claimed_at AS "fallbackClaimedAt",
  st.fallback_sent_at AS "fallbackSentAt", st.fallback_error AS "fallbackError"`;

function normalizePhone(value: string) { return value.replace(/\D/g, ''); }

export async function upsertContact(client: PoolClient, phoneInput: string, profileName?: string, options: { markIncoming?: boolean } = {}) {
  const phone = normalizePhone(phoneInput);
  const markIncoming = options.markIncoming ?? true;
  const result = await client.query<Contact>(`
    INSERT INTO contacts (phone, country_code, name, last_message_at, last_incoming_at, unread_count)
    VALUES ($1, CASE WHEN $1 LIKE '54%' THEN '54' ELSE '' END, COALESCE(NULLIF($2, ''), ''), CASE WHEN $3 THEN now() ELSE NULL END, CASE WHEN $3 THEN now() ELSE NULL END, CASE WHEN $3 THEN 1 ELSE 0 END)
    ON CONFLICT (phone) DO UPDATE SET
      name = CASE WHEN contacts.name = '' AND EXCLUDED.name <> '' THEN EXCLUDED.name ELSE contacts.name END,
      last_message_at = CASE WHEN $3 THEN now() ELSE contacts.last_message_at END,
      last_incoming_at = CASE WHEN $3 THEN now() ELSE contacts.last_incoming_at END,
      unread_count = CASE WHEN $3 THEN contacts.unread_count + 1 ELSE contacts.unread_count END,
      updated_at = now()
    RETURNING ${contactColumns}`,
    [phone, profileName?.trim() ?? '', markIncoming]);
  return result.rows[0];
}
export async function createContact(phoneInput: string, name = '') {
  const phone = normalizePhone(phoneInput);
  const result = await query<Contact>(`
    INSERT INTO contacts (phone, country_code, name)
    VALUES ($1, CASE WHEN $1 LIKE '54%' THEN '54' ELSE '' END, $2)
    ON CONFLICT (phone) DO UPDATE SET
      name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE contacts.name END,
      updated_at = now()
    RETURNING ${contactColumns}`,
    [phone, name.trim()]);
  return result.rows[0];
}


export async function storeIncomingEvent(input: {
  providerMessageId: string; phone: string; profileName?: string; body: string; messageType: string; payload: unknown;
  sourceTimestamp?: number; quotedProviderMessageId?: string;
  media?: { id?: string; mimeType?: string; filename?: string; size?: number; caption?: string };
}) {
  return transaction(async client => {
    const event = await client.query<{ id: string }>(`
      INSERT INTO webhook_events (provider_message_id, source_timestamp, payload) VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (provider_message_id) DO NOTHING RETURNING id`, [input.providerMessageId, input.sourceTimestamp ? new Date(input.sourceTimestamp).toISOString() : null, JSON.stringify(input.payload)]);
    if (!event.rows[0]) return { duplicate: true as const };
    const contact = await upsertContact(client, input.phone, input.profileName);
    await client.query(`INSERT INTO bot_sessions (contact_id, display_name) VALUES ($1, $2)
      ON CONFLICT (contact_id) DO UPDATE SET display_name = CASE WHEN bot_sessions.display_name = '' THEN EXCLUDED.display_name ELSE bot_sessions.display_name END, updated_at = now()`,
      [contact.id, input.profileName?.trim() ?? '']);
    const quoted = input.quotedProviderMessageId
      ? await client.query<{ id: string }>('SELECT id FROM messages WHERE contact_id=$1 AND provider_message_id=$2 LIMIT 1', [contact.id, input.quotedProviderMessageId])
      : null;
    const insertedMessage = await client.query<{ id: string }>(`INSERT INTO messages (contact_id, direction, body, message_type, provider_message_id, media_id, media_mime_type, media_filename, media_size, media_caption, media_status, quote_message_id, quoted_provider_message_id)
      VALUES ($1, 'incoming', $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $5::text IS NULL THEN NULL ELSE 'pending' END, $10, $11) RETURNING id`, [contact.id, input.body, input.messageType, input.providerMessageId,
      input.media?.id ?? null, input.media?.mimeType ?? null, input.media?.filename ?? null, input.media?.size ?? null, input.media?.caption ?? null, quoted?.rows[0]?.id ?? null, input.quotedProviderMessageId ?? null]);
    await client.query(`INSERT INTO jobs (type, contact_id, webhook_event_id) VALUES ('process_incoming', $1, $2)`, [contact.id, event.rows[0].id]);
    if (input.media?.id && ['image', 'document', 'audio', 'video'].includes(input.messageType)) {
      await client.query(`INSERT INTO jobs (type, contact_id, message_id, provider_media_id, media_filename, media_mime_type)
        VALUES ('download_media', $1, $2, $3, $4, $5)`, [contact.id, insertedMessage.rows[0].id, input.media.id, input.media.filename ?? 'archivo', input.media.mimeType ?? 'application/octet-stream']);
    }
    return { duplicate: false as const, contactId: contact.id, eventId: event.rows[0].id };
  });
}

export async function claimJob(workerId: string) {
  return transaction(async client => {
    const job = await client.query<{ id: string; type: 'process_incoming' | 'download_media'; contact_id: string; webhook_event_id: string | null; message_id: string | null; provider_media_id: string | null; media_filename: string | null; media_mime_type: string | null; attempts: number }>(`
      WITH candidate AS (
        SELECT j.id FROM jobs j
        WHERE j.status IN ('queued', 'retrying') AND j.run_after <= now()
          AND NOT EXISTS (SELECT 1 FROM jobs older WHERE older.contact_id = j.contact_id AND older.status IN ('queued', 'retrying', 'processing')
            AND (older.created_at < j.created_at OR (older.created_at = j.created_at AND older.id < j.id)))
        ORDER BY j.created_at FOR UPDATE SKIP LOCKED LIMIT 1
      )
      UPDATE jobs SET status = 'processing', attempts = attempts + 1, locked_at = now(), locked_by = $1
      WHERE id IN (SELECT id FROM candidate)
      RETURNING id, type, contact_id, webhook_event_id, message_id, provider_media_id, media_filename, media_mime_type, attempts`, [workerId]);
    return job.rows[0] ?? null;
  });
}

export async function recoverStaleJobs(maxHeartbeatAgeSeconds = 30, maxProcessingSeconds = 60) {
  const result = await query(`UPDATE jobs j SET status='retrying', run_after=now(), locked_at=NULL, locked_by=NULL,
    last_error=COALESCE(j.last_error, 'Worker interrumpido antes de finalizar')
    WHERE j.status='processing' AND (
      j.locked_at IS NULL OR
      j.locked_at < now() - ($2::int * interval '1 second') OR
      NOT EXISTS (
        SELECT 1 FROM worker_heartbeats wh
        WHERE wh.worker_id=j.locked_by
          AND wh.last_seen_at >= now() - ($1::int * interval '1 second')
      )
    )`, [maxHeartbeatAgeSeconds, maxProcessingSeconds]);
  return result.rowCount ?? 0;
}

export async function getJobEvent(jobId: string) {
  const result = await query<{ payload: unknown; contact_id: string; provider_message_id: string; received_at: string; source_timestamp: string | null }>(`
    SELECT e.payload, j.contact_id, e.provider_message_id, e.received_at, e.source_timestamp FROM jobs j JOIN webhook_events e ON e.id = j.webhook_event_id WHERE j.id = $1`, [jobId]);
  return result.rows[0] ?? null;
}

/**
 * Distinct WhatsApp message IDs are valid events, but users can accidentally
 * send the same text more than once in a few seconds. Keep both messages in
 * the conversation while preventing the bot from repeating the same reply.
 */
export async function hasRecentDuplicateIncoming(contactId: string, providerMessageId: string, body: string, windowSeconds: number) {
  const normalizedBody = body.trim().toLocaleLowerCase();
  if (!normalizedBody || windowSeconds <= 0) return false;
  const result = await query<{ id: string }>(`
    SELECT id FROM messages
    WHERE contact_id = $1
      AND direction = 'incoming'
      AND provider_message_id <> $2
      AND lower(btrim(COALESCE(body, ''))) = $3
      AND created_at >= now() - ($4::int * interval '1 second')
    ORDER BY created_at DESC
    LIMIT 1`, [contactId, providerMessageId, normalizedBody, windowSeconds]);
  return Boolean(result.rows[0]);
}

export async function completeJob(jobId: string) {
  await transaction(async client => {
    await client.query(`UPDATE jobs SET status = 'completed', completed_at = now(), locked_at = NULL, locked_by = NULL WHERE id = $1`, [jobId]);
    await client.query(`UPDATE webhook_events SET status = 'processed', processed_at = now() WHERE id = (SELECT webhook_event_id FROM jobs WHERE id = $1)`, [jobId]);
  });
}

export async function retryJob(jobId: string, attempts: number, error: unknown) {
  const delaySeconds = Math.min(3600, 2 ** Math.min(attempts, 10));
  const message = error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
  await query(`UPDATE jobs SET status = CASE WHEN attempts >= 8 THEN 'failed' ELSE 'retrying' END,
    run_after = now() + ($2 || ' seconds')::interval, last_error = $3, locked_at = NULL, locked_by = NULL WHERE id = $1`, [jobId, delaySeconds, message]);
}

export async function getSession(contactId: string) {
  const result = await query<{ greeted: boolean; awaiting_order_detail: boolean; display_name: string }>('SELECT greeted, awaiting_order_detail, display_name FROM bot_sessions WHERE contact_id = $1', [contactId]);
  return result.rows[0] ?? { greeted: false, awaiting_order_detail: false, display_name: '' };
}

/** Atomically claims the first greeting so concurrent jobs cannot both send it. */
export async function claimInitialGreeting(contactId: string, displayName: string) {
  const result = await query<{ greeted: boolean }>(`UPDATE bot_sessions
    SET greeted = true, display_name = CASE WHEN display_name = '' THEN $2 ELSE display_name END, updated_at = now()
    WHERE contact_id = $1 AND greeted = false
    RETURNING greeted`, [contactId, displayName]);
  return Boolean(result.rows[0]);
}

export async function updateSession(contactId: string, patch: Partial<{ greeted: boolean; awaitingOrderDetail: boolean; displayName: string }>) {
  await query(`UPDATE bot_sessions SET greeted = COALESCE($2, greeted), awaiting_order_detail = COALESCE($3, awaiting_order_detail),
    display_name = COALESCE($4, display_name), updated_at = now() WHERE contact_id = $1`,
    [contactId, patch.greeted ?? null, patch.awaitingOrderDetail ?? null, patch.displayName ?? null]);
}

export async function getContactById(contactId: string) {
  const result = await query<Contact>(`SELECT ${contactColumns} FROM contacts WHERE id = $1`, [contactId]);
  return result.rows[0] ?? null;
}

export async function getIncomingMessage(providerMessageId: string) {
  const result = await query<Message>(`SELECT id, direction, body, message_type AS "messageType", created_at AS "createdAt", provider_message_id AS "providerMessageId",
    delivery_status AS "deliveryStatus", media_id AS "mediaId", quote_message_id AS "quoteMessageId", quoted_provider_message_id AS "quotedProviderMessageId", media_mime_type AS "mediaMimeType", media_filename AS "mediaFilename", media_size AS "mediaSize", media_caption AS "mediaCaption", error
    FROM messages WHERE provider_message_id = $1`, [providerMessageId]);
  return result.rows[0] ?? null;
}

export async function getMessageById(messageId: string) {
  const result = await query<Message & { contactId: string; phone: string }>(`SELECT m.id, m.contact_id AS "contactId", c.phone, m.direction, m.body, m.message_type AS "messageType", m.created_at AS "createdAt", m.provider_message_id AS "providerMessageId",
    m.delivery_status AS "deliveryStatus", m.media_id AS "mediaId", m.media_asset_id AS "mediaAssetId", m.media_status AS "mediaStatus", m.quote_message_id AS "quoteMessageId", m.quoted_provider_message_id AS "quotedProviderMessageId", m.media_mime_type AS "mediaMimeType", m.media_filename AS "mediaFilename", m.media_size AS "mediaSize", m.media_caption AS "mediaCaption", m.error
    FROM messages m JOIN contacts c ON c.id=m.contact_id WHERE m.id=$1`, [messageId]);
  return result.rows[0] ?? null;
}

export async function createMediaAsset(input: { storageKey: string; mimeType: string; filename: string; sizeBytes?: number; sha256?: string; providerMediaId?: string; status?: 'pending' | 'ready'; width?: number; height?: number }) {
  const result = await query<MediaAsset>(`INSERT INTO media_assets (provider_media_id, storage_key, mime_type, filename, size_bytes, sha256, status, width, height)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, provider_media_id AS "providerMediaId", storage_key AS "storageKey", mime_type AS "mimeType", filename,
      size_bytes AS "sizeBytes", sha256, status, error, width, height, duration_ms AS "durationMs"`,
    [input.providerMediaId ?? null, input.storageKey, input.mimeType, input.filename, input.sizeBytes ?? null, input.sha256 ?? null, input.status ?? 'pending', input.width ?? null, input.height ?? null]);
  return result.rows[0];
}

export async function updateMediaAsset(assetId: string, patch: { providerMediaId?: string; status?: 'pending' | 'ready' | 'failed'; error?: string | null; width?: number | null; height?: number | null; durationMs?: number | null }) {
  const result = await query<MediaAsset>(`UPDATE media_assets SET provider_media_id=COALESCE($2,provider_media_id), status=COALESCE($3,status), error=CASE WHEN $4::boolean THEN $5 ELSE error END,
    width=COALESCE($6,width), height=COALESCE($7,height), duration_ms=COALESCE($8,duration_ms), updated_at=now() WHERE id=$1
    RETURNING id, provider_media_id AS "providerMediaId", storage_key AS "storageKey", mime_type AS "mimeType", filename, size_bytes AS "sizeBytes", sha256, status, error, width, height, duration_ms AS "durationMs"`,
    [assetId, patch.providerMediaId ?? null, patch.status ?? null, patch.error !== undefined, patch.error ?? null, patch.width ?? null, patch.height ?? null, patch.durationMs ?? null]);
  return result.rows[0] ?? null;
}

export async function getMediaAssetById(assetId: string) {
  const result = await query<MediaAsset>(`SELECT id, provider_media_id AS "providerMediaId", storage_key AS "storageKey", mime_type AS "mimeType", filename,
    size_bytes AS "sizeBytes", sha256, status, error, width, height, duration_ms AS "durationMs" FROM media_assets WHERE id=$1`, [assetId]);
  return result.rows[0] ?? null;
}

export async function getMediaAssetByProviderMediaId(providerMediaId: string) {
  const result = await query<MediaAsset>(`SELECT id, provider_media_id AS "providerMediaId", storage_key AS "storageKey", mime_type AS "mimeType", filename,
    size_bytes AS "sizeBytes", sha256, status, error, width, height, duration_ms AS "durationMs"
    FROM media_assets WHERE provider_media_id=$1`, [providerMediaId]);
  return result.rows[0] ?? null;
}

export async function getMediaAssetByMessageId(messageId: string) {
  const result = await query<MediaAsset>(`SELECT a.id, a.provider_media_id AS "providerMediaId", a.storage_key AS "storageKey", a.mime_type AS "mimeType", a.filename,
    a.size_bytes AS "sizeBytes", a.sha256, a.status, a.error, a.width, a.height, a.duration_ms AS "durationMs"
    FROM media_assets a JOIN messages m ON m.media_asset_id=a.id WHERE m.id=$1`, [messageId]);
  return result.rows[0] ?? null;
}

export async function attachMediaAssetToMessage(messageId: string, assetId: string, status: 'pending' | 'ready' | 'failed' = 'ready') {
  await query(`UPDATE messages SET media_asset_id=$2, media_status=$3 WHERE id=$1`, [messageId, assetId, status]);
}

export async function setMessageMediaStatus(messageId: string, status: 'pending' | 'ready' | 'failed', error?: string | null) {
  await query(`UPDATE messages SET media_status=$2, error=CASE WHEN $3::boolean THEN $4 ELSE error END WHERE id=$1`, [messageId, status, error !== undefined, error ?? null]);
}

export async function findMessageByProviderId(providerMessageId: string) {
  const result = await query<{ id: string }>('SELECT id FROM messages WHERE provider_message_id=$1', [providerMessageId]);
  return result.rows[0] ?? null;
}

export async function recordMessageStatus(providerMessageId: string, status: 'sent' | 'delivered' | 'read' | 'failed', error: string | null, payload: unknown) {
  return transaction(async client => {
    await client.query(`INSERT INTO message_status_events (provider_message_id,status,error,payload) VALUES ($1,$2,$3,$4::jsonb)
      ON CONFLICT (provider_message_id,status) DO NOTHING`, [providerMessageId, status, error, JSON.stringify(payload)]);
    const updated = await client.query(`UPDATE messages SET delivery_status=CASE
        WHEN delivery_status='read' OR (delivery_status='delivered' AND $2='sent') OR (delivery_status='failed' AND $2 IN ('sent','delivered','read')) THEN delivery_status
        ELSE $2 END, provider_status_at=now(), provider_error=$3, error=CASE WHEN $2='failed' THEN $3 ELSE error END
      WHERE provider_message_id=$1 RETURNING id, contact_id AS "contactId"`, [providerMessageId, status, error]);
    return updated.rows[0] ?? null;
  });
}

export async function prepareOutgoingMessage(contactId: string, key: string, body: string, messageType = 'text') {
  const result = await query<{ id: string; delivery_status: string | null }>(`
    WITH stored AS (
      INSERT INTO messages (contact_id, direction, body, message_type, outbound_key, delivery_status)
      VALUES ($1, 'outgoing', $2, $3, $4, 'pending')
      ON CONFLICT (outbound_key) DO UPDATE SET body = messages.body
      RETURNING id, delivery_status
    ), touched AS (
      UPDATE contacts SET last_message_at=now(), last_outgoing_at=now(), updated_at=now() WHERE id=$1 RETURNING id
    )
    SELECT stored.id, stored.delivery_status FROM stored CROSS JOIN (SELECT count(*) FROM touched) touched_count`, [contactId, body, messageType, key]);
  return result.rows[0];
}

/** Claims a pending outbound row so concurrent workers cannot send it twice. */
export async function claimOutgoingMessage(messageId: string) {
  const result = await query<{ id: string }>(`
    UPDATE messages
    SET delivery_status='sending', sending_at=now()
    WHERE id=$1 AND direction='outgoing' AND delivery_status='pending'
    RETURNING id`, [messageId]);
  return Boolean(result.rows[0]);
}

export async function prepareManualMessage(contactId: string, key: string, body: string, messageType: string, media?: { id?: string; assetId?: string; mimeType?: string; filename?: string; size?: number; caption?: string }, quoteMessageId?: string | null) {
  const result = await query<{ id: string; delivery_status: string | null }>(`
    INSERT INTO messages (contact_id, direction, body, message_type, outbound_key, delivery_status, media_id, media_asset_id, media_status, quote_message_id, quoted_provider_message_id, media_mime_type, media_filename, media_size, media_caption)
     VALUES ($1, 'outgoing', $2, $3, $4, 'pending', $5, $6, CASE WHEN $6::uuid IS NULL THEN NULL ELSE 'ready' END, $10, (SELECT provider_message_id FROM messages WHERE id=$10 AND contact_id=$1), $7, $8, $9, $11)
    ON CONFLICT (outbound_key) DO UPDATE SET body = messages.body
    RETURNING id, delivery_status`, [contactId, body, messageType, key, media?.id ?? null, media?.assetId ?? null, media?.mimeType ?? null, media?.filename ?? null, media?.size ?? null, quoteMessageId ?? null, media?.caption ?? null]);
  await query(`UPDATE contacts SET last_message_at=now(), last_outgoing_at=now(), updated_at=now() WHERE id=$1`, [contactId]);
  return result.rows[0];
}

export async function markOutgoingSent(messageId: string, providerMessageId?: string) {
  const result = await query<{ contact_id: string; outbound_key: string | null }>(`UPDATE messages SET delivery_status = 'sent', sending_at = NULL, provider_message_id = COALESCE($2, provider_message_id), sent_at = now() WHERE id = $1 RETURNING contact_id, outbound_key`, [messageId, providerMessageId ?? null]);
  if (result.rows[0]?.outbound_key?.startsWith('manual:')) await markSupportTicketAnswered(result.rows[0].contact_id, 'admin');
}

export async function markOutgoingFailed(messageId: string, error?: unknown) { await query(`UPDATE messages SET delivery_status = 'failed', sending_at = NULL, error = $2 WHERE id = $1`, [messageId, error instanceof Error ? error.message.slice(0, 1000) : error ? String(error).slice(0, 1000) : null]); }

export async function retryOutgoingMessage(messageId: string) {
  const result = await query(`UPDATE messages SET delivery_status='pending', sending_at=NULL, error=NULL WHERE id=$1 AND direction='outgoing' AND delivery_status='failed' RETURNING id`, [messageId]);
  return result.rows[0] ?? null;
}

/** Outbound requests can die after the provider accepted them. Do not resend automatically. */
export async function recoverStaleOutgoingMessages(maxAgeSeconds = 120) {
  const result = await query(`UPDATE messages
    SET delivery_status='failed', sending_at=NULL,
      error=COALESCE(error, 'Envío incierto tras reinicio o timeout; revisar antes de reintentar')
    WHERE direction='outgoing' AND delivery_status='sending'
      AND (sending_at IS NULL OR sending_at < now() - ($1::int * interval '1 second'))`, [maxAgeSeconds]);
  return result.rowCount ?? 0;
}

export async function workerHeartbeat(workerId: string) {
  await query(`INSERT INTO worker_heartbeats (worker_id, last_seen_at, updated_at) VALUES ($1, now(), now())
    ON CONFLICT (worker_id) DO UPDATE SET last_seen_at=now(), updated_at=now()`, [workerId]);
}

export async function queueMetrics() {
  const result = await query<{
    pending: string; processing: string; retrying: string; failed: string; oldestPendingSeconds: string | null;
  }>(`SELECT
      count(*) FILTER (WHERE status='queued')::text AS pending,
      count(*) FILTER (WHERE status='processing')::text AS processing,
      count(*) FILTER (WHERE status='retrying')::text AS retrying,
      count(*) FILTER (WHERE status='failed')::text AS failed,
      EXTRACT(EPOCH FROM (now() - min(created_at) FILTER (WHERE status IN ('queued','retrying'))))::text AS "oldestPendingSeconds"
    FROM jobs`);
  const row = result.rows[0];
  return {
    pending: Number(row?.pending ?? 0),
    processing: Number(row?.processing ?? 0),
    retrying: Number(row?.retrying ?? 0),
    failed: Number(row?.failed ?? 0),
    oldestPendingSeconds: row?.oldestPendingSeconds == null ? 0 : Math.max(0, Math.round(Number(row.oldestPendingSeconds))),
  };
}

export async function createOrder(contactId: string, customerName: string, detail: string) {
  const result = await query<{ id: number }>(`INSERT INTO orders (contact_id, customer_name, detail, status) VALUES ($1, $2, $3, 'submitted') RETURNING id`, [contactId, customerName || null, detail]);
  return result.rows[0].id;
}

export async function dashboard() {
  const [stats, recent, work, failures, worker, queue, providerActivity, backup, restore, archive, media, database] = await Promise.all([
    query<{ total: string; optedIn: string; unknown: string; optedOut: string }>(`SELECT count(*)::text AS total,
      count(*) FILTER (WHERE consent_status='opted_in')::text AS "optedIn", count(*) FILTER (WHERE consent_status='unknown')::text AS unknown,
      count(*) FILTER (WHERE consent_status='opted_out')::text AS "optedOut" FROM contacts`),
    query(`SELECT c.id, c.phone, c.name, c.public_name AS "publicName", c.consent_status AS "consentStatus", c.last_message_at AS "lastMessageAt",
      m.body AS "lastMessage", m.direction AS "lastDirection" FROM contacts c LEFT JOIN LATERAL
      (SELECT body, direction FROM messages WHERE contact_id=c.id ORDER BY created_at DESC LIMIT 1) m ON true
      WHERE c.last_message_at IS NOT NULL AND EXISTS (SELECT 1 FROM messages activity_m WHERE activity_m.contact_id=c.id) ORDER BY c.last_message_at DESC LIMIT 8`),
    query(`SELECT count(*) FILTER (WHERE unread_count > 0)::text AS "unread", count(*) FILTER (WHERE pipeline_status='new')::text AS "new",
      count(*) FILTER (WHERE follow_up_at IS NOT NULL AND follow_up_at <= now())::text AS "overdueFollowUps",
      count(*) FILTER (WHERE pipeline_status='order_received')::text AS "newOrders", count(*) FILTER (WHERE last_message_at >= current_date)::text AS "activeToday",
      count(*) FILTER (WHERE bot_paused)::text AS "botPaused",
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM support_tickets st WHERE st.contact_id = contacts.id AND st.status = 'open'))::text AS "openTickets"
      FROM contacts`),
    query(`SELECT count(*)::text AS "failedMessages" FROM messages WHERE delivery_status='failed'`),
    query<{ active: string }>(`SELECT count(*)::text AS active FROM worker_heartbeats WHERE last_seen_at > now() - interval '60 seconds'`),
    queueMetrics(),
    query<{ lastIncomingAt: string | null; lastOutgoingAt: string | null }>(`SELECT
      (SELECT max(received_at) FROM webhook_events) AS "lastIncomingAt",
      (SELECT max(COALESCE(provider_status_at, sent_at, created_at)) FROM messages
        WHERE direction='outgoing' AND delivery_status IN ('sent','delivered','read')) AS "lastOutgoingAt"`),
    query<{ kind: string; status: string; startedAt: string; completedAt: string | null; objectKey: string | null; error: string | null }>(`
      SELECT kind, status, started_at AS "startedAt", completed_at AS "completedAt", object_key AS "objectKey", error
      FROM backup_runs WHERE kind IN ('logical','physical','media')
      ORDER BY COALESCE(completed_at, started_at) DESC LIMIT 1`),
    query<{ status: string; startedAt: string; completedAt: string | null; error: string | null }>(`
      SELECT status, started_at AS "startedAt", completed_at AS "completedAt", error
      FROM backup_runs WHERE kind='restore' ORDER BY COALESCE(completed_at, started_at) DESC LIMIT 1`),
    query<{ enabled: boolean; archivedCount: string; failedCount: string; lastArchivedAt: string | null; lastFailedAt: string | null }>(`
      SELECT current_setting('archive_mode')='on' AS enabled,
        archived_count::text AS "archivedCount", failed_count::text AS "failedCount",
        last_archived_time AS "lastArchivedAt", last_failed_time AS "lastFailedAt"
      FROM pg_stat_archiver`),
    query<{ ready: string; pending: string; failed: string; bytes: string }>(`SELECT
      count(*) FILTER (WHERE status='ready')::text AS ready,
      count(*) FILTER (WHERE status='pending')::text AS pending,
      count(*) FILTER (WHERE status='failed')::text AS failed,
      COALESCE(sum(size_bytes) FILTER (WHERE status='ready'),0)::text AS bytes
      FROM media_assets`),
    query<{ bytes: string }>(`SELECT pg_database_size(current_database())::text AS bytes`),
  ]);
  const provider = providerActivity.rows[0] ?? { lastIncomingAt: null, lastOutgoingAt: null };
  const providerActivityDates = [provider.lastIncomingAt, provider.lastOutgoingAt]
    .filter((value): value is string => Boolean(value))
    .sort();
  const lastProviderActivityAt = providerActivityDates[providerActivityDates.length - 1] ?? null;
  const latestArchive = archive.rows[0];
  return {
    stats: stats.rows[0],
    work: work.rows[0],
    failures: failures.rows[0],
    worker: { healthy: Number(worker.rows[0].active) > 0 },
    queue,
    provider: { ...provider, lastActivityAt: lastProviderActivityAt },
    backup: backup.rows[0] ?? null,
    restore: restore.rows[0] ?? null,
    archive: latestArchive ? {
      enabled: latestArchive.enabled,
      archivedCount: Number(latestArchive.archivedCount),
      failedCount: Number(latestArchive.failedCount),
      lastArchivedAt: latestArchive.lastArchivedAt,
      lastFailedAt: latestArchive.lastFailedAt,
    } : { enabled: false, archivedCount: 0, failedCount: 0, lastArchivedAt: null, lastFailedAt: null },
    media: {
      ready: Number(media.rows[0]?.ready ?? 0), pending: Number(media.rows[0]?.pending ?? 0),
      failed: Number(media.rows[0]?.failed ?? 0), bytes: Number(media.rows[0]?.bytes ?? 0),
      driver: process.env.MEDIA_STORAGE_DRIVER ?? 'local',
    },
    database: { bytes: Number(database.rows[0]?.bytes ?? 0) },
    thresholds: { workerStaleSeconds: 60, queueOldestWarningSeconds: 120, backupWarningSeconds: 90_000, archiveRpoSeconds: 300 },
    recent: recent.rows,
  };
}

export async function listConversations(input: { q?: string; consent?: string; pipeline?: string; unread?: boolean; botPaused?: boolean; followUp?: 'overdue' | 'scheduled'; ticket?: 'open'; cursor?: string; limit: number }) {
  const values: unknown[] = []; const where: string[] = ['c.last_message_at IS NOT NULL', 'EXISTS (SELECT 1 FROM messages conversation_m WHERE conversation_m.contact_id=c.id)'];
  if (input.q) { values.push(`%${input.q}%`); where.push(`(c.name ILIKE $${values.length} OR c.public_name ILIKE $${values.length} OR c.phone ILIKE $${values.length} OR EXISTS (SELECT 1 FROM messages search_m WHERE search_m.contact_id=c.id AND search_m.body ILIKE $${values.length}))`); }
  if (input.consent && ['unknown','opted_in','opted_out'].includes(input.consent)) { values.push(input.consent); where.push(`c.consent_status = $${values.length}`); }
  if (input.pipeline && ['new','in_attention','follow_up','order_received','won','lost'].includes(input.pipeline)) { values.push(input.pipeline); where.push(`c.pipeline_status = $${values.length}`); }
  if (input.unread) where.push('c.unread_count > 0');
  if (typeof input.botPaused === 'boolean') { values.push(input.botPaused); where.push(`c.bot_paused = $${values.length}`); }
  if (input.followUp === 'overdue') where.push('c.follow_up_at IS NOT NULL AND c.follow_up_at <= now()');
  if (input.followUp === 'scheduled') where.push('c.follow_up_at IS NOT NULL AND c.follow_up_at > now()');
  if (input.ticket === 'open') where.push('ticket.id IS NOT NULL');
  if (input.cursor) { const [at, id] = Buffer.from(input.cursor, 'base64url').toString('utf8').split('|'); values.push(at, id); where.push(`(c.last_message_at, c.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`); }
  values.push(input.limit + 1);
  const rows = (await query<any>(`SELECT c.id, c.phone, c.name, c.public_name AS "publicName", c.consent_status AS "consentStatus", c.last_message_at AS "lastMessageAt",
    c.pipeline_status AS "pipelineStatus", c.assigned_to AS "assignedTo", c.follow_up_at AS "followUpAt", c.unread_count AS "unreadCount",
    c.last_incoming_at AS "lastIncomingAt", c.last_outgoing_at AS "lastOutgoingAt", c.bot_paused AS "botPaused",
    ticket.id AS "openTicketId", ticket.status AS "ticketStatus",
    m.body AS "lastMessage", m.direction AS "lastDirection", m.created_at AS "lastMessageCreatedAt", m.delivery_status AS "lastDeliveryStatus"
    FROM contacts c LEFT JOIN LATERAL (SELECT body,direction,created_at,delivery_status FROM messages WHERE contact_id=c.id ORDER BY created_at DESC LIMIT 1) m ON true
    LEFT JOIN LATERAL (SELECT id, status FROM support_tickets WHERE contact_id=c.id AND status='open' ORDER BY created_at DESC LIMIT 1) ticket ON true
    WHERE ${where.join(' AND ')} ORDER BY c.last_message_at DESC, c.id DESC LIMIT $${values.length}`, values)).rows;
  const hasMore = rows.length > input.limit; const items = rows.slice(0, input.limit);
  const last = items[items.length - 1]; const nextCursor = hasMore && last ? Buffer.from(`${last.lastMessageAt}|${last.id}`).toString('base64url') : null;
  return { items, nextCursor };
}

export async function getConversation(contactId: string) {
  const contact = await getContactById(contactId);
  if (!contact) return null;
  const [lastOrder, messageCount, openTicket, tickets] = await Promise.all([
    query(`SELECT id, customer_name AS "customerName", detail, status, created_at AS "createdAt" FROM orders WHERE contact_id=$1 ORDER BY created_at DESC LIMIT 1`, [contactId]),
    query<{ count: string }>('SELECT count(*)::text AS count FROM messages WHERE contact_id=$1', [contactId]),
    query<SupportTicket>(`SELECT ${ticketColumns} FROM support_tickets WHERE contact_id=$1 AND status='open' ORDER BY created_at DESC LIMIT 1`, [contactId]),
    query<SupportTicket>(`SELECT ${ticketColumns} FROM support_tickets WHERE contact_id=$1 ORDER BY created_at DESC LIMIT 20`, [contactId]),
  ]);
  return { contact, lastOrder: lastOrder.rows[0] ?? null, messageCount: Number(messageCount.rows[0].count), openTicket: openTicket.rows[0] ?? null, tickets: tickets.rows };
}

export async function getTicketById(ticketId: string) {
  const result = await query<any>(`SELECT ${ticketColumnsQualified},
      c.phone, c.name AS "contactName", c.public_name AS "publicName", c.unread_count AS "unreadCount",
      c.bot_paused AS "botPaused", c.last_incoming_at AS "lastIncomingAt", c.last_message_at AS "lastMessageAt",
      o.customer_name AS "orderCustomerName", o.detail AS "orderDetail",
      lm.body AS "lastMessage", lm.direction AS "lastDirection", lm.created_at AS "lastMessageCreatedAt",
      CASE WHEN st.status='closed' THEN 'closed'
           WHEN st.answered_at IS NOT NULL THEN 'responded'
           ELSE 'open' END AS "displayStatus"
    FROM support_tickets st
    JOIN contacts c ON c.id=st.contact_id
    LEFT JOIN orders o ON o.id=st.order_id
    LEFT JOIN LATERAL (SELECT body, direction, created_at FROM messages WHERE contact_id=st.contact_id ORDER BY created_at DESC LIMIT 1) lm ON true
    WHERE st.id=$1`, [ticketId]);
  return result.rows[0] ?? null;
}

export async function listTickets(input: {
  type?: 'question' | 'order';
  status?: 'open' | 'responded' | 'closed';
  closureReason?: string;
  q?: string;
  page: number;
  limit: number;
}) {
  const values: unknown[] = [];
  const where: string[] = ['true'];
  if (input.type) { values.push(input.type); where.push(`st.ticket_type=$${values.length}`); }
  if (input.status === 'open') where.push(`st.status='open' AND st.answered_at IS NULL`);
  if (input.status === 'responded') where.push(`st.status='open' AND st.answered_at IS NOT NULL`);
  if (input.status === 'closed') where.push(`st.status='closed'`);
  if (input.closureReason && ['order_completed', 'question_answered', 'customer_no_reply', 'operator_cancelled', 'fallback_sent', 'answered', 'no_customer_question', 'no_operator_response'].includes(input.closureReason)) {
    values.push(input.closureReason); where.push(`st.closure_reason=$${values.length}`);
  }
  if (input.q) {
    values.push(`%${input.q}%`);
    const p = `$${values.length}`;
    where.push(`(c.name ILIKE ${p} OR c.public_name ILIKE ${p} OR c.phone ILIKE ${p} OR st.subject ILIKE ${p} OR st.question ILIKE ${p} OR CAST(st.order_id AS text) ILIKE ${p} OR o.detail ILIKE ${p})`);
  }
  const countValues = [...values];
  values.push(input.limit, input.page * input.limit);
  const [data, count] = await Promise.all([
    query<any>(`SELECT ${ticketColumnsQualified}, c.phone, c.name AS "contactName", c.public_name AS "publicName",
        c.unread_count AS "unreadCount", c.bot_paused AS "botPaused", c.last_incoming_at AS "lastIncomingAt",
        o.customer_name AS "orderCustomerName", o.detail AS "orderDetail",
        lm.body AS "lastMessage", lm.direction AS "lastDirection", lm.created_at AS "lastMessageCreatedAt",
        CASE WHEN st.status='closed' THEN 'closed' WHEN st.answered_at IS NOT NULL THEN 'responded' ELSE 'open' END AS "displayStatus"
      FROM support_tickets st JOIN contacts c ON c.id=st.contact_id LEFT JOIN orders o ON o.id=st.order_id
      LEFT JOIN LATERAL (SELECT body, direction, created_at FROM messages WHERE contact_id=st.contact_id ORDER BY created_at DESC LIMIT 1) lm ON true
      WHERE ${where.join(' AND ')} ORDER BY st.updated_at DESC, st.id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values),
    query<{ count: string }>(`SELECT count(*)::text AS count FROM support_tickets st JOIN contacts c ON c.id=st.contact_id LEFT JOIN orders o ON o.id=st.order_id WHERE ${where.join(' AND ')}`, countValues),
  ]);
  return { items: data.rows, total: Number(count.rows[0].count), page: input.page, limit: input.limit };
}

export async function listMessages(contactId: string, before: string | undefined, limit: number) {
  const values: unknown[] = [contactId]; let beforeSql = '';
  if (before) { values.push(before); beforeSql = `AND m.created_at < $2::timestamptz`; }
  values.push(limit + 1);
  const rows = (await query<Message>(`SELECT m.id, m.direction, m.body, m.message_type AS "messageType", m.created_at AS "createdAt", m.provider_message_id AS "providerMessageId",
    m.delivery_status AS "deliveryStatus", m.media_id AS "mediaId", m.media_asset_id AS "mediaAssetId", m.media_status AS "mediaStatus", m.quote_message_id AS "quoteMessageId", m.quoted_provider_message_id AS "quotedProviderMessageId",
    m.media_mime_type AS "mediaMimeType", m.media_filename AS "mediaFilename", m.media_size AS "mediaSize", m.media_caption AS "mediaCaption", media.width AS "mediaWidth", media.height AS "mediaHeight", m.error,
    CASE WHEN m.quote_message_id IS NULL AND m.quoted_provider_message_id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', quoted.id, 'providerMessageId', COALESCE(quoted.provider_message_id, m.quoted_provider_message_id), 'direction', quoted.direction,
      'body', quoted.body, 'messageType', quoted.message_type, 'mediaMimeType', quoted.media_mime_type, 'mediaFilename', quoted.media_filename,
      'mediaCaption', quoted.media_caption, 'mediaStatus', quoted.media_status, 'mediaWidth', quoted_media.width, 'mediaHeight', quoted_media.height
    ) END AS "quotedMessage"
    FROM messages m
    LEFT JOIN media_assets media ON media.id=m.media_asset_id
    LEFT JOIN messages quoted ON quoted.id=m.quote_message_id
    LEFT JOIN media_assets quoted_media ON quoted_media.id=quoted.media_asset_id
    WHERE m.contact_id = $1 ${beforeSql} ORDER BY m.created_at DESC, m.id DESC LIMIT $${values.length}`, values)).rows;
  const hasMore = rows.length > limit; const items = rows.slice(0, limit).reverse();
  return { items, nextBefore: hasMore && items[0] ? items[0].createdAt : null };
}

export async function markConversationRead(contactId: string) {
  const result = await query<Contact>(`UPDATE contacts SET unread_count=0, last_read_at=now(), updated_at=now() WHERE id=$1 RETURNING ${contactColumns}`, [contactId]);
  return result.rows[0] ?? null;
}

export async function setBotPaused(contactId: string, paused: boolean, actor: string) {
  return transaction(async client => {
    const result = await client.query<Contact>(`UPDATE contacts SET bot_paused=$2, bot_paused_at=CASE WHEN $2 THEN now() ELSE NULL END,
      bot_paused_by=CASE WHEN $2 THEN $3 ELSE NULL END, updated_at=now() WHERE id=$1 RETURNING ${contactColumns}`, [contactId, paused, actor]);
    if (!result.rows[0]) return null;
    await client.query(`INSERT INTO admin_audit_log (actor, action, contact_id, metadata) VALUES ($1,$2,$3,$4::jsonb)`,
      [actor, paused ? 'conversation_taken' : 'conversation_released', contactId, JSON.stringify({ paused })]);
    return result.rows[0];
  });
}

export async function closeSupportTicket(ticketId: string, reason: SupportTicket['closureReason'], actor: string) {
  if (!reason) throw new Error('El motivo de cierre es obligatorio.');
  return transaction(async client => {
    const current = await client.query<{ id: string; contact_id: string; status: string; ticket_type: 'question' | 'order' }>(
      `SELECT id, contact_id, status, ticket_type FROM support_tickets WHERE id=$1 FOR UPDATE`, [ticketId]);
    const ticket = current.rows[0];
    if (!ticket) return null;
    if (ticket.status !== 'open') throw new Error('El ticket ya está cerrado.');
    const closed = await client.query<SupportTicket>(`UPDATE support_tickets SET status='closed', closure_reason=$2,
      closed_by=$3, closed_at=now(), updated_at=now() WHERE id=$1 RETURNING ${ticketColumns}`, [ticketId, reason, actor]);
    await client.query(`UPDATE contacts SET bot_paused=false, bot_paused_at=NULL, bot_paused_by=NULL, updated_at=now() WHERE id=$1`, [ticket.contact_id]);
    await client.query(`INSERT INTO admin_audit_log (actor, action, contact_id, metadata) VALUES ($1,'support_ticket_closed',$2,$3::jsonb)`,
      [actor, ticket.contact_id, JSON.stringify({ ticketId, reason, ticketType: ticket.ticket_type })]);
    return closed.rows[0] ?? null;
  });
}

async function createTicket(contactId: string, actor: string, ticketType: 'question' | 'order', orderId: number | null) {
  return transaction(async client => {
    const existing = await client.query<SupportTicket>(`SELECT ${ticketColumns} FROM support_tickets WHERE contact_id=$1 AND status='open' LIMIT 1`, [contactId]);
    if (existing.rows[0]) return { ticket: existing.rows[0], created: false };
    const subject = ticketType === 'order' ? 'Pedido pendiente de respuesta' : 'Pregunta fuera de preguntas frecuentes';
    const inserted = await client.query<SupportTicket>(`INSERT INTO support_tickets (contact_id, created_by, ticket_type, order_id, subject)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING ${ticketColumns}`, [contactId, actor, ticketType, orderId, subject]);
    if (!inserted.rows[0]) {
      const retry = await client.query<SupportTicket>(`SELECT ${ticketColumns} FROM support_tickets WHERE contact_id=$1 AND status='open' LIMIT 1`, [contactId]);
      return { ticket: retry.rows[0] ?? null, created: false };
    }
    await client.query(`UPDATE contacts SET bot_paused=true, bot_paused_at=now(), bot_paused_by=$2,
      pipeline_status=CASE WHEN pipeline_status IN ('won','lost') THEN pipeline_status ELSE 'in_attention' END, updated_at=now() WHERE id=$1`, [contactId, actor]);
    await client.query(`INSERT INTO admin_audit_log (actor, action, contact_id, metadata) VALUES ($1,'support_ticket_created',$2,$3::jsonb)`,
      [actor, contactId, JSON.stringify({ ticketId: inserted.rows[0].id, reason: ticketType === 'order' ? 'order_submitted' : 'faq_other_question', orderId })]);
    return { ticket: inserted.rows[0], created: true };
  });
}

export async function createSupportTicket(contactId: string, actor = 'bot') {
  return createTicket(contactId, actor, 'question', null);
}

export async function createOrderSupportTicket(contactId: string, orderId: number, actor = 'bot') {
  return createTicket(contactId, actor, 'order', orderId);
}

export async function recordSupportTicketQuestion(contactId: string, providerMessageId: string, question: string) {
  const result = await query<SupportTicket>(`UPDATE support_tickets SET question=$3,
    question_message_id=(SELECT id FROM messages WHERE provider_message_id=$2), updated_at=now()
    WHERE contact_id=$1 AND status='open' AND question='' RETURNING ${ticketColumns}`, [contactId, providerMessageId, question.slice(0, 4096)]);
  return result.rows[0] ?? null;
}

export async function markSupportTicketAnswered(contactId: string, actor: string) {
  const result = await query<SupportTicket>(`UPDATE support_tickets SET answered_by=$2, answered_at=now(), updated_at=now()
    WHERE contact_id=$1 AND status='open' RETURNING ${ticketColumns}`, [contactId, actor]);
  if (result.rows[0]) await audit(actor, 'support_ticket_answered', contactId, undefined, { ticketId: result.rows[0].id });
  return result.rows[0] ?? null;
}

export type OrderTicketFallback = {
  ticket: SupportTicket;
  contact: { id: string; phone: string; name: string; publicName: string; lastIncomingAt: string | null };
  order: { id: number; customerName: string | null; detail: string };
};

async function getOrderTicketFallback(ticketId: string): Promise<OrderTicketFallback | null> {
  const result = await query<SupportTicket & { contactRecordId: string; phone: string; contactName: string; publicName: string; lastIncomingAt: string | null; orderRecordId: number; customerName: string | null; detail: string }>(`
    SELECT ${ticketColumnsQualified}, c.id AS "contactRecordId", c.phone, c.name AS "contactName", c.public_name AS "publicName", c.last_incoming_at AS "lastIncomingAt",
      o.id AS "orderRecordId", o.customer_name AS "customerName", o.detail
    FROM support_tickets st
    JOIN contacts c ON c.id=st.contact_id
    JOIN orders o ON o.id=st.order_id
    WHERE st.id=$1 AND st.status='open' AND st.ticket_type='order'`, [ticketId]);
  const row = result.rows[0];
  return row ? {
    ticket: row,
    contact: { id: row.contactRecordId, phone: row.phone, name: row.contactName, publicName: row.publicName, lastIncomingAt: row.lastIncomingAt },
    order: { id: row.orderRecordId, customerName: row.customerName, detail: row.detail },
  } : null;
}

async function getClaimedOrderTicketFallback(ticketId: string) {
  try {
    return await getOrderTicketFallback(ticketId);
  } catch (error) {
    // A failed read must not leave the ticket locked for five minutes.
    await query(`UPDATE support_tickets SET fallback_claimed_at=NULL, updated_at=now()
      WHERE id=$1 AND fallback_sent_at IS NULL`, [ticketId]);
    throw error;
  }
}

export async function claimOrderTicketFallback(contactId?: string, expiredOnly = false) {
  const values: unknown[] = [];
  const conditions = [`st.status='open'`, `st.ticket_type='order'`, `st.fallback_sent_at IS NULL`,
    `(st.fallback_claimed_at IS NULL OR st.fallback_claimed_at < now() - interval '5 minutes')`];
  if (contactId) { values.push(contactId); conditions.push(`st.contact_id=$${values.length}`); }
  if (expiredOnly) conditions.push(`c.last_incoming_at IS NOT NULL AND c.last_incoming_at <= now() - interval '24 hours'`);
  const result = await query<{ id: string }>(`WITH candidate AS (
      SELECT st.id FROM support_tickets st JOIN contacts c ON c.id=st.contact_id
      WHERE ${conditions.join(' AND ')} ORDER BY st.updated_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE support_tickets st SET fallback_claimed_at=now(), fallback_error=NULL, updated_at=now()
      FROM candidate WHERE st.id=candidate.id RETURNING st.id`, values);
  return result.rows[0] ? getClaimedOrderTicketFallback(result.rows[0].id) : null;
}

export async function claimOrderTicketFallbackById(ticketId: string) {
  const result = await query<{ id: string }>(`UPDATE support_tickets SET fallback_claimed_at=now(), fallback_error=NULL, updated_at=now()
    WHERE id=$1 AND status='open' AND ticket_type='order' AND fallback_sent_at IS NULL
      AND (fallback_claimed_at IS NULL OR fallback_claimed_at < now() - interval '5 minutes')
    RETURNING id`, [ticketId]);
  return result.rows[0] ? getClaimedOrderTicketFallback(result.rows[0].id) : null;
}

export async function markOrderTicketFallbackSent(ticketId: string) {
  await query(`UPDATE support_tickets SET fallback_sent_at=now(), fallback_claimed_at=NULL, fallback_error=NULL, updated_at=now() WHERE id=$1`, [ticketId]);
}

export async function markOrderTicketFallbackFailed(ticketId: string, error: unknown) {
  await query(`UPDATE support_tickets SET fallback_claimed_at=NULL, fallback_error=$2, updated_at=now() WHERE id=$1`,
    [ticketId, error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000)]);
}

export async function audit(actor: string, action: string, contactId?: string, messageId?: string, metadata: unknown = {}) {
  await query(`INSERT INTO admin_audit_log (actor, action, contact_id, message_id, metadata) VALUES ($1,$2,$3,$4,$5::jsonb)`, [actor, action, contactId ?? null, messageId ?? null, JSON.stringify(metadata)]);
}

export async function listAudit(contactId?: string, limit = 100) {
  const values: unknown[] = [limit]; const where = contactId ? 'WHERE a.contact_id=$2' : '';
  if (contactId) values.push(contactId);
  return (await query(`SELECT a.id, a.actor, a.action, a.contact_id AS "contactId", a.message_id AS "messageId", a.metadata, a.created_at AS "createdAt"
    FROM admin_audit_log a ${where} ORDER BY a.created_at DESC LIMIT $1`, values)).rows;
}

export async function listContacts(input: { q?: string; consent?: string; page: number; limit: number }) {
  const values: unknown[] = []; const where: string[] = ['true'];
  if (input.q) { values.push(`%${input.q}%`); where.push(`(name ILIKE $${values.length} OR public_name ILIKE $${values.length} OR phone ILIKE $${values.length})`); }
  if (input.consent && ['unknown','opted_in','opted_out'].includes(input.consent)) { values.push(input.consent); where.push(`consent_status = $${values.length}`); }
  values.push(input.limit, input.page * input.limit);
  const [data, count] = await Promise.all([
    query<Contact>(`SELECT ${contactColumns} FROM contacts WHERE ${where.join(' AND ')} ORDER BY last_message_at DESC NULLS LAST, id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values),
    query<{ count: string }>(`SELECT count(*)::text AS count FROM contacts WHERE ${where.join(' AND ')}`, values.slice(0, -2)),
  ]);
  return { items: data.rows, total: Number(count.rows[0].count), page: input.page, limit: input.limit };
}

export async function exportContacts(input: { q?: string; consent?: string }) {
  const values: unknown[] = []; const where: string[] = ['true'];
  if (input.q) { values.push(`%${input.q}%`); where.push(`(name ILIKE $${values.length} OR public_name ILIKE $${values.length} OR phone ILIKE $${values.length})`); }
  if (input.consent && ['unknown','opted_in','opted_out'].includes(input.consent)) { values.push(input.consent); where.push(`consent_status = $${values.length}`); }
  return (await query<{ phone: string; name: string; publicName: string; consentStatus: ConsentStatus; labels: string[]; pipelineStatus: string; lastMessageAt: string | null }>(`
    SELECT phone, name, public_name AS "publicName", consent_status AS "consentStatus", labels,
      pipeline_status AS "pipelineStatus", last_message_at AS "lastMessageAt"
    FROM contacts WHERE ${where.join(' AND ')} ORDER BY last_message_at DESC NULLS LAST, id DESC`, values)).rows;
}

export async function updateContact(contactId: string, patch: Partial<{ name: string; publicName: string; notes: string; consentStatus: ConsentStatus; consentSource: string; labels: string[]; pipelineStatus: string; assignedTo: string | null; followUpAt: string | null }>, actor = 'admin') {
  const result = await query<Contact>(`UPDATE contacts SET name = COALESCE($2, name), public_name = COALESCE($3, public_name), notes = COALESCE($4, notes),
    consent_status = COALESCE($5, consent_status), consent_source = COALESCE($6, consent_source),
    consent_at = CASE WHEN $5='opted_in' THEN now() ELSE consent_at END,
    opt_out_at = CASE WHEN $5='opted_out' THEN now() ELSE opt_out_at END,
    labels = COALESCE($7::jsonb, labels), pipeline_status = COALESCE($8, pipeline_status), assigned_to = CASE WHEN $9::boolean THEN $10 ELSE assigned_to END,
    follow_up_at = CASE WHEN $11::boolean THEN $12::timestamptz ELSE follow_up_at END, updated_at=now() WHERE id=$1 RETURNING ${contactColumns}`,
    [contactId, patch.name ?? null, patch.publicName ?? null, patch.notes ?? null, patch.consentStatus ?? null, patch.consentSource ?? null,
      patch.labels ? JSON.stringify(patch.labels) : null, patch.pipelineStatus ?? null, patch.assignedTo !== undefined, patch.assignedTo ?? null,
      patch.followUpAt !== undefined, patch.followUpAt ?? null]);
  if (result.rows[0]) await audit(actor, 'contact_updated', contactId, undefined, patch);
  return result.rows[0] ?? null;
}

export async function listOrders(page: number, limit: number, filters: { status?: string; contactId?: string; from?: string; to?: string } = {}) {
  const values: unknown[] = []; const where: string[] = ['true'];
  if (filters.status && ['pending_customer','submitted','canceled','accepted'].includes(filters.status)) { values.push(filters.status); where.push(`o.status=$${values.length}`); }
  if (filters.contactId) { values.push(filters.contactId); where.push(`o.contact_id=$${values.length}`); }
  if (filters.from) { values.push(filters.from); where.push(`o.created_at >= $${values.length}::timestamptz`); }
  if (filters.to) { values.push(filters.to); where.push(`o.created_at < $${values.length}::timestamptz`); }
  const limitIndex = values.length + 1; values.push(limit); const offsetIndex = values.length + 1; values.push(page * limit);
  const [data, count] = await Promise.all([
    query(`SELECT o.id, o.contact_id AS "contactId", o.customer_name AS "customerName", o.detail, o.items, o.grand_total AS "grandTotal", o.status,
      o.accepted, o.accepted_at AS "acceptedAt", o.created_at AS "createdAt", c.phone
      FROM orders o LEFT JOIN contacts c ON c.id=o.contact_id WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC LIMIT $${limitIndex} OFFSET $${offsetIndex}`, values),
    query<{ count: string }>(`SELECT count(*)::text AS count FROM orders o WHERE ${where.join(' AND ')}`, values.slice(0, -2)),
  ]);
  return { items: data.rows, total: Number(count.rows[0].count), page, limit };
}

export async function updateOrder(orderId: number, status: string, actor: string) {
  if (!['pending_customer','submitted','canceled','accepted'].includes(status)) return null;
  const result = await query(`UPDATE orders SET status=$2, accepted=($2='accepted'), accepted_at=CASE WHEN $2='accepted' THEN COALESCE(accepted_at, now()) ELSE accepted_at END WHERE id=$1 RETURNING id, contact_id AS "contactId", customer_name AS "customerName", detail, status, created_at AS "createdAt"`, [orderId, status]);
  if (result.rows[0]) await audit(actor, 'order_updated', result.rows[0].contactId, undefined, { orderId, status });
  return result.rows[0] ?? null;
}

export async function listTemplates() {
  const result = await query(`SELECT id, meta_name AS "metaName", language, category, body, variables, status, created_at AS "createdAt", updated_at AS "updatedAt" FROM templates ORDER BY updated_at DESC`);
  return result.rows;
}

export async function saveTemplate(input: { id?: string; metaName: string; language: string; category: 'MARKETING'|'UTILITY'; body: string; variables: string[]; status: string }) {
  if (input.id) {
    const result = await query(`UPDATE templates SET meta_name=$2, language=$3, category=$4, body=$5, variables=$6::jsonb, status=$7, updated_at=now()
      WHERE id=$1 RETURNING id, meta_name AS "metaName", language, category, body, variables, status, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [input.id, input.metaName, input.language, input.category, input.body, JSON.stringify(input.variables), input.status]);
    return result.rows[0] ?? null;
  }
  const result = await query(`INSERT INTO templates (meta_name,language,category,body,variables,status) VALUES ($1,$2,$3,$4,$5::jsonb,$6)
    RETURNING id, meta_name AS "metaName", language, category, body, variables, status, created_at AS "createdAt", updated_at AS "updatedAt"`,
    [input.metaName, input.language, input.category, input.body, JSON.stringify(input.variables), input.status]);
  return result.rows[0];
}

export async function deleteTemplate(id: string) { const result = await query('DELETE FROM templates WHERE id=$1', [id]); return (result.rowCount ?? 0) > 0; }

export async function previewCampaignSegment(filters: { consentStatus?: ConsentStatus; activeSince?: string }) {
  const values: unknown[] = []; const where: string[] = ['true'];
  if (filters.consentStatus) { values.push(filters.consentStatus); where.push(`consent_status = $${values.length}`); }
  if (filters.activeSince) { values.push(filters.activeSince); where.push(`last_message_at >= $${values.length}::timestamptz`); }
  const result = await query<{ total: string }>(`SELECT count(*)::text AS total FROM contacts WHERE ${where.join(' AND ')}`, values);
  return { total: Number(result.rows[0].total), filters };
}
