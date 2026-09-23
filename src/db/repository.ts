import type { PoolClient } from 'pg';
import { query, transaction } from './pool';
import { normalizeText } from '../botMenu';
import { matchIntent } from '../ai/intentMatcher';
import { AI_UNCLEAR_LABEL_ANSWER, AI_UNCLEAR_LABEL_NAME } from '../ai/labelPolicy';

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

export type AiEngine = 'legacy' | 'jev';
export type AiSettings = { enabled: boolean; engine: AiEngine; updatedAt: string | null; updatedBy: string | null };
export type JevBudgetSubjectType = 'contact' | 'admin' | 'system';
export type JevBudgetSubject = { type: JevBudgetSubjectType; key: string };
export type JevBudgetLimits = { globalPerHour: number; contactPerHour: number; adminPerHour: number };
export type JevBudgetClaim =
  | { allowed: true; globalCount: number; subjectCount: number; globalRemaining: number; subjectRemaining: number }
  | { allowed: false; reason: 'global' | 'subject'; retryAfterSeconds: number };
export type AiAnswerRule = {
  id: string; question: string; normalizedQuestion: string; label: string | null; labelId: string | null; labelAnswer: string | null; aliases: string[]; answer: string; active: boolean; manual: boolean;
  createdBy: string | null; updatedBy: string | null; createdAt: string; updatedAt: string;
};
export type AiAnswerLabel = {
  id: string; name: string; normalizedName: string; answer: string; active: boolean;
  aliases: string[]; ruleIds: string[]; questionCount?: number; createdBy: string | null; updatedBy: string | null; createdAt: string; updatedAt: string;
};
export type AiQueryLog = {
  id: string; contactId: string | null; contactName: string; phone: string; question: string; answer: string;
  outcome: string; source: string; aiEnabled: boolean; matchedAnswerRuleId: string | null; matchedAnswerLabelId: string | null; label: string | null; model: string | null;
  suggestedLabelId: string | null; suggestedLabelName: string | null; classificationMethod: string | null; classificationConfidence: number | null;
  reviewStatus: 'pending' | 'resolved' | 'ignored'; reviewedAt: string | null; reviewedBy: string | null;
  previewAnswer: string | null; previewOutcome: string | null; previewSource: string | null; previewModel: string | null;
  previewTokens: number | null; previewElapsedMs: number | null; previewErrorCode: string | null; previewGeneratedAt: string | null;
  tokens: number; elapsedMs: number; errorCode: string | null; messageAt?: string; createdAt: string; updatedAt: string;
};

export type AiLabelCandidateStats = {
  events30d: number;
  contacts30d: number;
  contacts7d: number;
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

export async function upsertContact(client: PoolClient, phoneInput: string, profileName?: string, options: { markIncoming?: boolean; incomingAt?: Date } = {}) {
  const phone = normalizePhone(phoneInput);
  const markIncoming = options.markIncoming ?? true;
  const incomingAt = options.incomingAt?.toISOString() ?? null;
  const result = await client.query<Contact>(`
    INSERT INTO contacts (phone, country_code, name, first_seen_at, last_message_at, last_incoming_at, unread_count)
    VALUES ($1, CASE WHEN $1 LIKE '54%' THEN '54' ELSE '' END, COALESCE(NULLIF($2, ''), ''), CASE WHEN $3 THEN COALESCE($4::timestamptz, now()) ELSE now() END, CASE WHEN $3 THEN COALESCE($4::timestamptz, now()) ELSE NULL END, CASE WHEN $3 THEN COALESCE($4::timestamptz, now()) ELSE NULL END, CASE WHEN $3 THEN 1 ELSE 0 END)
    ON CONFLICT (phone) DO UPDATE SET
      name = CASE WHEN contacts.name = '' AND EXCLUDED.name <> '' THEN EXCLUDED.name ELSE contacts.name END,
      last_message_at = CASE WHEN $3 THEN COALESCE($4::timestamptz, now()) ELSE contacts.last_message_at END,
      last_incoming_at = CASE WHEN $3 THEN COALESCE($4::timestamptz, now()) ELSE contacts.last_incoming_at END,
      unread_count = CASE WHEN $3 THEN contacts.unread_count + 1 ELSE contacts.unread_count END,
      updated_at = now()
    RETURNING ${contactColumns}`,
    [phone, profileName?.trim() ?? '', markIncoming, incomingAt]);
  return result.rows[0];
}

const aiAnswerRuleColumns = `r.id, r.question, r.normalized_question AS "normalizedQuestion", r.intent_label AS label,
  r.label_id AS "labelId", l.name AS "labelName", COALESCE(l.answer, r.answer) AS "labelAnswer",
  COALESCE((SELECT json_agg(a.alias ORDER BY a.created_at ASC) FROM ai_answer_rule_aliases a WHERE a.answer_rule_id = r.id), '[]'::json) AS aliases,
  r.answer, r.active, r.manual,
  r.created_by AS "createdBy", r.updated_by AS "updatedBy", r.created_at AS "createdAt", r.updated_at AS "updatedAt"`;
const aiQueryColumns = `q.id, q.contact_id AS "contactId", COALESCE(NULLIF(c.public_name, ''), NULLIF(c.name, ''), 'Sin nombre') AS "contactName",
  COALESCE(c.phone, '') AS phone, q.question, q.answer, q.outcome, q.source, q.ai_enabled AS "aiEnabled",
  q.matched_answer_rule_id AS "matchedAnswerRuleId", q.matched_label_id AS "matchedAnswerLabelId", COALESCE(al.name, r.intent_label, sl.name, q.suggested_label_name) AS label, q.model, q.tokens, q.elapsed_ms AS "elapsedMs", q.error_code AS "errorCode",
  q.suggested_label_id AS "suggestedLabelId", q.suggested_label_name AS "suggestedLabelName", q.classification_method AS "classificationMethod",
  q.classification_confidence AS "classificationConfidence", q.review_status AS "reviewStatus", q.reviewed_at AS "reviewedAt", q.reviewed_by AS "reviewedBy",
  q.preview_answer AS "previewAnswer", q.preview_outcome AS "previewOutcome", q.preview_source AS "previewSource",
  q.preview_model AS "previewModel", q.preview_tokens AS "previewTokens", q.preview_elapsed_ms AS "previewElapsedMs",
  q.preview_error_code AS "previewErrorCode", q.preview_generated_at AS "previewGeneratedAt",
  COALESCE((SELECT m.created_at FROM messages m WHERE m.provider_message_id=q.provider_message_id LIMIT 1), q.created_at) AS "messageAt",
  q.created_at AS "createdAt", q.updated_at AS "updatedAt"`;

function normalizedAiLabelName(name: string) {
  return normalizeText(name);
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

export async function deleteContact(contactId: string, actor = 'admin') {
  return transaction(async client => {
    const contactResult = await client.query<{ id: string; phone: string; name: string; publicName: string }>(
      `SELECT id, phone, name, public_name AS "publicName" FROM contacts WHERE id = $1 FOR UPDATE`,
      [contactId],
    );
    const contact = contactResult.rows[0];
    if (!contact) return null;
    const messageCount = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM messages WHERE contact_id = $1`,
      [contactId],
    );
    await client.query(
      `INSERT INTO admin_audit_log (actor, action, contact_id, metadata) VALUES ($1, 'contact_deleted', $2, $3::jsonb)`,
      [actor, contactId, JSON.stringify({ phone: contact.phone, name: contact.name, messageCount: Number(messageCount.rows[0]?.count ?? 0) })],
    );
    await client.query(`DELETE FROM contacts WHERE id = $1`, [contactId]);
    return { ...contact, messageCount: Number(messageCount.rows[0]?.count ?? 0) };
  });
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
    const incomingAt = input.sourceTimestamp ? new Date(input.sourceTimestamp) : undefined;
    const contact = await upsertContact(client, input.phone, input.profileName, { incomingAt });
    // Any new incoming message means the customer interacted again. Pending
    // advisor reminders for older messages must not be sent afterward.
    await client.query(`UPDATE advisor_followups
      SET status='cancelled', completed_at=now(), locked_at=NULL, locked_by=NULL
      WHERE contact_id=$1 AND status='pending'`, [contact.id]);
    await client.query(`INSERT INTO bot_sessions (contact_id, display_name) VALUES ($1, $2)
      ON CONFLICT (contact_id) DO UPDATE SET display_name = CASE WHEN bot_sessions.display_name = '' THEN EXCLUDED.display_name ELSE bot_sessions.display_name END, updated_at = now()`,
      [contact.id, input.profileName?.trim() ?? '']);
    const quoted = input.quotedProviderMessageId
      ? await client.query<{ id: string }>('SELECT id FROM messages WHERE contact_id=$1 AND provider_message_id=$2 LIMIT 1', [contact.id, input.quotedProviderMessageId])
      : null;
    const insertedMessage = await client.query<{ id: string }>(`INSERT INTO messages (contact_id, direction, body, message_type, provider_message_id, media_id, media_mime_type, media_filename, media_size, media_caption, media_status, quote_message_id, quoted_provider_message_id, created_at)
      VALUES ($1, 'incoming', $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $5::text IS NULL THEN NULL ELSE 'pending' END, $10, $11, COALESCE($12::timestamptz, now())) RETURNING id`, [contact.id, input.body, input.messageType, input.providerMessageId,
      input.media?.id ?? null, input.media?.mimeType ?? null, input.media?.filename ?? null, input.media?.size ?? null, input.media?.caption ?? null, quoted?.rows[0]?.id ?? null, input.quotedProviderMessageId ?? null, incomingAt?.toISOString() ?? null]);
    await client.query(`INSERT INTO jobs (type, contact_id, webhook_event_id) VALUES ('process_incoming', $1, $2)`, [contact.id, event.rows[0].id]);
    if (input.media?.id && ['image', 'document', 'audio', 'video', 'sticker'].includes(input.messageType)) {
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
        WHERE j.status IN ('queued', 'retrying') AND j.run_after <= now() AND j.type <> 'ai_preview'
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

export type AdvisorFollowup = {
  id: string;
  contact_id: string;
  trigger_provider_message_id: string;
  attempts: number;
};

export async function scheduleAdvisorFollowup(contactId: string, triggerProviderMessageId: string, dueAt: Date) {
  const result = await query<AdvisorFollowup>(`INSERT INTO advisor_followups
    (contact_id, trigger_provider_message_id, due_at)
    VALUES ($1, $2, $3)
    ON CONFLICT (contact_id, trigger_provider_message_id) DO NOTHING
    RETURNING id, contact_id, trigger_provider_message_id, attempts`,
    [contactId, triggerProviderMessageId, dueAt]);
  return result.rows[0] ?? null;
}

/** Claims one reminder only when the customer has not sent a newer message. */
export async function claimDueAdvisorFollowup(workerId: string) {
  return transaction(async client => {
    const result = await client.query<AdvisorFollowup>(`
      WITH candidate AS (
        SELECT f.id
        FROM advisor_followups f
        JOIN contacts c ON c.id=f.contact_id
        JOIN messages trigger_message
          ON trigger_message.contact_id=f.contact_id
         AND trigger_message.provider_message_id=f.trigger_provider_message_id
        WHERE f.status='pending'
          AND f.due_at <= now()
          AND c.bot_paused=false
          AND NOT EXISTS (
            SELECT 1 FROM messages newer
            WHERE newer.contact_id=f.contact_id
              AND newer.direction='incoming'
              AND newer.created_at > trigger_message.created_at
          )
        ORDER BY f.due_at ASC, f.created_at ASC, f.id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE advisor_followups f
      SET status='processing', attempts=f.attempts+1, locked_at=now(), locked_by=$1, last_error=NULL
      FROM candidate
      WHERE f.id=candidate.id
      RETURNING f.id, f.contact_id, f.trigger_provider_message_id, f.attempts`, [workerId]);
    return result.rows[0] ?? null;
  });
}

export async function isAdvisorFollowupEligible(followupId: string) {
  const result = await query<{ id: string }>(`
    SELECT f.id
    FROM advisor_followups f
    JOIN contacts c ON c.id=f.contact_id
    JOIN messages trigger_message
      ON trigger_message.contact_id=f.contact_id
     AND trigger_message.provider_message_id=f.trigger_provider_message_id
    WHERE f.id=$1
      AND f.status='processing'
      AND c.bot_paused=false
      AND NOT EXISTS (
        SELECT 1 FROM messages newer
        WHERE newer.contact_id=f.contact_id
          AND newer.direction='incoming'
          AND newer.created_at > trigger_message.created_at
      )`, [followupId]);
  return Boolean(result.rows[0]);
}

export async function completeAdvisorFollowup(followupId: string, sentMessageId?: string) {
  await query(`UPDATE advisor_followups
    SET status='sent', sent_message_id=COALESCE($2, sent_message_id), completed_at=now(), locked_at=NULL, locked_by=NULL
    WHERE id=$1 AND status='processing'`, [followupId, sentMessageId ?? null]);
}

export async function cancelAdvisorFollowup(followupId: string) {
  await query(`UPDATE advisor_followups
    SET status='cancelled', completed_at=now(), locked_at=NULL, locked_by=NULL
    WHERE id=$1 AND status IN ('pending', 'processing')`, [followupId]);
}

export async function retryAdvisorFollowup(followupId: string, attempts: number, error: unknown) {
  const delaySeconds = Math.min(3600, 2 ** Math.min(attempts, 10));
  const message = error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
  await query(`UPDATE advisor_followups
    SET status=CASE WHEN attempts >= 8 THEN 'failed' ELSE 'pending' END,
      due_at=now() + ($2 || ' seconds')::interval,
      last_error=$3, locked_at=NULL, locked_by=NULL,
      completed_at=CASE WHEN attempts >= 8 THEN now() ELSE NULL END
    WHERE id=$1 AND status='processing'`, [followupId, delaySeconds, message]);
}

export async function recoverStaleAdvisorFollowups(maxHeartbeatAgeSeconds = 30, maxProcessingSeconds = 60) {
  const result = await query(`UPDATE advisor_followups f
    SET status='pending', due_at=now(), locked_at=NULL, locked_by=NULL,
      last_error=COALESCE(f.last_error, 'Worker interrumpido antes de enviar el seguimiento')
    WHERE f.status='processing' AND (
      f.locked_at IS NULL OR
      f.locked_at < now() - ($2::int * interval '1 second') OR
      NOT EXISTS (
        SELECT 1 FROM worker_heartbeats wh
        WHERE wh.worker_id=f.locked_by
          AND wh.last_seen_at >= now() - ($1::int * interval '1 second')
      )
    )`, [maxHeartbeatAgeSeconds, maxProcessingSeconds]);
  return result.rowCount ?? 0;
}

export async function getJobEvent(jobId: string) {
  const result = await query<{ payload: unknown; contact_id: string; provider_message_id: string; received_at: string; source_timestamp: string | null; isFirstIncoming: boolean }>(`
    SELECT e.payload, j.contact_id, e.provider_message_id, e.received_at, e.source_timestamp,
      NOT EXISTS (
        SELECT 1 FROM messages older
        JOIN messages current ON current.provider_message_id=e.provider_message_id
        WHERE older.contact_id=j.contact_id AND older.direction='incoming'
          AND (older.created_at, older.id) < (current.created_at, current.id)
      ) AS "isFirstIncoming"
    FROM jobs j JOIN webhook_events e ON e.id = j.webhook_event_id WHERE j.id = $1`, [jobId]);
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
    SELECT duplicate.id FROM messages duplicate
    JOIN messages current ON current.provider_message_id = $2
    WHERE duplicate.contact_id = $1
      AND duplicate.direction = 'incoming'
      AND duplicate.provider_message_id <> $2
      AND lower(btrim(COALESCE(duplicate.body, ''))) = $3
      AND duplicate.created_at >= current.created_at - ($4::int * interval '1 second')
      AND (duplicate.created_at, duplicate.id) < (current.created_at, current.id)
    ORDER BY duplicate.created_at DESC, duplicate.id DESC
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
      ON CONFLICT (outbound_key) DO UPDATE SET
        body = messages.body,
        delivery_status = CASE WHEN messages.delivery_status='failed' THEN 'pending' ELSE messages.delivery_status END,
        error = CASE WHEN messages.delivery_status='failed' THEN NULL ELSE messages.error END
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

export function encodeConversationCursor(lastMessageAt: unknown, id: string): string | null {
  if (!id) return null;
  let iso = '';
  if (lastMessageAt instanceof Date) {
    iso = lastMessageAt.toISOString();
  } else if (typeof lastMessageAt === 'string' && lastMessageAt.trim()) {
    const parsed = new Date(lastMessageAt);
    iso = !isNaN(parsed.getTime()) ? parsed.toISOString() : lastMessageAt.trim();
  } else if (typeof lastMessageAt === 'number' && Number.isFinite(lastMessageAt)) {
    iso = new Date(lastMessageAt).toISOString();
  }
  if (!iso) return null;
  return Buffer.from(`${iso}|${id}`).toString('base64url');
}

export function decodeConversationCursor(cursor: string): { at: string; id: string } | null {
  if (!cursor || typeof cursor !== 'string') return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const separatorIndex = raw.lastIndexOf('|');
    if (separatorIndex === -1) return null;
    const rawAt = raw.slice(0, separatorIndex).trim();
    const id = raw.slice(separatorIndex + 1).trim();
    if (!rawAt || !id) return null;
    const parsed = new Date(rawAt);
    const at = !isNaN(parsed.getTime()) ? parsed.toISOString() : rawAt;
    return { at, id };
  } catch {
    return null;
  }
}

export async function listConversations(input: { q?: string; consent?: string; pipeline?: string; unread?: boolean; botPaused?: boolean; followUp?: 'overdue' | 'scheduled'; ticket?: 'open'; analyticsNoMenu?: { from: string; to: string }; cursor?: string; limit: number }) {
  const values: unknown[] = []; const where: string[] = ['c.last_message_at IS NOT NULL', 'EXISTS (SELECT 1 FROM messages conversation_m WHERE conversation_m.contact_id=c.id)'];
  if (input.q) { values.push(`%${input.q}%`); where.push(`(c.name ILIKE $${values.length} OR c.public_name ILIKE $${values.length} OR c.phone ILIKE $${values.length} OR EXISTS (SELECT 1 FROM messages search_m WHERE search_m.contact_id=c.id AND search_m.body ILIKE $${values.length}))`); }
  if (input.consent && ['unknown','opted_in','opted_out'].includes(input.consent)) { values.push(input.consent); where.push(`c.consent_status = $${values.length}`); }
  if (input.pipeline && ['new','in_attention','follow_up','order_received','won','lost'].includes(input.pipeline)) { values.push(input.pipeline); where.push(`c.pipeline_status = $${values.length}`); }
  if (input.unread) where.push('c.unread_count > 0');
  if (typeof input.botPaused === 'boolean') { values.push(input.botPaused); where.push(`c.bot_paused = $${values.length}`); }
  if (input.followUp === 'overdue') where.push('c.follow_up_at IS NOT NULL AND c.follow_up_at <= now()');
  if (input.followUp === 'scheduled') where.push('c.follow_up_at IS NOT NULL AND c.follow_up_at > now()');
  if (input.ticket === 'open') where.push('ticket.id IS NOT NULL');
  if (input.analyticsNoMenu) {
    // Contacts who had at least one incoming message in the period but zero menu_option events in the same period.
    // Both from/to are already validated ISO strings before this function is called.
    values.push(input.analyticsNoMenu.from, input.analyticsNoMenu.to);
    const fromIdx = values.length - 1;
    const toIdx = values.length;
    where.push(`EXISTS (SELECT 1 FROM messages nm WHERE nm.contact_id=c.id AND nm.direction='incoming' AND nm.created_at >= $${fromIdx}::timestamptz AND nm.created_at <= $${toIdx}::timestamptz)`);
    where.push(`NOT EXISTS (SELECT 1 FROM bot_analytics_events bae WHERE bae.contact_id=c.id AND bae.event_type='menu_option' AND bae.created_at >= $${fromIdx}::timestamptz AND bae.created_at <= $${toIdx}::timestamptz)`);
  }
  if (input.cursor) {
    const decoded = decodeConversationCursor(input.cursor);
    if (decoded) {
      values.push(decoded.at, decoded.id);
      where.push(`(c.last_message_at, c.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
    }
  }
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
  const last = items[items.length - 1]; const nextCursor = hasMore && last ? encodeConversationCursor(last.lastMessageAt, last.id) : null;
  return { items, nextCursor };
}

export type ConversationStats = {
  totalConversations: number;
  unreadConversations: number;
  unreadMessages: number;
  totalMessages: number;
  openTickets: number;
};

export async function getConversationStats(): Promise<ConversationStats> {
  const result = await query<{
    totalConversations: string;
    unreadConversations: string;
    unreadMessages: string;
    totalMessages: string;
    openTickets: string;
  }>(`WITH conversation_contacts AS (
      SELECT c.unread_count
      FROM contacts c
      WHERE c.last_message_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM messages m WHERE m.contact_id=c.id)
    )
    SELECT
      count(*)::text AS "totalConversations",
      count(*) FILTER (WHERE unread_count > 0)::text AS "unreadConversations",
      COALESCE(sum(unread_count), 0)::text AS "unreadMessages",
      (SELECT count(*)::text FROM messages) AS "totalMessages",
      (SELECT count(*)::text FROM support_tickets WHERE status='open') AS "openTickets"
    FROM conversation_contacts`);
  const row = result.rows[0];
  return {
    totalConversations: Number(row?.totalConversations ?? 0),
    unreadConversations: Number(row?.unreadConversations ?? 0),
    unreadMessages: Number(row?.unreadMessages ?? 0),
    totalMessages: Number(row?.totalMessages ?? 0),
    openTickets: Number(row?.openTickets ?? 0),
  };
}

export async function markAllConversationsRead() {
  const result = await query<{ contactsUpdated: string; messagesMarkedRead: string }>(`WITH unread AS (
      SELECT c.id, c.unread_count
      FROM contacts c
      WHERE c.unread_count > 0
        AND c.last_message_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM messages m WHERE m.contact_id=c.id)
    ), updated AS (
      UPDATE contacts c
      SET unread_count=0, last_read_at=now(), updated_at=now()
      FROM unread u
      WHERE c.id=u.id
      RETURNING u.unread_count
    )
    SELECT count(*)::text AS "contactsUpdated",
      COALESCE(sum(unread_count), 0)::text AS "messagesMarkedRead"
    FROM updated`);
  return {
    contactsUpdated: Number(result.rows[0]?.contactsUpdated ?? 0),
    messagesMarkedRead: Number(result.rows[0]?.messagesMarkedRead ?? 0),
  };
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

export const CONTACT_INQUIRY_LABELS: Record<string, string> = {
  horarios: 'Horarios', direccion: 'Dirección', lista_precio: 'Precios',
  hacer_pedido: 'Nuevo Pedido', asesor: 'Asesor Humano',
  preguntas_frecuentes: 'Preguntas frecuentes', no_reconocidas: 'No reconocidas',
};
const inquiryCategorySql = `CASE WHEN e.event_type='unrecognized_message' THEN 'no_reconocidas' ELSE e.selected_option END`;
const inquiryEventsSql = `(e.event_type='unrecognized_message' OR (e.event_type='menu_option' AND e.selected_option IS NOT NULL))`;
const contactInquiriesSql = `ARRAY(SELECT DISTINCT ${inquiryCategorySql} FROM bot_analytics_events e
  WHERE e.contact_id=contacts.id AND ${inquiryEventsSql} ORDER BY 1) AS "inquiryTypes"`;
const contactInquiryCountsSql = `(
  SELECT COALESCE(jsonb_object_agg(sub.cat, sub.cnt), '{}'::jsonb)
  FROM (
    SELECT ${inquiryCategorySql} AS cat, count(*)::int AS cnt
    FROM bot_analytics_events e
    WHERE e.contact_id=contacts.id AND ${inquiryEventsSql} AND (${inquiryCategorySql}) IS NOT NULL
    GROUP BY ${inquiryCategorySql}
  ) sub
) AS "inquiryCounts"`;

function contactFilters(input: { q?: string; consent?: string; inquiry?: string }) {
  const values: unknown[] = []; const where = ['true'];
  if (input.q) { values.push(`%${input.q}%`); where.push(`(name ILIKE $${values.length} OR public_name ILIKE $${values.length} OR phone ILIKE $${values.length})`); }
  if (input.consent && ['unknown','opted_in','opted_out'].includes(input.consent)) { values.push(input.consent); where.push(`consent_status = $${values.length}`); }
  if (input.inquiry) {
    if (Object.prototype.hasOwnProperty.call(CONTACT_INQUIRY_LABELS, input.inquiry)) {
      values.push(input.inquiry);
      where.push(`EXISTS (SELECT 1 FROM bot_analytics_events e WHERE e.contact_id=contacts.id AND ${inquiryEventsSql} AND ${inquiryCategorySql}=$${values.length})`);
    } else where.push('false');
  }
  return { values, where };
}

export async function listContacts(input: { q?: string; consent?: string; inquiry?: string; page: number; limit: number }) {
  const { values, where } = contactFilters(input);
  values.push(input.limit, input.page * input.limit);
  const [data, count] = await Promise.all([
    query<Contact & { inquiryTypes: string[]; inquiryCounts?: Record<string, number> }>(`SELECT ${contactColumns}, ${contactInquiriesSql}, ${contactInquiryCountsSql} FROM contacts WHERE ${where.join(' AND ')} ORDER BY last_message_at DESC NULLS LAST, id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values),
    query<{ count: string }>(`SELECT count(*)::text AS count FROM contacts WHERE ${where.join(' AND ')}`, values.slice(0, -2)),
  ]);
  return { items: data.rows, total: Number(count.rows[0].count), page: input.page, limit: input.limit };
}

export async function exportContacts(input: { q?: string; consent?: string; inquiry?: string }) {
  const { values, where } = contactFilters(input);
  return (await query<Contact & { inquiryTypes: string[]; inquiryCounts?: Record<string, number> }>(`
    SELECT ${contactColumns}, ${contactInquiriesSql}, ${contactInquiryCountsSql}
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

/* ═══════════════════════════════════════════════════════
   BOT BEHAVIOR ANALYTICS
   ═══════════════════════════════════════════════════════ */

export type BotAnalyticsEventType =
  | 'menu_option'
  | 'menu_requested'
  | 'order_started'
  | 'order_submitted'
  | 'human_advisor_requested'
  | 'flow_command'
  | 'unrecognized_message'
  | 'bot_paused_message';

export async function recordBotInteractionEvent(input: {
  contactId: string;
  providerMessageId: string;
  eventType: BotAnalyticsEventType;
  selectedOption?: string | null;
  rawText?: string | null;
  normalizedText?: string | null;
  messageType?: string;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}) {
  try {
    const result = await query<{ id: string }>(`
      INSERT INTO bot_analytics_events (
        contact_id, provider_message_id, event_type, selected_option,
        raw_text, normalized_text, message_type, metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, COALESCE($9, now()))
      ON CONFLICT (provider_message_id, event_type) DO NOTHING
      RETURNING id`,
      [
        input.contactId,
        input.providerMessageId,
        input.eventType,
        input.selectedOption ?? null,
        input.rawText ?? null,
        input.normalizedText ?? null,
        input.messageType ?? 'text',
        JSON.stringify(input.metadata ?? {}),
        input.createdAt ? input.createdAt.toISOString() : null,
      ]
    );
    return result.rows[0]?.id ?? null;
  } catch (error) {
    console.error('[repository] Error recording bot analytics event:', error);
    return null;
  }
}

export type AnalyticsPeriodKey = '7d' | '30d' | '90d' | 'custom';

const ANALYTICS_TIME_ZONE = 'America/Argentina/Cordoba';
const ANALYTICS_UTC_OFFSET = '-03:00';

export function isValidAnalyticsDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function analyticsDateOnly(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ANALYTICS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function shiftDateOnly(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function analyticsDayBoundary(value: string, endOfDay = false): Date {
  if (!isValidAnalyticsDateOnly(value)) throw new Error(`Fecha de analíticas inválida: ${value}`);
  return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}${ANALYTICS_UTC_OFFSET}`);
}

export function resolveAnalyticsPeriod(options: {
  period?: AnalyticsPeriodKey;
  from?: string;
  to?: string;
} = {}, now = new Date()): {
  periodKey: AnalyticsPeriodKey;
  fromDate: Date;
  toDate: Date;
  periodLabel: string;
} {
  const periodKey: AnalyticsPeriodKey = options.period || '30d';
  if (periodKey === 'custom') {
    if (!options.from || !options.to || !isValidAnalyticsDateOnly(options.from) || !isValidAnalyticsDateOnly(options.to)) {
      throw new Error('El rango personalizado requiere fechas válidas en formato YYYY-MM-DD.');
    }
    return {
      periodKey,
      fromDate: analyticsDayBoundary(options.from),
      toDate: analyticsDayBoundary(options.to, true),
      periodLabel: 'Rango personalizado',
    };
  }

  const days = periodKey === '7d' ? 7 : periodKey === '90d' ? 90 : 30;
  const today = analyticsDateOnly(now);
  return {
    periodKey,
    fromDate: analyticsDayBoundary(shiftDateOnly(today, -(days - 1))),
    toDate: new Date(now),
    periodLabel: `Últimos ${days} días`,
  };
}

export type BotAnalyticsSummary = {
  totalUniqueContacts: number;
  totalNewContacts: number;
  /** Unique contacts that sent a message in the period after having contacted us before. */
  totalReturningContacts: number;
  totalIncomingMessages: number;
  totalMenuInteractions: number;
  totalMenuOptionsRecognized: number;
  totalUnrecognizedMessages: number;
  totalOrdersStarted: number;
  totalOrdersSubmitted: number;
  totalAdvisorRequests: number;
  contactsWithoutMenuCount: number;
  contactsWithoutBotResponseCount: number;
  menuOptionRate: number;
  unrecognizedRate: number;
};

export type MenuOptionStat = {
  id: string;
  label: string;
  number: string;
  count: number;
  uniqueContacts: number;
  percentage: number;
};

export type TrendPoint = {
  date: string;
  incomingMessages: number;
  menuInteractions: number;
  menuRequested: number;
  optionsRecognized: number;
  unrecognized: number;
  uniqueContacts: number;
};

export type NewContactsByDayPoint = {
  date: string;
  /** Contacts whose very first incoming message ever falls on this calendar day (Argentina TZ) */
  newContacts: number;
};

export type ReturningContactsByDayPoint = {
  date: string;
  /** Contacts whose first message happened before this calendar day and who wrote on it. */
  returningContacts: number;
};

export type UnrecognizedPattern = {
  text: string;
  normalizedText: string;
  count: number;
  uniqueContacts: number;
  lastSeenAt: string;
};

export type UnrecognizedMessageItem = {
  id: string;
  contactId: string;
  contactName: string;
  phone: string;
  rawText: string;
  normalizedText: string;
  messageType: string;
  createdAt: string;
};

export type ContactWithoutMenuItem = {
  id: string;
  name: string;
  publicName: string;
  phone: string;
  pipelineStatus: string;
  lastMessageAt: string | null;
  lastIncomingAt: string;
  messageCount: number;
  botResponseCount: number;
  lastBotResponseAt: string | null;
  responseStatus: 'responded' | 'unanswered';
};

export type BotAnalyticsData = {
  period: {
    key: AnalyticsPeriodKey;
    from: string;
    to: string;
    label: string;
  };
  summary: BotAnalyticsSummary;
  menuOptions: MenuOptionStat[];
  trend: TrendPoint[];
  /** New contacts per day: contacts whose first-ever incoming message falls in the queried period */
  newContactsByDay: NewContactsByDayPoint[];
  /** Returning contacts per day: contacts who wrote that day and had written before that day. */
  returningContactsByDay: ReturningContactsByDayPoint[];
  unrecognizedMessages: {
    total: number;
    uniqueContacts: number;
    topPatterns: UnrecognizedPattern[];
    items: UnrecognizedMessageItem[];
  };
  contactsWithoutMenu: {
    total: number;
    withoutBotResponse: number;
    items: ContactWithoutMenuItem[];
  };
  coverage: {
    hasTrackingData: boolean;
    earliestEventAt: string | null;
    totalEventsTracked: number;
    note: string;
  };
};

const MENU_OPTION_METADATA: Array<{ id: string; label: string; number: string }> = [
  { id: 'horarios', label: 'Horarios', number: '1' },
  { id: 'direccion', label: 'Dirección', number: '2' },
  { id: 'lista_precio', label: 'Precios', number: '3' },
  { id: 'hacer_pedido', label: 'Nuevo Pedido', number: '4' },
  { id: 'asesor', label: 'Asesor Humano', number: '5' },
  { id: 'preguntas_frecuentes', label: 'Preguntas frecuentes', number: '6' },
];

export async function getBotAnalytics(options: {
  period?: AnalyticsPeriodKey;
  from?: string;
  to?: string;
  limit?: number;
} = {}): Promise<BotAnalyticsData> {
  const { periodKey, fromDate, toDate, periodLabel } = resolveAnalyticsPeriod(options);

  const listLimit = Math.max(1, Math.min(Number(options.limit) || 50, 100));
  const fromIso = fromDate.toISOString();
  const toIso = toDate.toISOString();

  // 1. Unique contacts and incoming messages from messages table in date range
  const msgStatsQuery = await query<{ unique_contacts: string; incoming_count: string }>(`
    SELECT
      count(DISTINCT contact_id)::text AS unique_contacts,
      count(*)::text AS incoming_count
    FROM messages
    WHERE direction = 'incoming' AND created_at >= $1 AND created_at <= $2
  `, [fromIso, toIso]);

  const totalIncomingMessages = Number(msgStatsQuery.rows[0]?.incoming_count || 0);
  let totalUniqueContacts = Number(msgStatsQuery.rows[0]?.unique_contacts || 0);

  // 2. Aggregated summary from bot_analytics_events
  const eventStatsQuery = await query<{
    menu_interactions: string;
    options_recognized: string;
    unrecognized: string;
    orders_started: string;
    orders_submitted: string;
    advisor_requests: string;
    unique_event_contacts: string;
  }>(`
    SELECT
      count(*) FILTER (WHERE event_type IN ('menu_option', 'menu_requested'))::text AS menu_interactions,
      count(*) FILTER (WHERE event_type = 'menu_option' AND selected_option IS NOT NULL)::text AS options_recognized,
      count(*) FILTER (WHERE event_type = 'unrecognized_message')::text AS unrecognized,
      count(*) FILTER (WHERE event_type = 'order_started')::text AS orders_started,
      count(*) FILTER (WHERE event_type = 'order_submitted')::text AS orders_submitted,
      count(DISTINCT provider_message_id) FILTER (
        WHERE event_type = 'human_advisor_requested'
          OR (event_type = 'menu_option' AND selected_option = 'asesor')
      )::text AS advisor_requests,
      count(DISTINCT contact_id)::text AS unique_event_contacts
    FROM bot_analytics_events
    WHERE created_at >= $1 AND created_at <= $2
  `, [fromIso, toIso]);

  const evRow = eventStatsQuery.rows[0];
  const totalMenuInteractions = Number(evRow?.menu_interactions || 0);
  const totalMenuOptionsRecognized = Number(evRow?.options_recognized || 0);
  const totalUnrecognizedMessages = Number(evRow?.unrecognized || 0);
  const totalOrdersStarted = Number(evRow?.orders_started || 0);
  const totalOrdersSubmitted = Number(evRow?.orders_submitted || 0);
  const totalAdvisorRequests = Number(evRow?.advisor_requests || 0);
  if (totalUniqueContacts === 0 && evRow?.unique_event_contacts) {
    totalUniqueContacts = Number(evRow.unique_event_contacts);
  }

  // 2. Coverage info & tracking boundary
  const coverageQuery = await query<{
    total_events: string;
    earliest_event_at: string | null;
  }>(`
    SELECT
      count(*)::text AS total_events,
      min(created_at)::text AS earliest_event_at
    FROM bot_analytics_events
  `);

  const totalEventsTracked = Number(coverageQuery.rows[0]?.total_events || 0);
  const earliestEventAt = coverageQuery.rows[0]?.earliest_event_at || null;
  const hasTrackingData = totalEventsTracked > 0 && earliestEventAt !== null;

  let effectiveContactsFromIso = fromIso;
  let coverageNote = 'Métricas generadas a partir de eventos persistidos en el pipeline del worker. No contiene datos simulados ni mockeados.';

  if (!hasTrackingData) {
    coverageNote = 'Sin eventos analíticos registrados todavía. Las métricas de uso de menú y contactos comenzarán a acumularse a medida que ingresen nuevas interacciones.';
  } else if (earliestEventAt && fromDate.getTime() < new Date(earliestEventAt).getTime()) {
    effectiveContactsFromIso = new Date(earliestEventAt).toISOString();
    coverageNote = `Registro de interacciones activo desde ${earliestEventAt.slice(0, 10)}. Para garantizar exactitud, los contactos sin selección de menú se computan sobre el período con cobertura de eventos.`;
  }

  // 3. Contacts who sent messages in the period but selected 0 menu options (constrained to tracked period)
  let contactsWithoutMenuCount = 0;
  let contactsWithoutBotResponseCount = 0;
  if (hasTrackingData) {
    const contactsWithoutMenuCountQuery = await query<{ count: string; without_bot_response: string }>(`
      WITH no_menu_contacts AS (
        SELECT m.contact_id
        FROM messages m
        WHERE m.direction = 'incoming' AND m.created_at >= $1 AND m.created_at <= $2
        GROUP BY m.contact_id
        HAVING NOT EXISTS (
          SELECT 1 FROM bot_analytics_events b
          WHERE b.contact_id = m.contact_id
            AND b.event_type = 'menu_option'
            AND b.created_at >= $1 AND b.created_at <= $2
        )
      ), response_stats AS (
        SELECT
          nmc.contact_id,
          count(DISTINCT out.id) AS bot_response_count
        FROM no_menu_contacts nmc
        LEFT JOIN messages out
          ON out.contact_id = nmc.contact_id
          AND out.direction = 'outgoing'
          AND COALESCE(out.outbound_key, '') NOT LIKE 'manual:%'
          AND (out.delivery_status IN ('sent', 'delivered', 'read') OR (out.delivery_status IS NULL AND out.sent_at IS NOT NULL))
          AND out.created_at >= $1 AND out.created_at <= $2
          AND EXISTS (
            SELECT 1 FROM messages incoming
            WHERE incoming.contact_id = nmc.contact_id
              AND incoming.direction = 'incoming'
              AND incoming.created_at >= $1 AND incoming.created_at <= $2
              AND out.created_at >= incoming.created_at
              AND out.created_at <= incoming.created_at + interval '10 minutes'
          )
        GROUP BY nmc.contact_id
      )
      SELECT
        count(*)::text AS count,
        count(*) FILTER (WHERE COALESCE(bot_response_count, 0) = 0)::text AS without_bot_response
      FROM response_stats
    `, [effectiveContactsFromIso, toIso]);
    contactsWithoutMenuCount = Number(contactsWithoutMenuCountQuery.rows[0]?.count || 0);
    contactsWithoutBotResponseCount = Number(contactsWithoutMenuCountQuery.rows[0]?.without_bot_response || 0);
  }

  // 4. Breakdown by the 6 menu options
  const menuBreakdownQuery = await query<{
    selected_option: string;
    count: string;
    unique_contacts: string;
  }>(`
    SELECT
      selected_option,
      count(*)::text AS count,
      count(DISTINCT contact_id)::text AS unique_contacts
    FROM bot_analytics_events
    WHERE created_at >= $1 AND created_at <= $2
      AND event_type = 'menu_option'
      AND selected_option IS NOT NULL
    GROUP BY selected_option
  `, [fromIso, toIso]);

  const breakdownMap = new Map<string, { count: number; uniqueContacts: number }>();
  for (const row of menuBreakdownQuery.rows) {
    breakdownMap.set(row.selected_option, {
      count: Number(row.count),
      uniqueContacts: Number(row.unique_contacts),
    });
  }

  const menuOptions: MenuOptionStat[] = MENU_OPTION_METADATA.map(meta => {
    const data = breakdownMap.get(meta.id) || { count: 0, uniqueContacts: 0 };
    const percentage = totalMenuOptionsRecognized > 0
      ? Math.round((data.count / totalMenuOptionsRecognized) * 1000) / 10
      : 0;
    return {
      id: meta.id,
      label: meta.label,
      number: meta.number,
      count: data.count,
      uniqueContacts: data.uniqueContacts,
      percentage,
    };
  });

  // 5. Daily Trend
  const dailyMessagesQuery = await query<{
    day: string;
    incoming_count: string;
    unique_contacts: string;
  }>(`
    SELECT
      to_char(date_trunc('day', created_at AT TIME ZONE 'America/Argentina/Cordoba'), 'YYYY-MM-DD') AS day,
      count(*)::text AS incoming_count,
      count(DISTINCT contact_id)::text AS unique_contacts
    FROM messages
    WHERE direction = 'incoming' AND created_at >= $1 AND created_at <= $2
    GROUP BY 1
    ORDER BY 1 ASC
  `, [fromIso, toIso]);

  const trendQuery = await query<{
  day: string;
  menu_interactions: string;
  menu_requested: string;
  options_recognized: string;
    unrecognized: string;
    unique_contacts: string;
  }>(`
    SELECT
      to_char(date_trunc('day', created_at AT TIME ZONE 'America/Argentina/Cordoba'), 'YYYY-MM-DD') AS day,
      count(*) FILTER (WHERE event_type IN ('menu_option', 'menu_requested'))::text AS menu_interactions,
      count(*) FILTER (WHERE event_type = 'menu_requested')::text AS menu_requested,
      count(*) FILTER (WHERE event_type = 'menu_option')::text AS options_recognized,
      count(*) FILTER (WHERE event_type = 'unrecognized_message')::text AS unrecognized,
      count(DISTINCT contact_id)::text AS unique_contacts
    FROM bot_analytics_events
    WHERE created_at >= $1 AND created_at <= $2
    GROUP BY 1
    ORDER BY 1 ASC
  `, [fromIso, toIso]);

  const dailyMsgMap = new Map<string, { incoming: number; uniqueContacts: number }>();
  for (const row of dailyMessagesQuery.rows) {
    dailyMsgMap.set(row.day, {
      incoming: Number(row.incoming_count || 0),
      uniqueContacts: Number(row.unique_contacts || 0),
    });
  }

  const allDays = new Set<string>([
    ...dailyMessagesQuery.rows.map(r => r.day),
    ...trendQuery.rows.map(r => r.day),
  ]);
  const sortedDays = Array.from(allDays).sort();
  const eventMap = new Map(trendQuery.rows.map(r => [r.day, r]));

  const trend: TrendPoint[] = sortedDays.map(day => {
    const ev = eventMap.get(day);
    const msg = dailyMsgMap.get(day);
    return {
      date: day,
      incomingMessages: msg?.incoming ?? (Number(ev?.options_recognized || 0) + Number(ev?.unrecognized || 0)),
      menuInteractions: Number(ev?.menu_interactions || 0),
      menuRequested: Number(ev?.menu_requested || 0),
      optionsRecognized: Number(ev?.options_recognized || 0),
      unrecognized: Number(ev?.unrecognized || 0),
      uniqueContacts: msg?.uniqueContacts ?? Number(ev?.unique_contacts || 0),
    };
  });

  // 6. Unrecognized messages - top patterns
  const topPatternsQuery = await query<{
    text: string;
    normalized_text: string;
    count: string;
    unique_contacts: string;
    last_seen_at: string;
  }>(`
    SELECT
      COALESCE(NULLIF(TRIM(raw_text), ''), '[Mensaje sin texto]') AS text,
      COALESCE(NULLIF(TRIM(normalized_text), ''), '[sin normalizar]') AS normalized_text,
      count(*)::text AS count,
      count(DISTINCT contact_id)::text AS unique_contacts,
      max(created_at) AS last_seen_at
    FROM bot_analytics_events
    WHERE created_at >= $1 AND created_at <= $2
      AND event_type = 'unrecognized_message'
    GROUP BY 1, 2
    ORDER BY count(*) DESC, max(created_at) DESC
    LIMIT $3
  `, [fromIso, toIso, listLimit]);

  const topPatterns: UnrecognizedPattern[] = topPatternsQuery.rows.map(r => ({
    text: r.text,
    normalizedText: r.normalized_text,
    count: Number(r.count),
    uniqueContacts: Number(r.unique_contacts),
    lastSeenAt: r.last_seen_at,
  }));

  // 7. Recent unrecognized messages list
  const recentUnrecognizedQuery = await query<{
    id: string;
    contact_id: string;
    contact_name: string;
    phone: string;
    raw_text: string | null;
    normalized_text: string | null;
    message_type: string;
    created_at: string;
  }>(`
    SELECT
      e.id,
      e.contact_id,
      COALESCE(NULLIF(c.name, ''), NULLIF(c.public_name, ''), c.phone) AS contact_name,
      c.phone,
      e.raw_text,
      e.normalized_text,
      e.message_type,
      e.created_at
    FROM bot_analytics_events e
    JOIN contacts c ON c.id = e.contact_id
    WHERE e.created_at >= $1 AND e.created_at <= $2
      AND e.event_type = 'unrecognized_message'
    ORDER BY e.created_at DESC
    LIMIT $3
  `, [fromIso, toIso, listLimit]);

  const unrecognizedItems: UnrecognizedMessageItem[] = recentUnrecognizedQuery.rows.map(r => ({
    id: r.id,
    contactId: r.contact_id,
    contactName: r.contact_name,
    phone: r.phone,
    rawText: r.raw_text || '',
    normalizedText: r.normalized_text || '',
    messageType: r.message_type,
    createdAt: r.created_at,
  }));

  const unrecognizedUniqueContactsQuery = await query<{ count: string }>(`
    SELECT count(DISTINCT contact_id)::text AS count
    FROM bot_analytics_events
    WHERE created_at >= $1 AND created_at <= $2
      AND event_type = 'unrecognized_message'
  `, [fromIso, toIso]);
  const unrecognizedUniqueContacts = Number(unrecognizedUniqueContactsQuery.rows[0]?.count || 0);

  // 8. Contacts without menu list (constrained to tracked period)
  let contactsWithoutMenuItems: ContactWithoutMenuItem[] = [];
  if (hasTrackingData) {
    const contactsWithoutMenuListQuery = await query<{
      id: string;
      name: string;
      public_name: string;
      phone: string;
      pipeline_status: string;
      last_message_at: string | null;
      message_count: string;
      last_incoming_at: string;
      bot_response_count: string;
      last_bot_response_at: string | null;
      response_status: 'responded' | 'unanswered';
    }>(`
      WITH no_menu_contacts AS (
        SELECT
          m.contact_id,
          count(*)::text AS message_count,
          max(m.created_at) AS last_incoming_at
        FROM messages m
        WHERE m.direction = 'incoming' AND m.created_at >= $1 AND m.created_at <= $2
          AND NOT EXISTS (
            SELECT 1 FROM bot_analytics_events b
            WHERE b.contact_id = m.contact_id
              AND b.event_type = 'menu_option'
              AND b.created_at >= $1 AND b.created_at <= $2
          )
        GROUP BY m.contact_id
      ), response_stats AS (
        SELECT
          nmc.contact_id,
          count(DISTINCT out.id)::text AS bot_response_count,
          max(out.created_at)::text AS last_bot_response_at
        FROM no_menu_contacts nmc
        LEFT JOIN messages out
          ON out.contact_id = nmc.contact_id
          AND out.direction = 'outgoing'
          AND COALESCE(out.outbound_key, '') NOT LIKE 'manual:%'
          AND (out.delivery_status IN ('sent', 'delivered', 'read') OR (out.delivery_status IS NULL AND out.sent_at IS NOT NULL))
          AND out.created_at >= $1 AND out.created_at <= $2
          AND EXISTS (
            SELECT 1 FROM messages incoming
            WHERE incoming.contact_id = nmc.contact_id
              AND incoming.direction = 'incoming'
              AND incoming.created_at >= $1 AND incoming.created_at <= $2
              AND out.created_at >= incoming.created_at
              AND out.created_at <= incoming.created_at + interval '10 minutes'
          )
        GROUP BY nmc.contact_id
      )
      SELECT
        c.id,
        c.name,
        c.public_name,
        c.phone,
        c.pipeline_status,
        c.last_message_at,
        nmc.message_count,
        nmc.last_incoming_at,
        COALESCE(rs.bot_response_count, '0') AS bot_response_count,
        rs.last_bot_response_at,
        CASE WHEN COALESCE(rs.bot_response_count, '0')::integer > 0 THEN 'responded' ELSE 'unanswered' END AS response_status
      FROM no_menu_contacts nmc
      JOIN contacts c ON c.id = nmc.contact_id
      LEFT JOIN response_stats rs ON rs.contact_id = nmc.contact_id
      ORDER BY (COALESCE(rs.bot_response_count, '0')::integer = 0) DESC, nmc.last_incoming_at DESC
      LIMIT $3
    `, [effectiveContactsFromIso, toIso, listLimit]);

    contactsWithoutMenuItems = contactsWithoutMenuListQuery.rows.map(r => ({
      id: r.id,
      name: r.name,
      publicName: r.public_name,
      phone: r.phone,
      pipelineStatus: r.pipeline_status,
      lastMessageAt: r.last_message_at,
      lastIncomingAt: r.last_incoming_at,
      messageCount: Number(r.message_count),
      botResponseCount: Number(r.bot_response_count),
      lastBotResponseAt: r.last_bot_response_at,
      responseStatus: r.response_status,
    }));
  }

  // 9. New and returning contacts by local calendar day.
  // The source of truth is the first incoming message, rather than contacts.first_seen_at:
  // this keeps the metric correct for imported contacts and contacts created by an admin.
  const contactActivityByDayQuery = await query<{
    day: string;
    new_contacts: string;
    returning_contacts: string;
  }>(`
    WITH incoming_in_period AS (
      SELECT
        m.contact_id,
        date_trunc('day', m.created_at AT TIME ZONE 'America/Argentina/Cordoba') AS day_local
      FROM messages m
      WHERE m.direction = 'incoming' AND m.created_at >= $1 AND m.created_at <= $2
    ), first_incoming AS (
      SELECT contact_id, min(created_at) AS first_message_at
      FROM messages
      WHERE direction = 'incoming'
      GROUP BY contact_id
    )
    SELECT
      to_char(i.day_local, 'YYYY-MM-DD') AS day,
      count(DISTINCT i.contact_id) FILTER (
        WHERE date_trunc('day', f.first_message_at AT TIME ZONE 'America/Argentina/Cordoba') = i.day_local
      )::text AS new_contacts,
      count(DISTINCT i.contact_id) FILTER (
        WHERE f.first_message_at < (i.day_local AT TIME ZONE 'America/Argentina/Cordoba')
      )::text AS returning_contacts
    FROM incoming_in_period i
    JOIN first_incoming f ON f.contact_id = i.contact_id
    GROUP BY i.day_local
    ORDER BY i.day_local ASC
  `, [fromIso, toIso]);

  const newContactsByDay: NewContactsByDayPoint[] = contactActivityByDayQuery.rows.map(r => ({
    date: r.day,
    newContacts: Number(r.new_contacts),
  }));
  const returningContactsByDay: ReturningContactsByDayPoint[] = contactActivityByDayQuery.rows.map(r => ({
    date: r.day,
    returningContacts: Number(r.returning_contacts),
  }));

  const totalNewContacts = newContactsByDay.reduce((sum, pt) => sum + pt.newContacts, 0);
  const totalReturningContactsQuery = await query<{ count: string }>(`
    WITH incoming_in_period AS (
      SELECT DISTINCT
        m.contact_id,
        date_trunc('day', m.created_at AT TIME ZONE 'America/Argentina/Cordoba') AS day_local
      FROM messages m
      WHERE m.direction = 'incoming' AND m.created_at >= $1 AND m.created_at <= $2
    ), first_incoming AS (
      SELECT contact_id, min(created_at) AS first_message_at
      FROM messages
      WHERE direction = 'incoming'
      GROUP BY contact_id
    )
    SELECT count(DISTINCT i.contact_id)::text AS count
    FROM incoming_in_period i
    JOIN first_incoming f ON f.contact_id = i.contact_id
    WHERE f.first_message_at < (i.day_local AT TIME ZONE 'America/Argentina/Cordoba')
  `, [fromIso, toIso]);
  const totalReturningContacts = Number(totalReturningContactsQuery.rows[0]?.count || 0);

  const menuOptionRate = totalIncomingMessages > 0
    ? Math.round((totalMenuOptionsRecognized / totalIncomingMessages) * 1000) / 10
    : 0;
  const unrecognizedRate = totalIncomingMessages > 0
    ? Math.round((totalUnrecognizedMessages / totalIncomingMessages) * 1000) / 10
    : 0;

  return {
    period: {
      key: periodKey,
      from: fromIso,
      to: toIso,
      label: periodLabel,
    },
    summary: {
      totalUniqueContacts,
      totalNewContacts,
      totalReturningContacts,
      totalIncomingMessages,
      totalMenuInteractions,
      totalMenuOptionsRecognized,
      totalUnrecognizedMessages,
      totalOrdersStarted,
      totalOrdersSubmitted,
      totalAdvisorRequests,
      contactsWithoutMenuCount,
      contactsWithoutBotResponseCount,
      menuOptionRate,
      unrecognizedRate,
    },
    menuOptions,
    trend,
    newContactsByDay,
    returningContactsByDay,
    unrecognizedMessages: {
      total: totalUnrecognizedMessages,
      uniqueContacts: unrecognizedUniqueContacts,
      topPatterns,
      items: unrecognizedItems,
    },
    contactsWithoutMenu: {
      total: contactsWithoutMenuCount,
      withoutBotResponse: contactsWithoutBotResponseCount,
      items: contactsWithoutMenuItems,
    },
    coverage: {
      hasTrackingData,
      earliestEventAt,
      totalEventsTracked,
      note: coverageNote,
    },
  };

}


export async function getAiSettings(): Promise<AiSettings> {
  const result = await query<AiSettings>('SELECT enabled, engine, updated_at AS "updatedAt", updated_by AS "updatedBy" FROM ai_settings WHERE id = 1');
  return result.rows[0] ?? { enabled: false, engine: 'legacy', updatedAt: null, updatedBy: null };
}

export async function setAiEnabled(enabled: boolean, actor: string | null, engine: AiEngine = 'jev'): Promise<AiSettings> {
  const result = await query<AiSettings>(`
    INSERT INTO ai_settings (id, enabled, engine, updated_by, updated_at)
    VALUES (1, $1, $3, $2, now())
    ON CONFLICT (id) DO UPDATE SET enabled = EXCLUDED.enabled,
      engine = CASE WHEN EXCLUDED.enabled THEN EXCLUDED.engine ELSE ai_settings.engine END,
      updated_by = EXCLUDED.updated_by, updated_at = now()
    RETURNING enabled, engine, updated_at AS "updatedAt", updated_by AS "updatedBy"`, [enabled, actor, engine]);
  return result.rows[0];
}

function nonNegativeInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getJevBudgetLimits(env: Record<string, string | undefined> = process.env): JevBudgetLimits {
  return {
    globalPerHour: nonNegativeInteger(env.JEV_BUDGET_GLOBAL_PER_HOUR, 500),
    contactPerHour: nonNegativeInteger(env.JEV_BUDGET_CONTACT_PER_HOUR, 30),
    adminPerHour: nonNegativeInteger(env.JEV_BUDGET_ADMIN_PER_HOUR, 120),
  };
}

class JevBudgetDenied extends Error {
  constructor(public readonly reason: 'global' | 'subject') {
    super(`Jev budget denied: ${reason}`);
  }
}

let lastJevBudgetCleanupAt = 0;

function secondsUntilNextHour(now = new Date()) {
  const nextHour = new Date(now);
  nextHour.setUTCMinutes(0, 0, 0);
  nextHour.setUTCHours(nextHour.getUTCHours() + 1);
  return Math.max(1, Math.ceil((nextHour.getTime() - now.getTime()) / 1000));
}

/**
 * Reserves one paid Jev request atomically across the global breaker and the
 * per-subject limit. Global is always locked first to keep lock ordering stable
 * across app and worker processes. A rejected subject rolls back the global
 * increment as part of the same transaction.
 */
export async function claimJevBudget(
  subject: JevBudgetSubject,
  limits: JevBudgetLimits = getJevBudgetLimits(),
): Promise<JevBudgetClaim> {
  const subjectKey = subject.key.trim().slice(0, 256);
  if (!subjectKey) throw new Error('El sujeto de la cuota Jev es obligatorio.');
  const subjectLimit = subject.type === 'contact' ? limits.contactPerHour : limits.adminPerHour;
  if (limits.globalPerHour <= 0) return { allowed: false, reason: 'global', retryAfterSeconds: secondsUntilNextHour() };
  if (subjectLimit <= 0) return { allowed: false, reason: 'subject', retryAfterSeconds: secondsUntilNextHour() };

  type BudgetRow = { requestCount: number };
  try {
    const reserved = await transaction(async client => {
      const reserve = async (scope: 'global' | JevBudgetSubjectType, key: string, limit: number) => {
        const result = await client.query<BudgetRow>(`INSERT INTO jev_usage_buckets
          (bucket_start, scope, subject_key, request_count)
          VALUES (date_trunc('hour', now()), $1, $2, 1)
          ON CONFLICT (bucket_start, scope, subject_key) DO UPDATE
          SET request_count=jev_usage_buckets.request_count+1, updated_at=now()
          WHERE jev_usage_buckets.request_count < $3
          RETURNING request_count AS "requestCount"`, [scope, key, limit]);
        return result.rows[0]?.requestCount ?? null;
      };

      const globalCount = await reserve('global', 'all', limits.globalPerHour);
      if (globalCount === null) throw new JevBudgetDenied('global');
      const subjectCount = await reserve(subject.type, subjectKey, subjectLimit);
      if (subjectCount === null) throw new JevBudgetDenied('subject');
      return { globalCount, subjectCount, subjectLimit };
    });

    const now = Date.now();
    if (now - lastJevBudgetCleanupAt >= 60 * 60_000) {
      lastJevBudgetCleanupAt = now;
      await query(`DELETE FROM jev_usage_buckets WHERE bucket_start < date_trunc('hour', now()) - interval '7 days'`)
        .catch(error => console.warn('[jev-budget] No se pudieron depurar buckets antiguos:', error));
    }
    return {
      allowed: true,
      globalCount: reserved.globalCount,
      subjectCount: reserved.subjectCount,
      globalRemaining: Math.max(0, limits.globalPerHour - reserved.globalCount),
      subjectRemaining: Math.max(0, reserved.subjectLimit - reserved.subjectCount),
    };
  } catch (error) {
    if (error instanceof JevBudgetDenied) {
      return { allowed: false, reason: error.reason, retryAfterSeconds: secondsUntilNextHour() };
    }
    throw error;
  }
}

type AiRuleDbRow = AiAnswerRule;

const aiRuleSelect = `SELECT ${aiAnswerRuleColumns}
  FROM ai_answer_rules r LEFT JOIN ai_answer_labels l ON l.id = r.label_id
  WHERE r.active = true AND (l.id IS NULL OR (l.active = true AND l.normalized_name <> '${AI_UNCLEAR_LABEL_NAME}'))
    AND btrim(COALESCE(l.answer, r.answer)) <> ''`;

async function loadActiveAiRules() {
  const result = await query<AiRuleDbRow>(`${aiRuleSelect} ORDER BY r.updated_at DESC LIMIT 200`);
  return result.rows;
}

export type AiLabelMatchRow = { id: string; name: string; answer: string; examples: string[] };
export async function loadActiveAiLabelExamples(): Promise<AiLabelMatchRow[]> {
  const result = await query<AiLabelMatchRow>(`SELECT l.id, l.name, l.answer,
    COALESCE(array_agg(DISTINCT examples.example) FILTER (WHERE examples.example IS NOT NULL), ARRAY[]::text[]) AS examples
    FROM ai_answer_labels l
    LEFT JOIN (
      SELECT r.label_id, r.question AS example FROM ai_answer_rules r WHERE r.active=true
      UNION ALL
      SELECT r.label_id, a.alias AS example FROM ai_answer_rules r JOIN ai_answer_rule_aliases a ON a.answer_rule_id=r.id WHERE r.active=true
    ) examples ON examples.label_id=l.id
    WHERE l.active=true AND l.normalized_name <> $1 AND btrim(l.answer)<>''
    GROUP BY l.id ORDER BY l.updated_at DESC LIMIT 200`, [AI_UNCLEAR_LABEL_NAME]);
  return result.rows;
}

/**
 * Resolves exact aliases first and then applies a conservative typo/order
 * tolerant matcher. The matched row is the intent, so every alias shares one
 * editable answer and one optional menu behavior.
 */
export async function findAiAnswerRule(question: string, options: { persistSemantic?: boolean } = {}): Promise<AiAnswerRule | null> {
  const normalizedQuestion = normalizeText(question);
  if (!normalizedQuestion) return null;
  const rules = await loadActiveAiRules();
  const exact = rules.find(rule => rule.normalizedQuestion === normalizedQuestion || rule.aliases.some(alias => normalizeText(alias) === normalizedQuestion));
  if (exact) return exact;
  const matched = matchIntent(normalizedQuestion, rules.map(rule => ({ ...rule, examples: [rule.question, ...rule.aliases] })));
  if (matched) return matched.intent;
  if (options.persistSemantic === false) return null;
  // If an operator already created a label but this exact wording is new,
  // classify it from the label name and its saved examples, then persist the
  // new wording as an alias. This makes the label assignment automatic while
  // keeping the confidence threshold conservative.
  const labels = await loadActiveAiLabelExamples();
  const suggested = matchIntent(normalizedQuestion, labels
    .filter(label => label.answer.trim())
    .map(label => ({ id: label.id, label: label.name, examples: [label.name, `hacen ${label.name}`, `${label.name} hacen`, ...label.examples], answer: label.answer })));
  if (!suggested || !suggested.intent.answer.trim()) return null;
  return saveAiAnswerRule({ question, answer: suggested.intent.answer, label: suggested.intent.label, labelId: suggested.intent.id, actor: 'ai-auto' });
}

export async function listAiAnswerRules(search?: string): Promise<AiAnswerRule[]> {
  const values: unknown[] = [];
  const where = ['1=1'];
  if (search?.trim()) { values.push(`%${search.trim()}%`); where.push(`(r.question ILIKE $${values.length} OR r.intent_label ILIKE $${values.length} OR r.answer ILIKE $${values.length} OR EXISTS (SELECT 1 FROM ai_answer_rule_aliases sa WHERE sa.answer_rule_id = r.id AND sa.alias ILIKE $${values.length}))`); }
  const result = await query<AiAnswerRule>(`SELECT ${aiAnswerRuleColumns} FROM ai_answer_rules r LEFT JOIN ai_answer_labels l ON l.id = r.label_id WHERE ${where.join(' AND ')} ORDER BY r.updated_at DESC LIMIT 200`, values);
  return result.rows;
}

function normalizeAiLabelName(name: string) {
  return normalizeText(name).replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

const aiAnswerLabelColumns = `l.id, l.name, l.normalized_name AS "normalizedName", l.answer, l.active,
  ARRAY(SELECT DISTINCT example FROM (
    SELECT r2.question AS example FROM ai_answer_rules r2 WHERE r2.label_id=l.id
    UNION SELECT a2.alias AS example FROM ai_answer_rules r3 JOIN ai_answer_rule_aliases a2 ON a2.answer_rule_id=r3.id WHERE r3.label_id=l.id
    UNION SELECT q2.question AS example FROM ai_query_logs q2 WHERE q2.suggested_label_id=l.id
  ) label_examples ORDER BY example) AS aliases,
  ARRAY(SELECT r4.id::text FROM ai_answer_rules r4 WHERE r4.label_id=l.id ORDER BY r4.id::text) AS "ruleIds",
  l.created_by AS "createdBy", l.updated_by AS "updatedBy", l.created_at AS "createdAt", l.updated_at AS "updatedAt"`;

export async function listAiAnswerLabels(search?: string): Promise<AiAnswerLabel[]> {
  const values: unknown[] = [AI_UNCLEAR_LABEL_NAME];
  const where = ['l.normalized_name <> $1'];
  if (search?.trim()) {
    values.push(`%${search.trim()}%`);
    where.push(`(l.name ILIKE $${values.length} OR l.answer ILIKE $${values.length}
      OR EXISTS (SELECT 1 FROM ai_answer_rules sr WHERE sr.label_id=l.id AND sr.question ILIKE $${values.length})
      OR EXISTS (SELECT 1 FROM ai_query_logs sq WHERE sq.suggested_label_id=l.id AND sq.question ILIKE $${values.length}))`);
  }
  const result = await query<AiAnswerLabel>(`SELECT ${aiAnswerLabelColumns}
    FROM ai_answer_labels l WHERE ${where.join(' AND ')} ORDER BY l.updated_at DESC LIMIT 200`, values);
  return result.rows;
}

export async function createAiAnswerLabel(input: { name: string; answer: string; active?: boolean; actor?: string | null }) {
  const name = input.name.trim();
  const answer = input.answer.trim();
  const normalizedName = normalizeAiLabelName(name);
  if (!name || !normalizedName || !answer) throw new Error('El nombre y la respuesta de la etiqueta son obligatorios.');
  if (normalizedName === AI_UNCLEAR_LABEL_NAME) throw new Error('Ese nombre está reservado para la categoría interna de ruido.');
  const result = await query<{ id: string }>(`INSERT INTO ai_answer_labels (name, normalized_name, answer, active, created_by, updated_by)
    VALUES ($1,$2,$3,$4,$5,$5)
    ON CONFLICT (normalized_name) DO UPDATE SET name=EXCLUDED.name,
      answer=CASE WHEN btrim(ai_answer_labels.answer)='' THEN EXCLUDED.answer ELSE ai_answer_labels.answer END,
      active=CASE WHEN btrim(ai_answer_labels.answer)='' THEN EXCLUDED.active ELSE ai_answer_labels.active END,
      updated_by=EXCLUDED.updated_by, updated_at=now()
    RETURNING id`, [name, normalizedName, answer, input.active ?? true, input.actor ?? null]);
  return readAiAnswerLabel(result.rows[0].id);
}

/** Creates a usable label without overwriting an existing operator answer. */
export async function ensureAiAnswerLabelDraft(nameInput: string, actor: string | null = 'ai-auto', initialAnswer = '', active = true) {
  const name = nameInput.trim();
  const normalizedName = normalizeAiLabelName(name);
  const answer = initialAnswer.trim();
  if (!name || !normalizedName || !answer) return null;
  const result = await query<{ id: string }>(`INSERT INTO ai_answer_labels (name, normalized_name, answer, active, created_by, updated_by)
    VALUES ($1,$2,$4,$5,$3,$3)
    ON CONFLICT (normalized_name) DO UPDATE SET
      answer=CASE WHEN btrim(ai_answer_labels.answer)='' AND btrim(EXCLUDED.answer)<>'' THEN EXCLUDED.answer ELSE ai_answer_labels.answer END,
      active=ai_answer_labels.active OR EXCLUDED.active,
      updated_at=now()
    RETURNING id`, [name, normalizedName, actor, answer, active]);
  return readAiAnswerLabel(result.rows[0].id);
}

export async function recordAiLabelCandidateObservation(input: {
  name: string;
  question: string;
  confidence: number;
  contactId?: string | null;
  providerMessageId?: string | null;
  observedAt?: Date;
}): Promise<AiLabelCandidateStats> {
  const normalizedName = normalizeAiLabelName(input.name);
  const displayName = input.name.trim();
  if (!normalizedName || !displayName || !input.question.trim()) {
    return { events30d: 0, contacts30d: 0, contacts7d: 0 };
  }
  return transaction(async client => {
    await client.query(`INSERT INTO ai_label_candidates (normalized_name, display_name, created_at, last_seen_at)
      VALUES ($1,$2,now(),$3)
      ON CONFLICT (normalized_name) DO UPDATE SET display_name=EXCLUDED.display_name,
        last_seen_at=GREATEST(ai_label_candidates.last_seen_at, EXCLUDED.last_seen_at)`,
    [normalizedName, displayName, input.observedAt ?? new Date()]);
    await client.query(`INSERT INTO ai_label_candidate_observations
      (normalized_name, contact_id, provider_message_id, question, confidence, observed_at)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL DO UPDATE SET
        normalized_name=EXCLUDED.normalized_name, question=EXCLUDED.question,
        confidence=EXCLUDED.confidence, observed_at=EXCLUDED.observed_at`,
    [normalizedName, input.contactId ?? null, input.providerMessageId ?? null, input.question.trim(), input.confidence, input.observedAt ?? new Date()]);
    const result = await client.query<{ events30d: string; contacts30d: string; contacts7d: string }>(`
      SELECT count(*) FILTER (WHERE observed_at >= now() - interval '30 days')::text AS "events30d",
        count(DISTINCT contact_id) FILTER (WHERE observed_at >= now() - interval '30 days')::text AS "contacts30d",
        count(DISTINCT contact_id) FILTER (WHERE observed_at >= now() - interval '7 days')::text AS "contacts7d"
      FROM ai_label_candidate_observations WHERE normalized_name=$1`, [normalizedName]);
    return {
      events30d: Number(result.rows[0]?.events30d ?? 0),
      contacts30d: Number(result.rows[0]?.contacts30d ?? 0),
      contacts7d: Number(result.rows[0]?.contacts7d ?? 0),
    };
  });
}

export type AiPreviewJob = { id: string; attempts: number; ai_query_log_id: string | null };

/** Preview jobs have a dedicated lane and no contact lock: they cannot delay WhatsApp replies. */
export async function claimAiPreviewJob(workerId: string) {
  return transaction(async client => {
    const result = await client.query<AiPreviewJob>(`
      WITH candidate AS (
        SELECT j.id
        FROM jobs j
        WHERE j.type='ai_preview' AND j.status IN ('queued', 'retrying') AND j.run_after <= now()
        ORDER BY j.created_at ASC, j.id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE jobs j
      SET status='processing', attempts=j.attempts+1, locked_at=now(), locked_by=$1, last_error=NULL
      FROM candidate
      WHERE j.id=candidate.id
      RETURNING j.id, j.attempts, j.ai_query_log_id`, [workerId]);
    return result.rows[0] ?? null;
  });
}

export async function promoteAiLabelCandidateQueries(candidateName: string, labelId: string, labelName: string) {
  const normalizedName = normalizeAiLabelName(candidateName);
  const result = await query(`UPDATE ai_query_logs q SET suggested_label_id=$2, suggested_label_name=$3,
    classification_method='frequency', classification_confidence=GREATEST(COALESCE(q.classification_confidence,0),0.8), updated_at=now()
    FROM ai_label_candidate_observations o
    WHERE o.provider_message_id=q.provider_message_id AND o.normalized_name=$1
      AND q.review_status='pending'`, [normalizedName, labelId, labelName]);
  return result.rowCount ?? 0;
}

export async function updateAiAnswerLabel(id: string, input: { name: string; answer: string; active?: boolean; actor?: string | null }) {
  const name = input.name.trim();
  const answer = input.answer.trim();
  const normalizedName = normalizeAiLabelName(name);
  if (!name || !normalizedName || !answer) throw new Error('El nombre y la respuesta de la etiqueta son obligatorios.');
  if (normalizedName === AI_UNCLEAR_LABEL_NAME) throw new Error('Ese nombre está reservado para la categoría interna de ruido.');
  const target = await query<{ normalizedName: string }>(
    'SELECT normalized_name AS "normalizedName" FROM ai_answer_labels WHERE id=$1', [id]);
  if (target.rows[0]?.normalizedName === AI_UNCLEAR_LABEL_NAME) {
    throw new Error('La categoría interna de ruido no se puede convertir en una etiqueta reutilizable.');
  }
  const result = await query<{ id: string }>(`UPDATE ai_answer_labels SET name=$2, normalized_name=$3, answer=$4, active=$5, updated_by=$6, updated_at=now() WHERE id=$1 RETURNING id`, [id, name, normalizedName, answer, input.active ?? true, input.actor ?? null]);
  if (!result.rows[0]) return null;
  await query(`UPDATE ai_answer_rules SET intent_label=$2, answer=$3, active=$4, updated_by=$5, updated_at=now() WHERE label_id=$1`, [id, name, answer, input.active ?? true, input.actor ?? null]);
  return readAiAnswerLabel(id);
}

export async function deleteAiAnswerLabel(id: string) {
  const target = await query<{ normalizedName: string }>(
    'SELECT normalized_name AS "normalizedName" FROM ai_answer_labels WHERE id=$1', [id]);
  if (!target.rows[0]) return;
  if (target.rows[0].normalizedName === AI_UNCLEAR_LABEL_NAME) {
    throw new Error('La etiqueta pregunta-no-entendible es necesaria como respaldo y no se puede eliminar.');
  }
  await transaction(async client => {
    await client.query(`UPDATE ai_answer_rules SET active=false, label_id=NULL, intent_label=NULL, updated_at=now() WHERE label_id=$1`, [id]);
    await client.query(`UPDATE ai_query_logs SET suggested_label_id=NULL, suggested_label_name=NULL,
      classification_method='needs-review', classification_confidence=NULL, updated_at=now()
      WHERE suggested_label_id=$1 AND review_status='pending'`, [id]);
    await client.query(`DELETE FROM ai_answer_labels WHERE id=$1`, [id]);
  });
}

export async function assignAiAnswerRuleLabel(ruleId: string, labelId: string, actor: string | null) {
  const label = await query<{ name: string; normalizedName: string; answer: string; active: boolean }>('SELECT name, normalized_name AS "normalizedName", answer, active FROM ai_answer_labels WHERE id=$1', [labelId]);
  if (!label.rows[0]) return null;
  if (label.rows[0].normalizedName === AI_UNCLEAR_LABEL_NAME) throw new Error('La categoría de ruido no es una respuesta reutilizable.');
  const result = await query<{ id: string }>(`UPDATE ai_answer_rules SET label_id=$2, intent_label=$3, answer=$4, active=$5, updated_by=$6, updated_at=now() WHERE id=$1 RETURNING id`, [ruleId, labelId, label.rows[0].name, label.rows[0].answer, label.rows[0].active, actor]);
  return result.rows[0] ? readAiRule(ruleId) : null;
}

async function readAiAnswerLabel(id: string) {
  const result = await query<AiAnswerLabel>(`SELECT ${aiAnswerLabelColumns}
    FROM ai_answer_labels l WHERE l.id=$1`, [id]);
  return result.rows[0] ?? null;
}

export async function saveAiAnswerRule(input: { question: string; answer: string; label?: string | null; labelId?: string | null; aliases?: string[]; active?: boolean; actor?: string | null }) {
  const question = input.question.trim();
  const answer = input.answer.trim();
  const normalizedQuestion = normalizeText(question);
  if (!question || !normalizedQuestion || !answer) throw new Error('La pregunta y la respuesta son obligatorias.');
  const label = input.label?.trim() || null;
  if (label && normalizeAiLabelName(label) === AI_UNCLEAR_LABEL_NAME) {
    throw new Error('La categoría de ruido no es una respuesta reutilizable.');
  }
  let canonicalAnswer = answer;
  let selectedLabelId = input.labelId ?? null;
  let selectedLabelName = label;
  if (selectedLabelId) {
    const selected = await query<{ name: string; normalizedName: string; answer: string }>(
      'SELECT name, normalized_name AS "normalizedName", answer FROM ai_answer_labels WHERE id=$1', [selectedLabelId]);
    if (!selected.rows[0]) throw new Error('La etiqueta seleccionada no existe.');
    if (selected.rows[0].normalizedName === AI_UNCLEAR_LABEL_NAME) {
      throw new Error('La categoría de ruido no es una respuesta reutilizable.');
    }
    selectedLabelName = selected.rows[0].name;
    canonicalAnswer = selected.rows[0].answer;
  } else if (label) {
    const existingLabel = await query<{ id: string; name: string; answer: string }>('SELECT id, name, answer FROM ai_answer_labels WHERE normalized_name=$1 LIMIT 1', [normalizeAiLabelName(label)]);
    if (existingLabel.rows[0]) {
      selectedLabelId = existingLabel.rows[0].id;
      selectedLabelName = existingLabel.rows[0].name;
      canonicalAnswer = existingLabel.rows[0].answer || answer;
    } else {
      const created = await createAiAnswerLabel({ name: label, answer, active: input.active, actor: input.actor });
      selectedLabelId = created?.id ?? null;
      selectedLabelName = created?.name ?? label;
    }
  }
  const result = await query<{ id: string }>(`
    INSERT INTO ai_answer_rules (question, normalized_question, intent_label, label_id, answer, active, manual, created_by, updated_by)
    VALUES ($1, $2, $3, $4, $5, $6, true, $7, $7)
    ON CONFLICT (normalized_question) DO UPDATE SET question = EXCLUDED.question,
      intent_label = COALESCE(EXCLUDED.intent_label, ai_answer_rules.intent_label),
      label_id = COALESCE(EXCLUDED.label_id, ai_answer_rules.label_id),
      answer = EXCLUDED.answer, active = EXCLUDED.active, manual = true,
      updated_by = EXCLUDED.updated_by, updated_at = now()
    RETURNING id`, [question, normalizedQuestion, selectedLabelName, selectedLabelId, canonicalAnswer, input.active ?? true, input.actor ?? null]);
  const id = result.rows[0].id;
  if (selectedLabelId) await query(`UPDATE ai_answer_rules SET label_id=$2, intent_label=$3, answer=$4 WHERE id=$1`, [id, selectedLabelId, selectedLabelName, canonicalAnswer]);
  await addAiRuleAliases(id, [question, ...(input.aliases ?? [])], input.actor ?? null);
  return readAiRule(id);
}

export async function updateAiAnswerRule(id: string, input: { question: string; answer: string; label?: string | null; labelId?: string | null; aliases?: string[]; active?: boolean; actor?: string | null }) {
  const question = input.question.trim();
  const answer = input.answer.trim();
  const normalizedQuestion = normalizeText(question);
  if (!question || !normalizedQuestion || !answer) throw new Error('La pregunta y la respuesta son obligatorias.');
  let labelName = input.label?.trim() || null;
  if (labelName && normalizeAiLabelName(labelName) === AI_UNCLEAR_LABEL_NAME) {
    throw new Error('La categoría de ruido no es una respuesta reutilizable.');
  }
  if (input.labelId) {
    const labelResult = await query<{ name: string; normalizedName: string }>(
      'SELECT name, normalized_name AS "normalizedName" FROM ai_answer_labels WHERE id=$1', [input.labelId]);
    if (!labelResult.rows[0]) throw new Error('La etiqueta seleccionada no existe.');
    if (labelResult.rows[0].normalizedName === AI_UNCLEAR_LABEL_NAME) {
      throw new Error('La categoría de ruido no es una respuesta reutilizable.');
    }
    labelName = labelResult.rows[0].name;
    await query(`UPDATE ai_answer_labels SET answer=$2, active=$3, updated_by=$4, updated_at=now() WHERE id=$1`, [input.labelId, answer, input.active ?? true, input.actor ?? null]);
  } else if (labelName) {
    const labelResult = await query<{ id: string }>('SELECT id FROM ai_answer_labels WHERE normalized_name=$1 LIMIT 1', [normalizeAiLabelName(labelName)]);
    if (labelResult.rows[0]) {
      await query(`UPDATE ai_answer_labels SET name=$2, answer=$3, active=$4, updated_by=$5, updated_at=now() WHERE id=$1`, [labelResult.rows[0].id, labelName, answer, input.active ?? true, input.actor ?? null]);
      input = { ...input, labelId: labelResult.rows[0].id };
    } else {
      const created = await createAiAnswerLabel({ name: labelName, answer, active: input.active, actor: input.actor });
      input = { ...input, labelId: created?.id ?? null };
    }
  }
  const result = await query<{ id: string }>(`UPDATE ai_answer_rules SET question = $2, normalized_question = $3, intent_label = $4, label_id = $5, answer = $6,
    active = $7, manual = true, updated_by = $8, updated_at = now() WHERE id = $1 RETURNING id`,
    [id, question, normalizedQuestion, labelName, input.labelId ?? null, answer, input.active ?? true, input.actor ?? null]);
  if (!result.rows[0]) return null;
  if (input.labelId) {
    await query(`UPDATE ai_answer_rules SET intent_label=$2, answer=$3, active=$4, updated_by=$5, updated_at=now()
      WHERE label_id=$1 AND id<>$6`, [input.labelId, labelName, answer, input.active ?? true, input.actor ?? null, id]);
  }
  await addAiRuleAliases(id, [question, ...(input.aliases ?? [])], input.actor ?? null);
  return readAiRule(id);
}

async function readAiRule(id: string) {
  const result = await query<AiAnswerRule>(`SELECT ${aiAnswerRuleColumns} FROM ai_answer_rules r LEFT JOIN ai_answer_labels l ON l.id = r.label_id WHERE r.id = $1`, [id]);
  return result.rows[0] ?? null;
}

async function addAiRuleAliases(ruleId: string, aliases: string[], actor: string | null) {
  for (const alias of aliases) {
    const text = alias.trim();
    const normalized = normalizeText(text);
    if (!text || !normalized) continue;
    await query(`INSERT INTO ai_answer_rule_aliases (answer_rule_id, alias, normalized_alias, created_by)
      VALUES ($1, $2, $3, $4) ON CONFLICT (normalized_alias) DO UPDATE SET answer_rule_id = EXCLUDED.answer_rule_id`, [ruleId, text, normalized, actor]);
  }
}

export async function deleteAiAnswerRule(id: string) {
  await query('DELETE FROM ai_answer_rules WHERE id = $1', [id]);
}

export async function recordAiQuery(input: {
  contactId?: string | null; incomingMessageId?: string | null; providerMessageId?: string | null; question: string; answer?: string;
  outcome: string; source?: string; aiEnabled?: boolean; matchedAnswerRuleId?: string | null; matchedAnswerLabelId?: string | null; model?: string | null;
  suggestedLabelId?: string | null; suggestedLabelName?: string | null; classificationMethod?: string | null; classificationConfidence?: number | null;
  reviewStatus?: 'pending' | 'resolved' | 'ignored'; reviewedBy?: string | null;
  previewAnswer?: string | null; previewOutcome?: string | null; previewSource?: string | null; previewModel?: string | null;
  previewTokens?: number | null; previewElapsedMs?: number | null; previewErrorCode?: string | null; previewGeneratedAt?: Date | string | null;
  tokens?: number; elapsedMs?: number; errorCode?: string | null;
}) {
  const source = input.source ?? 'production';
  const reviewStatus = input.reviewStatus ?? (source === 'manual' ? 'ignored'
    : ['answered', 'clarify', 'handoff', 'unavailable', 'edited', 'silence', 'paused'].includes(input.outcome) ? 'resolved' : 'pending');
  let suggestedLabelId = input.suggestedLabelId ?? null;
  let suggestedLabelName = input.suggestedLabelName?.trim() || null;
  let classificationMethod = input.classificationMethod ?? null;
  let classificationConfidence = input.classificationConfidence ?? null;
  const hasPreview = input.previewAnswer !== undefined || input.previewOutcome !== undefined || input.previewSource !== undefined;
  const previewGeneratedAt = input.previewGeneratedAt ?? (hasPreview ? new Date() : null);
  const values = [input.contactId ?? null, input.incomingMessageId ?? null, input.providerMessageId ?? null, input.question.trim(), input.answer ?? '',
    input.outcome, source, input.aiEnabled ?? false, input.matchedAnswerRuleId ?? null, input.matchedAnswerLabelId ?? null,
    suggestedLabelId, suggestedLabelName, classificationMethod, classificationConfidence,
    reviewStatus, reviewStatus === 'pending' ? null : new Date(), input.reviewedBy ?? null, input.model ?? null,
    input.tokens ?? 0, input.elapsedMs ?? 0, input.errorCode ?? null,
    input.previewAnswer ?? null, input.previewOutcome ?? null, input.previewSource ?? null, input.previewModel ?? null,
    input.previewTokens ?? null, input.previewElapsedMs ?? null, input.previewErrorCode ?? null, previewGeneratedAt];
  const result = await query<AiQueryLog>(`INSERT INTO ai_query_logs
    (contact_id, incoming_message_id, provider_message_id, question, answer, outcome, source, ai_enabled, matched_answer_rule_id, matched_label_id,
     suggested_label_id, suggested_label_name, classification_method, classification_confidence, review_status, reviewed_at, reviewed_by, model, tokens, elapsed_ms, error_code,
     preview_answer, preview_outcome, preview_source, preview_model, preview_tokens, preview_elapsed_ms, preview_error_code, preview_generated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
      $22, $23, $24, $25, $26, $27, $28, $29)
    ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL DO UPDATE SET
      answer = EXCLUDED.answer, outcome = EXCLUDED.outcome, source = EXCLUDED.source, ai_enabled = EXCLUDED.ai_enabled,
      matched_answer_rule_id = EXCLUDED.matched_answer_rule_id, matched_label_id = EXCLUDED.matched_label_id,
      suggested_label_id = EXCLUDED.suggested_label_id, suggested_label_name = EXCLUDED.suggested_label_name,
      classification_method = EXCLUDED.classification_method, classification_confidence = EXCLUDED.classification_confidence,
      review_status = EXCLUDED.review_status, reviewed_at = EXCLUDED.reviewed_at, reviewed_by = EXCLUDED.reviewed_by,
      model = EXCLUDED.model, tokens = EXCLUDED.tokens, elapsed_ms = EXCLUDED.elapsed_ms, error_code = EXCLUDED.error_code,
      preview_answer = CASE WHEN EXCLUDED.preview_generated_at IS NOT NULL THEN EXCLUDED.preview_answer ELSE ai_query_logs.preview_answer END,
      preview_outcome = CASE WHEN EXCLUDED.preview_generated_at IS NOT NULL THEN EXCLUDED.preview_outcome ELSE ai_query_logs.preview_outcome END,
      preview_source = CASE WHEN EXCLUDED.preview_generated_at IS NOT NULL THEN EXCLUDED.preview_source ELSE ai_query_logs.preview_source END,
      preview_model = CASE WHEN EXCLUDED.preview_generated_at IS NOT NULL THEN EXCLUDED.preview_model ELSE ai_query_logs.preview_model END,
      preview_tokens = CASE WHEN EXCLUDED.preview_generated_at IS NOT NULL THEN EXCLUDED.preview_tokens ELSE ai_query_logs.preview_tokens END,
      preview_elapsed_ms = CASE WHEN EXCLUDED.preview_generated_at IS NOT NULL THEN EXCLUDED.preview_elapsed_ms ELSE ai_query_logs.preview_elapsed_ms END,
      preview_error_code = CASE WHEN EXCLUDED.preview_generated_at IS NOT NULL THEN EXCLUDED.preview_error_code ELSE ai_query_logs.preview_error_code END,
      preview_generated_at = COALESCE(EXCLUDED.preview_generated_at, ai_query_logs.preview_generated_at), updated_at = now()
    RETURNING id, contact_id AS "contactId", question, answer, outcome, source, ai_enabled AS "aiEnabled", matched_answer_rule_id AS "matchedAnswerRuleId", matched_label_id AS "matchedAnswerLabelId",
      suggested_label_id AS "suggestedLabelId", suggested_label_name AS "suggestedLabelName", classification_method AS "classificationMethod", classification_confidence AS "classificationConfidence",
      review_status AS "reviewStatus", reviewed_at AS "reviewedAt", reviewed_by AS "reviewedBy", NULL::text AS label,
      model, tokens, elapsed_ms AS "elapsedMs", error_code AS "errorCode",
      preview_answer AS "previewAnswer", preview_outcome AS "previewOutcome", preview_source AS "previewSource",
      preview_model AS "previewModel", preview_tokens AS "previewTokens", preview_elapsed_ms AS "previewElapsedMs",
      preview_error_code AS "previewErrorCode", preview_generated_at AS "previewGeneratedAt",
      created_at AS "createdAt", updated_at AS "updatedAt"`, values);
  return result.rows[0];
}

export type AiQueryPreviewContext = {
  id: string;
  question: string;
  contactId: string | null;
  providerMessageId: string | null;
  createdAt: string;
  previewGeneratedAt: string | null;
  generationId: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
};

export type AiQueryPreviewClaim =
  | { status: 'claimed'; context: AiQueryPreviewContext }
  | { status: 'skipped' | 'missing'; context: null };

export async function claimAiQueryPreviewGeneration(id: string, force = false): Promise<AiQueryPreviewClaim> {
  const result = await query<Omit<AiQueryPreviewContext, 'history'>>(`UPDATE ai_query_logs SET
      preview_generation_id=gen_random_uuid(), updated_at=now()
    WHERE id=$1 AND ($2::boolean OR preview_generated_at IS NULL)
    RETURNING id, question,
      contact_id AS "contactId", provider_message_id AS "providerMessageId",
      created_at AS "createdAt", preview_generated_at AS "previewGeneratedAt",
      preview_generation_id AS "generationId"`, [id, force]);
  const item = result.rows[0];
  if (!item) {
    const existing = await query<{ exists: boolean }>('SELECT EXISTS(SELECT 1 FROM ai_query_logs WHERE id=$1) AS exists', [id]);
    return { status: existing.rows[0]?.exists ? 'skipped' : 'missing', context: null };
  }
  if (!item.contactId) return { status: 'claimed', context: { ...item, history: [] } };

  const messages = await query<{ direction: 'incoming' | 'outgoing'; body: string }>(`
    SELECT direction, body
    FROM messages
    WHERE contact_id=$1 AND message_type='text' AND btrim(body)<>'' AND created_at <= $2::timestamptz
      AND ($3::text IS NULL OR provider_message_id IS DISTINCT FROM $3)
      AND ($3::text IS NULL OR COALESCE(outbound_key, '') NOT LIKE ('event:' || $3 || ':%'))
    ORDER BY created_at DESC, id DESC
    LIMIT 10`, [item.contactId, item.createdAt, item.providerMessageId]);
  const history = messages.rows.reverse().map(message => ({
    role: message.direction === 'incoming' ? 'user' as const : 'assistant' as const,
    content: message.body,
  }));
  return { status: 'claimed', context: { ...item, history } };
}

export async function updateAiQueryPreview(id: string, input: {
  generationId: string;
  answer: string;
  outcome: string;
  source: string;
  model?: string | null;
  tokens?: number | null;
  elapsedMs?: number | null;
  errorCode?: string | null;
  suggestedLabelId?: string | null;
  suggestedLabelName?: string | null;
  classificationMethod?: string | null;
  classificationConfidence?: number | null;
  updateSuggestion?: boolean;
}) {
  const result = await query<{ id: string }>(`UPDATE ai_query_logs SET
      preview_answer=$2, preview_outcome=$3, preview_source=$4, preview_model=$5,
      preview_tokens=$6, preview_elapsed_ms=$7, preview_error_code=$8, preview_generated_at=now(),
      suggested_label_id=CASE WHEN review_status='pending' AND $13::boolean THEN $9 ELSE suggested_label_id END,
      suggested_label_name=CASE WHEN review_status='pending' AND $13::boolean THEN $10 ELSE suggested_label_name END,
      classification_method=CASE WHEN review_status='pending' AND $13::boolean THEN $11 ELSE classification_method END,
      classification_confidence=CASE WHEN review_status='pending' AND $13::boolean THEN $12 ELSE classification_confidence END,
      preview_generation_id=NULL, updated_at=now()
    WHERE id=$1 AND preview_generation_id=$14::uuid RETURNING id`, [id, input.answer, input.outcome, input.source, input.model ?? null,
    input.tokens ?? null, input.elapsedMs ?? null, input.errorCode ?? null,
    input.suggestedLabelId ?? null, input.suggestedLabelName?.trim() || null,
    input.classificationMethod ?? null, input.classificationConfidence ?? null,
    input.updateSuggestion ?? true, input.generationId]);
  if (!result.rows[0]) return null;
  const row = await query<AiQueryLog>(`SELECT ${aiQueryColumns} FROM ai_query_logs q
    LEFT JOIN contacts c ON c.id=q.contact_id LEFT JOIN ai_answer_rules r ON r.id=q.matched_answer_rule_id
    LEFT JOIN ai_answer_labels al ON al.id=q.matched_label_id LEFT JOIN ai_answer_labels sl ON sl.id=q.suggested_label_id
    WHERE q.id=$1`, [id]);
  return row.rows[0] ?? null;
}

export type AiQueryPreviewCursor = { createdAt: string; id: string };

export async function listAiQueryPreviewCandidates(input: {
  force?: boolean;
  limit?: number;
  after?: AiQueryPreviewCursor | null;
} = {}) {
  const limit = Math.min(5000, Math.max(1, input.limit ?? 1000));
  const result = await query<AiQueryPreviewCursor>(`SELECT id, created_at::text AS "createdAt" FROM ai_query_logs
    WHERE source='production' AND ($1::boolean OR preview_generated_at IS NULL)
      AND ($2::timestamptz IS NULL OR (created_at, id) > ($2::timestamptz, $3::uuid))
    ORDER BY created_at ASC, id ASC LIMIT $4`, [input.force ?? false, input.after?.createdAt ?? null,
    input.after?.id ?? null, limit]);
  return result.rows;
}

export async function enqueueAiQueryPreview(aiQueryLogId: string) {
  const maxActivePerContact = Math.max(1, nonNegativeInteger(process.env.AI_PREVIEW_MAX_ACTIVE_PER_CONTACT, 3));
  const result = await query<{ id: string }>(`INSERT INTO jobs (type, ai_query_log_id)
    SELECT 'ai_preview', q.id
    FROM ai_query_logs q
    WHERE q.id=$1
      AND (q.contact_id IS NULL OR (
        SELECT count(*) FROM jobs active_job
        JOIN ai_query_logs active_query ON active_query.id=active_job.ai_query_log_id
        WHERE active_query.contact_id=q.contact_id
          AND active_job.type='ai_preview'
          AND active_job.status IN ('queued', 'retrying', 'processing')
      ) < $2)
    ON CONFLICT DO NOTHING RETURNING id`, [aiQueryLogId, maxActivePerContact]);
  return result.rows[0] ?? null;
}

export type AiQueryView = 'attention' | 'answered' | 'noise' | 'errors' | 'tests' | 'all';
export async function listAiQueryLogs(input: { page?: number; limit?: number; status?: string; source?: string; q?: string; reviewStatus?: string; view?: AiQueryView } = {}) {
  const page = Math.max(1, input.page ?? 1);
  const limit = Math.min(100, Math.max(1, input.limit ?? 40));
  const values: unknown[] = [];
  const where = ['1=1'];
  if (input.view === 'attention') where.push(`q.source <> 'manual' AND q.review_status = 'pending'`);
  if (input.view === 'answered') where.push(`q.source <> 'manual' AND q.review_status = 'resolved' AND q.outcome <> 'unavailable'`);
  if (input.view === 'noise') where.push(`q.source <> 'manual' AND q.review_status = 'ignored'`);
  if (input.view === 'errors') where.push(`q.source <> 'manual' AND q.outcome = 'unavailable'`);
  if (input.view === 'tests') where.push(`q.source = 'manual'`);
  if (input.status?.trim()) { values.push(input.status.trim()); where.push(`q.outcome = $${values.length}`); }
  if (input.source?.trim()) { values.push(input.source.trim()); where.push(`q.source = $${values.length}`); }
  if (input.reviewStatus?.trim()) { values.push(input.reviewStatus.trim()); where.push(`q.review_status = $${values.length}`); }
  if (input.q?.trim()) { values.push(`%${input.q.trim()}%`); where.push(`(q.question ILIKE $${values.length} OR q.answer ILIKE $${values.length} OR q.preview_answer ILIKE $${values.length} OR q.suggested_label_name ILIKE $${values.length} OR c.phone ILIKE $${values.length} OR c.name ILIKE $${values.length} OR c.public_name ILIKE $${values.length})`); }
  const countResult = await query<{ count: string }>(`SELECT count(*)::text AS count FROM ai_query_logs q LEFT JOIN contacts c ON c.id = q.contact_id WHERE ${where.join(' AND ')}`, values);
  const offset = (page - 1) * limit;
  const rows = await query<AiQueryLog>(`SELECT ${aiQueryColumns} FROM ai_query_logs q LEFT JOIN contacts c ON c.id = q.contact_id LEFT JOIN ai_answer_rules r ON r.id = q.matched_answer_rule_id LEFT JOIN ai_answer_labels al ON al.id = q.matched_label_id LEFT JOIN ai_answer_labels sl ON sl.id = q.suggested_label_id WHERE ${where.join(' AND ')} ORDER BY q.created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset]);
  return { items: rows.rows, total: Number(countResult.rows[0]?.count ?? 0), page, limit };
}

export async function resolveAiQuery(id: string, input: {
  labelId?: string | null;
  labelName?: string | null;
  answer?: string | null;
}, actor: string | null) {
  const resolved = await transaction(async client => {
    const existing = await client.query<{ question: string; contactId: string | null; suggestedLabelId: string | null; suggestedLabelName: string | null }>(`
      SELECT question, contact_id AS "contactId", suggested_label_id AS "suggestedLabelId", suggested_label_name AS "suggestedLabelName"
      FROM ai_query_logs WHERE id=$1 FOR UPDATE`, [id]);
    const queryRow = existing.rows[0];
    if (!queryRow) return null;

    let labelId = input.labelId ?? queryRow.suggestedLabelId;
    let labelName = input.labelName?.trim() || queryRow.suggestedLabelName || '';
    const suppliedAnswer = input.answer?.trim();
    let label: { id: string; name: string; normalizedName: string; answer: string } | undefined;
    if (labelId) {
      label = (await client.query<{ id: string; name: string; normalizedName: string; answer: string }>(
        'SELECT id, name, normalized_name AS "normalizedName", answer FROM ai_answer_labels WHERE id=$1 FOR UPDATE', [labelId])).rows[0];
      if (!label) throw new Error('La etiqueta seleccionada no existe.');
      if (label.normalizedName === AI_UNCLEAR_LABEL_NAME) throw new Error('Los mensajes sin sentido no pueden convertirse en una respuesta reutilizable.');
    } else {
      const normalizedName = normalizeAiLabelName(labelName);
      if (!labelName || !normalizedName) throw new Error('Elegí una etiqueta o creá una nueva.');
      if (!suppliedAnswer) throw new Error('Escribí la respuesta que compartirá esta etiqueta.');
      if (normalizedName === AI_UNCLEAR_LABEL_NAME) throw new Error('Elegí un tema concreto para crear una respuesta reutilizable.');
      label = (await client.query<{ id: string; name: string; normalizedName: string; answer: string }>(`
        INSERT INTO ai_answer_labels (name, normalized_name, answer, active, created_by, updated_by)
        VALUES ($1,$2,$3,true,$4,$4)
        ON CONFLICT (normalized_name) DO UPDATE SET updated_at=now()
        RETURNING id, name, normalized_name AS "normalizedName", answer`, [labelName, normalizedName, suppliedAnswer, actor])).rows[0];
      labelId = label.id;
    }

    labelName = label.name;
    const canonicalAnswer = suppliedAnswer || label.answer.trim();
    if (!canonicalAnswer) throw new Error('Escribí la respuesta que compartirá esta etiqueta.');
    if (suppliedAnswer) {
      await client.query(`UPDATE ai_answer_labels SET answer=$2, active=true, updated_by=$3, updated_at=now() WHERE id=$1`, [labelId, canonicalAnswer, actor]);
      await client.query(`UPDATE ai_answer_rules SET answer=$2, active=true, updated_by=$3, updated_at=now() WHERE label_id=$1`, [labelId, canonicalAnswer, actor]);
    }

    const sameSuggestedGroup = queryRow.suggestedLabelId === labelId
      && label.normalizedName !== AI_UNCLEAR_LABEL_NAME;
    const pending = await client.query<{ id: string; question: string }>(`
      SELECT id, question FROM ai_query_logs
      WHERE review_status='pending' AND (id=$1 OR ($2::boolean AND suggested_label_id=$3))
      ORDER BY created_at ASC FOR UPDATE`, [id, sameSuggestedGroup, labelId]);
    const rootQuestion = queryRow.question.trim();
    const normalizedQuestion = normalizeText(rootQuestion);
    const rule = await client.query<{ id: string }>(`
      INSERT INTO ai_answer_rules (question, normalized_question, intent_label, label_id, answer, active, manual, created_by, updated_by)
      VALUES ($1,$2,$3,$4,$5,true,true,$6,$6)
      ON CONFLICT (normalized_question) DO UPDATE SET question=EXCLUDED.question, intent_label=EXCLUDED.intent_label,
        label_id=EXCLUDED.label_id, answer=EXCLUDED.answer, active=true, manual=true, updated_by=EXCLUDED.updated_by, updated_at=now()
      RETURNING id`, [rootQuestion, normalizedQuestion, labelName, labelId, canonicalAnswer, actor]);
    const ruleId = rule.rows[0].id;
    for (const item of pending.rows) {
      const normalizedAlias = normalizeText(item.question);
      if (!normalizedAlias) continue;
      await client.query(`INSERT INTO ai_answer_rule_aliases (answer_rule_id, alias, normalized_alias, created_by)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (normalized_alias) DO UPDATE SET answer_rule_id=EXCLUDED.answer_rule_id, alias=EXCLUDED.alias`,
      [ruleId, item.question.trim(), normalizedAlias, actor]);
    }
    const ids = pending.rows.map(item => item.id);
    await client.query(`UPDATE ai_query_logs SET answer=$2, outcome='edited', review_status='resolved', reviewed_at=now(), reviewed_by=$3,
      matched_answer_rule_id=$4, matched_label_id=$5, suggested_label_id=$5, suggested_label_name=$6, updated_at=now()
      WHERE id = ANY($1::uuid[])`, [ids, canonicalAnswer, actor, ruleId, labelId, labelName]);
    return { contactId: queryRow.contactId, labelId, ruleId, count: ids.length };
  });
  if (!resolved) return null;
  await audit(actor ?? 'admin', 'ai_query_resolved', resolved.contactId ?? undefined, undefined,
    { queryId: id, labelId: resolved.labelId, groupedQueries: resolved.count });
  const result = await query<AiQueryLog>(`SELECT ${aiQueryColumns} FROM ai_query_logs q
    LEFT JOIN contacts c ON c.id=q.contact_id LEFT JOIN ai_answer_rules r ON r.id=q.matched_answer_rule_id
    LEFT JOIN ai_answer_labels al ON al.id=q.matched_label_id LEFT JOIN ai_answer_labels sl ON sl.id=q.suggested_label_id
    WHERE q.id=$1`, [id]);
  return result.rows[0] ?? null;
}

/** Backwards-compatible endpoint used by older admin clients. */
export async function updateAiQueryAnswer(id: string, answer: string, actor: string | null, label?: string | null) {
  return resolveAiQuery(id, { labelName: label, answer }, actor);
}

export async function markAiQueryAsNoise(id: string, actor: string | null) {
  const fallback = await ensureAiAnswerLabelDraft(AI_UNCLEAR_LABEL_NAME, 'ai-system', AI_UNCLEAR_LABEL_ANSWER);
  if (!fallback) throw new Error('No se pudo preparar la categoría de ruido.');
  const result = await query<AiQueryLog>(`UPDATE ai_query_logs SET
      review_status='ignored', reviewed_at=now(), reviewed_by=$3,
      suggested_label_id=$2, suggested_label_name=$4,
      classification_method='unintelligible', classification_confidence=1, updated_at=now()
    WHERE id=$1
    RETURNING id, contact_id AS "contactId", question, answer, outcome, source, ai_enabled AS "aiEnabled",
      matched_answer_rule_id AS "matchedAnswerRuleId", matched_label_id AS "matchedAnswerLabelId",
      suggested_label_id AS "suggestedLabelId", suggested_label_name AS "suggestedLabelName",
      classification_method AS "classificationMethod", classification_confidence AS "classificationConfidence",
      review_status AS "reviewStatus", reviewed_at AS "reviewedAt", reviewed_by AS "reviewedBy",
      NULL::text AS label, model, tokens, elapsed_ms AS "elapsedMs", error_code AS "errorCode",
      created_at AS "createdAt", updated_at AS "updatedAt"`, [id, fallback.id, actor, fallback.name]);
  const item = result.rows[0] ?? null;
  if (item) await audit(actor ?? 'admin', 'ai_query_marked_noise', item.contactId ?? undefined, undefined, { queryId: id });
  return item;
}

export async function reopenAiQuery(id: string, actor: string | null) {
  const result = await query<AiQueryLog>(`UPDATE ai_query_logs SET
      review_status='pending', reviewed_at=NULL, reviewed_by=NULL,
      suggested_label_id=NULL, suggested_label_name=NULL,
      classification_method='manual-review', classification_confidence=NULL, updated_at=now()
    WHERE id=$1
    RETURNING id, contact_id AS "contactId", question, answer, outcome, source, ai_enabled AS "aiEnabled",
      matched_answer_rule_id AS "matchedAnswerRuleId", matched_label_id AS "matchedAnswerLabelId",
      suggested_label_id AS "suggestedLabelId", suggested_label_name AS "suggestedLabelName",
      classification_method AS "classificationMethod", classification_confidence AS "classificationConfidence",
      review_status AS "reviewStatus", reviewed_at AS "reviewedAt", reviewed_by AS "reviewedBy",
      NULL::text AS label, model, tokens, elapsed_ms AS "elapsedMs", error_code AS "errorCode",
      created_at AS "createdAt", updated_at AS "updatedAt"`, [id]);
  const item = result.rows[0] ?? null;
  if (item) await audit(actor ?? 'admin', 'ai_query_reopened', item.contactId ?? undefined, undefined, { queryId: id });
  return item;
}
