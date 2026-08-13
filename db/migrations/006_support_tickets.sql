CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  subject TEXT NOT NULL DEFAULT 'Pregunta fuera de preguntas frecuentes',
  question TEXT NOT NULL DEFAULT '',
  question_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  answered_by TEXT,
  answered_at TIMESTAMPTZ,
  created_by TEXT NOT NULL DEFAULT 'bot',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS support_tickets_one_open_idx
  ON support_tickets (contact_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS support_tickets_status_idx
  ON support_tickets (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_contact_idx
  ON support_tickets (contact_id, created_at DESC);
