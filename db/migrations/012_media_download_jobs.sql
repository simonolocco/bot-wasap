ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_check CHECK (type IN ('process_incoming', 'download_media'));
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES messages(id) ON DELETE CASCADE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS provider_media_id TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS media_filename TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS media_mime_type TEXT;
CREATE INDEX IF NOT EXISTS jobs_media_idx ON jobs (type, status, run_after, created_at) WHERE type = 'download_media';

CREATE OR REPLACE FUNCTION notify_abastobot_media_event() RETURNS trigger AS $$
DECLARE contact_id TEXT;
BEGIN
  SELECT m.contact_id::text INTO contact_id FROM messages m WHERE m.media_asset_id = NEW.id LIMIT 1;
  PERFORM pg_notify('abastobot_events', json_build_object(
    'table', 'media_assets', 'operation', TG_OP, 'contactId', contact_id, 'mediaAssetId', NEW.id
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS media_assets_realtime_trigger ON media_assets;
CREATE TRIGGER media_assets_realtime_trigger
  AFTER INSERT OR UPDATE ON media_assets
  FOR EACH ROW EXECUTE FUNCTION notify_abastobot_media_event();
