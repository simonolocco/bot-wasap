-- A saved AI answer is an intent (for example, "envios"), with many
-- examples/aliases.  The original question columns remain for rollback and
-- backwards compatibility with rules created before intent labels existed.
ALTER TABLE ai_answer_rules ADD COLUMN IF NOT EXISTS intent_label TEXT;

CREATE INDEX IF NOT EXISTS ai_answer_rules_intent_label_idx
  ON ai_answer_rules (lower(intent_label))
  WHERE active = true AND intent_label IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_answer_rule_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  answer_rule_id UUID NOT NULL REFERENCES ai_answer_rules(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL UNIQUE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_answer_rule_aliases_rule_idx
  ON ai_answer_rule_aliases (answer_rule_id, created_at DESC);

-- Legacy exact-question rules get a stable editable label until an operator
-- renames it from the IA panel.
UPDATE ai_answer_rules
SET intent_label = 'respuesta-' || substr(md5(answer), 1, 10)
WHERE intent_label IS NULL OR btrim(intent_label) = '';

-- Existing rules become their own one-example intent until an operator gives
-- them a label and adds more examples from the IA panel.
INSERT INTO ai_answer_rule_aliases (answer_rule_id, alias, normalized_alias)
SELECT id, question, normalized_question
FROM ai_answer_rules
WHERE question <> '' AND normalized_question <> ''
ON CONFLICT (normalized_alias) DO NOTHING;
