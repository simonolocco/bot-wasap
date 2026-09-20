-- Keep the customer-facing result separate from the private response preview.
-- A preview is generated even while generative replies are disabled, but it is
-- never eligible for delivery to WhatsApp.
ALTER TABLE ai_query_logs
  ADD COLUMN IF NOT EXISTS preview_answer TEXT,
  ADD COLUMN IF NOT EXISTS preview_outcome TEXT,
  ADD COLUMN IF NOT EXISTS preview_source TEXT,
  ADD COLUMN IF NOT EXISTS preview_model TEXT,
  ADD COLUMN IF NOT EXISTS preview_tokens INTEGER
    CHECK (preview_tokens IS NULL OR preview_tokens >= 0),
  ADD COLUMN IF NOT EXISTS preview_elapsed_ms INTEGER
    CHECK (preview_elapsed_ms IS NULL OR preview_elapsed_ms >= 0),
  ADD COLUMN IF NOT EXISTS preview_error_code TEXT,
  ADD COLUMN IF NOT EXISTS preview_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS preview_generation_id UUID;

CREATE INDEX IF NOT EXISTS ai_query_logs_preview_missing_idx
  ON ai_query_logs (created_at ASC)
  WHERE source='production' AND preview_generated_at IS NULL;

-- Preview generation runs in its own worker lane so an OpenRouter request can
-- never delay the normal bot response or block later messages from a contact.
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_check
  CHECK (type IN ('process_incoming', 'download_media', 'ai_preview'));

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS ai_query_log_id UUID REFERENCES ai_query_logs(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS jobs_ai_preview_ready_idx
  ON jobs (status, run_after, created_at)
  WHERE type='ai_preview' AND status IN ('queued', 'retrying');

CREATE UNIQUE INDEX IF NOT EXISTS jobs_ai_preview_active_idx
  ON jobs (ai_query_log_id)
  WHERE type='ai_preview' AND status IN ('queued', 'retrying', 'processing');
