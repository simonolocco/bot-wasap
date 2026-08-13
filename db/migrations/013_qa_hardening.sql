ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS source_timestamp TIMESTAMPTZ;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS sending_at TIMESTAMPTZ;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_delivery_status_check;
ALTER TABLE messages ADD CONSTRAINT messages_delivery_status_check
  CHECK (delivery_status IS NULL OR delivery_status IN ('pending', 'sending', 'sent', 'delivered', 'read', 'failed'));

CREATE INDEX IF NOT EXISTS webhook_events_source_timestamp_idx
  ON webhook_events (source_timestamp);

CREATE INDEX IF NOT EXISTS messages_sending_idx
  ON messages (delivery_status, sending_at)
  WHERE delivery_status = 'sending';
