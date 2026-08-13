ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS ticket_type TEXT NOT NULL DEFAULT 'question'
    CHECK (ticket_type IN ('question', 'order')),
  ADD COLUMN IF NOT EXISTS order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fallback_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fallback_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fallback_error TEXT;

ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS support_tickets_closure_reason_check;
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_closure_reason_check
  CHECK (closure_reason IS NULL OR closure_reason IN ('answered', 'no_customer_question', 'no_operator_response', 'fallback_sent'));

CREATE INDEX IF NOT EXISTS support_tickets_order_idx
  ON support_tickets (ticket_type, status, fallback_sent_at, updated_at DESC);
