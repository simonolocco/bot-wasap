-- Canonical, operator-managed answer labels. A label can exist before any
-- question is assigned to it; aliases remain in ai_answer_rules.
CREATE TABLE IF NOT EXISTS ai_answer_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  answer TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ai_answer_rules
  ADD COLUMN IF NOT EXISTS label_id UUID REFERENCES ai_answer_labels(id) ON DELETE SET NULL;

ALTER TABLE ai_query_logs
  ADD COLUMN IF NOT EXISTS matched_label_id UUID REFERENCES ai_answer_labels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ai_answer_rules_label_idx
  ON ai_answer_rules (label_id, active, updated_at DESC);

CREATE INDEX IF NOT EXISTS ai_query_logs_label_idx
  ON ai_query_logs (matched_label_id, created_at DESC);

-- Existing intents become labels without changing their matching behavior.
-- Pick the most recently edited answer when legacy rows reused a label.
WITH legacy AS (
  SELECT DISTINCT ON (normalize_name)
    COALESCE(NULLIF(btrim(intent_label), ''), 'respuesta-' || substr(md5(answer), 1, 10)) AS name,
    normalize_name,
    answer,
    created_by,
    updated_by
  FROM (
    SELECT intent_label, answer, created_by, updated_by, updated_at,
         lower(regexp_replace(translate(COALESCE(NULLIF(btrim(intent_label), ''), 'respuesta-' || substr(md5(answer), 1, 10)), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'), '[^a-z0-9]+', '-', 'g')) AS normalize_name
    FROM ai_answer_rules
  ) legacy_rows
  ORDER BY normalize_name, updated_at DESC
)
INSERT INTO ai_answer_labels (name, normalized_name, answer, active, created_by, updated_by)
SELECT name, normalize_name, answer, true, created_by, updated_by
FROM legacy
ON CONFLICT (normalized_name) DO NOTHING;

UPDATE ai_answer_rules r
SET label_id = l.id
FROM ai_answer_labels l
WHERE r.label_id IS NULL
  AND l.normalized_name = lower(regexp_replace(translate(COALESCE(NULLIF(btrim(r.intent_label), ''), 'respuesta-' || substr(md5(r.answer), 1, 10)), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'), '[^a-z0-9]+', '-', 'g'));

UPDATE ai_query_logs q
SET matched_label_id = r.label_id
FROM ai_answer_rules r
WHERE q.matched_answer_rule_id = r.id
  AND q.matched_label_id IS NULL
  AND r.label_id IS NOT NULL;
