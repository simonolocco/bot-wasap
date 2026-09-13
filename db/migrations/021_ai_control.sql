CREATE TABLE IF NOT EXISTS ai_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

INSERT INTO ai_settings (id, enabled)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ai_answer_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  normalized_question TEXT NOT NULL UNIQUE,
  answer TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  manual BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_answer_rules_active_idx
  ON ai_answer_rules (active, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_query_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  incoming_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  provider_message_id TEXT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL DEFAULT 'production',
  ai_enabled BOOLEAN NOT NULL DEFAULT false,
  matched_answer_rule_id UUID REFERENCES ai_answer_rules(id) ON DELETE SET NULL,
  model TEXT,
  tokens INTEGER NOT NULL DEFAULT 0,
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_query_logs_created_idx
  ON ai_query_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS ai_query_logs_contact_idx
  ON ai_query_logs (contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_query_logs_outcome_idx
  ON ai_query_logs (outcome, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ai_query_logs_provider_message_idx
  ON ai_query_logs (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
