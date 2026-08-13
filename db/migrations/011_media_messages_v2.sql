CREATE TABLE IF NOT EXISTS media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_media_id TEXT UNIQUE,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  filename TEXT NOT NULL DEFAULT 'archivo',
  size_bytes BIGINT,
  sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
  error TEXT,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_asset_id UUID REFERENCES media_assets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS media_status TEXT CHECK (media_status IS NULL OR media_status IN ('pending', 'ready', 'failed')),
  ADD COLUMN IF NOT EXISTS quote_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_status_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_error TEXT;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_delivery_status_check;
ALTER TABLE messages ADD CONSTRAINT messages_delivery_status_check
  CHECK (delivery_status IS NULL OR delivery_status IN ('pending', 'sent', 'delivered', 'read', 'failed'));

CREATE TABLE IF NOT EXISTS message_status_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_message_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
  error TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_message_id, status)
);

CREATE INDEX IF NOT EXISTS media_assets_status_idx ON media_assets (status, updated_at);
CREATE INDEX IF NOT EXISTS messages_media_asset_idx ON messages (media_asset_id) WHERE media_asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_quote_idx ON messages (quote_message_id) WHERE quote_message_id IS NOT NULL;

DROP TRIGGER IF EXISTS media_assets_realtime_trigger ON media_assets;
CREATE TRIGGER media_assets_realtime_trigger
  AFTER INSERT OR UPDATE ON media_assets
  FOR EACH ROW EXECUTE FUNCTION notify_abastobot_event();
