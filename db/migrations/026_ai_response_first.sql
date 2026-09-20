-- Customer response and operator learning are separate concerns. A meaningful
-- pending question may have no reusable label yet, so labels can never gate a
-- reply or be required by a database constraint.
ALTER TABLE ai_query_logs
  DROP CONSTRAINT IF EXISTS ai_query_logs_pending_label_required;

INSERT INTO ai_answer_labels (name, normalized_name, answer, active, created_by, updated_by)
VALUES (
  'pregunta-no-entendible',
  'pregunta-no-entendible',
  E'No llegué a reconocer una consulta en ese mensaje. ¿Podés escribirla de otra forma?\n\nSi preferís, podés hablar con Mauricio, nuestro asesor comercial: https://wa.me/5493517565641',
  true,
  'migration-026',
  'migration-026'
)
ON CONFLICT (normalized_name) DO UPDATE SET
  answer = CASE
    WHEN COALESCE(ai_answer_labels.updated_by, ai_answer_labels.created_by, '')
      IN ('', 'ai-auto', 'ai-auto-frequency', 'ai-system', 'migration-024', 'migration-025')
    THEN EXCLUDED.answer
    ELSE ai_answer_labels.answer
  END,
  active = true,
  updated_by = CASE
    WHEN COALESCE(ai_answer_labels.updated_by, ai_answer_labels.created_by, '')
      IN ('', 'ai-auto', 'ai-auto-frequency', 'ai-system', 'migration-024', 'migration-025')
    THEN 'migration-026'
    ELSE ai_answer_labels.updated_by
  END,
  updated_at = now();

-- Preserve the fallback only for conservative, reproducible garbage patterns.
-- A typo, an unfamiliar business question or a coherent off-topic sentence is
-- intentionally not included here.
WITH fallback AS (
  SELECT id, name FROM ai_answer_labels WHERE normalized_name='pregunta-no-entendible'
)
UPDATE ai_query_logs q
SET suggested_label_id=fallback.id,
    suggested_label_name=fallback.name,
    classification_method='unintelligible',
    classification_confidence=GREATEST(COALESCE(q.classification_confidence, 0), 0.96),
    review_status='ignored',
    reviewed_at=COALESCE(q.reviewed_at, now()),
    reviewed_by=COALESCE(q.reviewed_by, 'migration-026'),
    updated_at=now()
FROM fallback
WHERE (
    btrim(q.question) ~ '^[[:punct:][:space:]]*$'
    OR lower(btrim(q.question)) ~ '^(perdon[[:space:]]*)?[0-9]{3,}[[:punct:][:space:]]*$'
    OR lower(btrim(q.question)) ~ '^(asdf|qwer|zxcv|hjkl|lkjh|wsad)[a-z0-9]*$'
    OR q.question ~ '^[a-záéíóúñ]{1,3}[A-Z]{4,}$'
    OR (
      lower(btrim(q.question)) ~ '^[a-zñ]{7,}$'
      AND length(regexp_replace(lower(btrim(q.question)), '[^aeiou]', '', 'g'))::numeric
        / NULLIF(length(btrim(q.question)), 0) < 0.24
      AND lower(q.question) !~ '(stock|precio|ques|fiambre|lacteo|leche|envio|catalog|pedido|factura|horario|direccion|pago|mayor|menor)'
    )
  );

-- Migration 025 retained high-confidence topics in these observations even
-- when it replaced their visible suggestion with the generic fallback. Restore
-- that evidence without activating an empty or inactive label.
WITH recovered AS (
  SELECT DISTINCT ON (q.id)
    q.id,
    o.normalized_name,
    COALESCE(c.display_name, o.normalized_name) AS display_name,
    o.confidence,
    l.id AS usable_label_id,
    l.name AS usable_label_name
  FROM ai_query_logs q
  JOIN ai_label_candidate_observations o ON o.provider_message_id=q.provider_message_id
  LEFT JOIN ai_label_candidates c ON c.normalized_name=o.normalized_name
  LEFT JOIN ai_answer_labels l ON l.normalized_name=o.normalized_name
    AND l.active=true AND btrim(l.answer)<>''
  JOIN ai_answer_labels fallback ON fallback.id=q.suggested_label_id
    AND fallback.normalized_name='pregunta-no-entendible'
  WHERE q.review_status='pending'
    AND o.normalized_name<>'pregunta-no-entendible'
  ORDER BY q.id, o.observed_at DESC
)
UPDATE ai_query_logs q
SET suggested_label_id=recovered.usable_label_id,
    suggested_label_name=COALESCE(recovered.usable_label_name, recovered.display_name),
    classification_method='recovered-topic',
    classification_confidence=recovered.confidence,
    updated_at=now()
FROM recovered
WHERE q.id=recovered.id;

-- Anything else assigned to the old catch-all is a real question awaiting a
-- topic decision, not proof that the customer was incomprehensible.
UPDATE ai_query_logs q
SET suggested_label_id=NULL,
    suggested_label_name=NULL,
    classification_method=CASE WHEN q.review_status='pending' THEN 'needs-review' ELSE 'legacy-fallback' END,
    classification_confidence=NULL,
    updated_at=now()
FROM ai_answer_labels fallback
WHERE q.suggested_label_id=fallback.id
  AND fallback.normalized_name='pregunta-no-entendible'
  AND COALESCE(q.classification_method, '')<>'unintelligible';

-- Old fallback rules remain auditable but can no longer answer a future
-- customer merely because one wording was once misclassified.
UPDATE ai_answer_rules r
SET active=false, updated_by='migration-026', updated_at=now()
FROM ai_answer_labels fallback
WHERE r.label_id=fallback.id
  AND fallback.normalized_name='pregunta-no-entendible'
  AND r.active=true;

CREATE INDEX IF NOT EXISTS ai_query_logs_review_outcome_idx
  ON ai_query_logs (review_status, outcome, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_query_logs_source_review_idx
  ON ai_query_logs (source, review_status, created_at DESC);
