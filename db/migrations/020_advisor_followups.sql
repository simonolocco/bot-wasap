CREATE TABLE IF NOT EXISTS advisor_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  trigger_provider_message_id TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'cancelled', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_error TEXT,
  sent_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (contact_id, trigger_provider_message_id)
);

CREATE INDEX IF NOT EXISTS advisor_followups_due_idx
  ON advisor_followups (status, due_at, created_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS advisor_followups_contact_idx
  ON advisor_followups (contact_id, status, due_at);
