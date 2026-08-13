ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS legacy_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS campaigns_legacy_key_idx ON campaigns (legacy_key) WHERE legacy_key IS NOT NULL;
