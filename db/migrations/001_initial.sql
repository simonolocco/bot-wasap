CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,
  country_code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  public_name TEXT NOT NULL DEFAULT '',
  is_my_contact BOOLEAN NOT NULL DEFAULT false,
  is_business BOOLEAN NOT NULL DEFAULT false,
  labels JSONB NOT NULL DEFAULT '[]'::jsonb,
  consent_status TEXT NOT NULL DEFAULT 'unknown' CHECK (consent_status IN ('unknown', 'opted_in', 'opted_out')),
  consent_source TEXT,
  consent_at TIMESTAMPTZ,
  opt_out_at TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contacts_last_message_idx ON contacts (last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS contacts_consent_idx ON contacts (consent_status, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS contacts_search_idx ON contacts USING GIN (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(public_name, '') || ' ' || phone));

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  body TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  provider_message_id TEXT UNIQUE,
  outbound_key TEXT UNIQUE,
  delivery_status TEXT CHECK (delivery_status IN ('pending', 'sent', 'failed')),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_contact_created_idx ON messages (contact_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS messages_provider_id_idx ON messages (provider_message_id) WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS bot_sessions (
  contact_id UUID PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  greeted BOOLEAN NOT NULL DEFAULT false,
  awaiting_order_detail BOOLEAN NOT NULL DEFAULT false,
  display_name TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  customer_name TEXT,
  detail TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  grand_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending_customer' CHECK (status IN ('pending_customer', 'submitted', 'canceled', 'accepted')),
  accepted BOOLEAN NOT NULL DEFAULT false,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_created_idx ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_contact_idx ON orders (contact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_message_id TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'processed', 'failed')),
  error TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('process_incoming')),
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  webhook_event_id UUID REFERENCES webhook_events(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'retrying', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS jobs_ready_idx ON jobs (status, run_after, created_at) WHERE status IN ('queued', 'retrying');
CREATE INDEX IF NOT EXISTS jobs_contact_idx ON jobs (contact_id, created_at);

CREATE TABLE IF NOT EXISTS templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_name TEXT NOT NULL UNIQUE,
  language TEXT NOT NULL DEFAULT 'es_AR',
  category TEXT NOT NULL CHECK (category IN ('MARKETING', 'UTILITY')),
  body TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'paused', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES templates(id) ON DELETE SET NULL,
  mode TEXT NOT NULL DEFAULT 'draft' CHECK (mode IN ('draft', 'dry_run', 'live')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'dry_run', 'queued', 'running', 'completed', 'failed', 'canceled')),
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  total INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, contact_id)
);

CREATE TABLE IF NOT EXISTS app_sessions (
  sid TEXT PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS app_sessions_expire_idx ON app_sessions (expire);
