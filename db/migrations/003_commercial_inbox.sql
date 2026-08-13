ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS pipeline_status TEXT NOT NULL DEFAULT 'new'
    CHECK (pipeline_status IN ('new', 'in_attention', 'follow_up', 'order_received', 'won', 'lost')),
  ADD COLUMN IF NOT EXISTS assigned_to TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unread_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_incoming_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_outgoing_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bot_paused BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bot_paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bot_paused_by TEXT;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_id TEXT,
  ADD COLUMN IF NOT EXISTS media_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS media_filename TEXT,
  ADD COLUMN IF NOT EXISTS media_size INTEGER,
  ADD COLUMN IF NOT EXISTS media_caption TEXT,
  ADD COLUMN IF NOT EXISTS error TEXT;

CREATE INDEX IF NOT EXISTS contacts_pipeline_idx ON contacts (pipeline_status, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS contacts_follow_up_idx ON contacts (follow_up_at) WHERE follow_up_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_unread_idx ON contacts (unread_count, last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_contact_idx ON admin_audit_log (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit_log (created_at DESC);

CREATE OR REPLACE FUNCTION notify_abastobot_event() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('abastobot_events', json_build_object(
    'table', TG_TABLE_NAME,
    'operation', TG_OP,
    'contactId', COALESCE(to_jsonb(NEW)->>'contact_id', to_jsonb(OLD)->>'contact_id', to_jsonb(NEW)->>'id', to_jsonb(OLD)->>'id'),
    'messageId', COALESCE(to_jsonb(NEW)->>'id', to_jsonb(OLD)->>'id')
  )::text);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS messages_realtime_trigger ON messages;
CREATE TRIGGER messages_realtime_trigger
  AFTER INSERT OR UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION notify_abastobot_event();

DROP TRIGGER IF EXISTS contacts_realtime_trigger ON contacts;
CREATE TRIGGER contacts_realtime_trigger
  AFTER UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION notify_abastobot_event();
