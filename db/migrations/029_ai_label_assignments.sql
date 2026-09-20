-- Older previews already contain a good answer and topic name, but some were
-- created before the topic was backed by a label row. Preserve every answer,
-- create only inactive AI drafts, and attach each question to its topic.
WITH unanswered_topics AS (
  SELECT q.id,
    CASE
      WHEN lower(COALESCE(NULLIF(btrim(q.preview_answer), ''), NULLIF(btrim(q.answer), ''))) LIKE '¡gracias por escribirnos!%'
        THEN 'agradecimientos'
      WHEN lower(COALESCE(NULLIF(btrim(q.preview_answer), ''), NULLIF(btrim(q.answer), ''))) LIKE '¡hola! bienvenido%'
        THEN 'saludos'
      ELSE 'consulta-general'
    END AS topic
  FROM ai_query_logs q
  WHERE q.review_status='pending'
    AND q.suggested_label_id IS NULL
    AND NULLIF(btrim(q.suggested_label_name), '') IS NULL
    AND COALESCE(NULLIF(btrim(q.preview_answer), ''), NULLIF(btrim(q.answer), '')) IS NOT NULL
    AND COALESCE(q.preview_outcome, q.outcome, '') NOT IN ('silence', 'unavailable')
)
UPDATE ai_query_logs q
SET suggested_label_name=unanswered_topics.topic,
    classification_method='answer-topic-backfill',
    classification_confidence=GREATEST(COALESCE(q.classification_confidence, 0), 0.8),
    updated_at=now()
FROM unanswered_topics
WHERE q.id=unanswered_topics.id;

WITH source_rows AS (
  SELECT q.suggested_label_name AS name,
    lower(regexp_replace(translate(q.suggested_label_name,
      'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'), '[^a-zA-Z0-9]+', '-', 'g')) AS normalized_name,
    COALESCE(NULLIF(btrim(q.preview_answer), ''), NULLIF(btrim(q.answer), '')) AS answer,
    q.created_at
  FROM ai_query_logs q
  WHERE q.review_status='pending'
    AND q.suggested_label_id IS NULL
    AND NULLIF(btrim(q.suggested_label_name), '') IS NOT NULL
    AND COALESCE(NULLIF(btrim(q.preview_answer), ''), NULLIF(btrim(q.answer), '')) IS NOT NULL
    AND COALESCE(q.preview_outcome, q.outcome, '') NOT IN ('silence', 'unavailable')
), grouped AS (
  SELECT normalized_name, name, answer, count(*) AS uses, max(created_at) AS latest
  FROM source_rows
  WHERE normalized_name<>'' AND normalized_name<>'pregunta-no-entendible'
  GROUP BY normalized_name, name, answer
), representatives AS (
  SELECT DISTINCT ON (normalized_name) normalized_name, name, answer
  FROM grouped
  ORDER BY normalized_name, uses DESC, latest DESC
)
INSERT INTO ai_answer_labels (name, normalized_name, answer, active, created_by, updated_by)
SELECT name, normalized_name, answer, false, 'ai-auto-backfill', 'ai-auto-backfill'
FROM representatives
ON CONFLICT (normalized_name) DO UPDATE SET
  answer=CASE WHEN btrim(ai_answer_labels.answer)='' THEN EXCLUDED.answer ELSE ai_answer_labels.answer END,
  updated_at=now();

UPDATE ai_query_logs q
SET suggested_label_id=l.id,
    suggested_label_name=l.name,
    classification_method=CASE
      WHEN q.classification_method IN ('none', 'needs-review') THEN 'topic-associated'
      ELSE q.classification_method
    END,
    classification_confidence=GREATEST(COALESCE(q.classification_confidence, 0), 0.8),
    updated_at=now()
FROM ai_answer_labels l
WHERE q.review_status='pending'
  AND q.suggested_label_id IS NULL
  AND l.normalized_name=lower(regexp_replace(translate(q.suggested_label_name,
    'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'), '[^a-zA-Z0-9]+', '-', 'g'))
  AND l.normalized_name<>'pregunta-no-entendible';
