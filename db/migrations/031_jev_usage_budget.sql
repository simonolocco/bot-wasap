-- Persistent hourly circuit breaker for paid Jev/OpenRouter requests.
-- Each outbound attempt reserves both a global slot and a subject slot in one
-- transaction, so concurrent app/worker processes cannot overspend the limit.
CREATE TABLE IF NOT EXISTS jev_usage_buckets (
  bucket_start TIMESTAMPTZ NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'contact', 'admin', 'system')),
  subject_key TEXT NOT NULL CHECK (btrim(subject_key) <> '' AND length(subject_key) <= 256),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_start, scope, subject_key),
  CHECK (bucket_start = date_trunc('hour', bucket_start))
);

CREATE INDEX IF NOT EXISTS jev_usage_buckets_recent_idx
  ON jev_usage_buckets (bucket_start DESC);
