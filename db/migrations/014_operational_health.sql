CREATE TABLE IF NOT EXISTS backup_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('logical', 'physical', 'media', 'restore')),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  object_key TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS backup_runs_kind_completed_idx
  ON backup_runs (kind, completed_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS messages_contact_created_id_idx
  ON messages (contact_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS contacts_name_trgm_idx ON contacts USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS contacts_public_name_trgm_idx ON contacts USING gin (public_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS contacts_phone_trgm_idx ON contacts USING gin (phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS orders_created_id_idx
  ON orders (created_at DESC, id DESC);
