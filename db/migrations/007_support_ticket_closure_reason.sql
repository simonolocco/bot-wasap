ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS closure_reason TEXT
    CHECK (closure_reason IS NULL OR closure_reason IN ('answered', 'no_customer_question', 'no_operator_response'));
