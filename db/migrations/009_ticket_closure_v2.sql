ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS closed_by TEXT;

ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS support_tickets_closure_reason_check;
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_closure_reason_check
  CHECK (closure_reason IS NULL OR closure_reason IN (
    'answered',
    'no_customer_question',
    'no_operator_response',
    'fallback_sent',
    'order_completed',
    'question_answered',
    'customer_no_reply',
    'operator_cancelled'
  ));

CREATE INDEX IF NOT EXISTS support_tickets_inbox_idx
  ON support_tickets (ticket_type, status, closure_reason, updated_at DESC);

-- The historical order ticket was closed through the old question-based
-- inference. Repair only its internal classification; keep every message.
UPDATE support_tickets
SET closure_reason = 'order_completed', closed_by = COALESCE(closed_by, 'admin'), updated_at = now()
WHERE id = 'b8b9688d-043d-46e7-8577-a354ccb90e30'
  AND ticket_type = 'order'
  AND status = 'closed'
  AND closure_reason = 'no_customer_question';

INSERT INTO admin_audit_log (actor, action, contact_id, metadata)
SELECT 'admin', 'ticket_closure_corrected', contact_id,
       jsonb_build_object('ticketId', id, 'from', 'no_customer_question', 'to', 'order_completed')
FROM support_tickets
WHERE id = 'b8b9688d-043d-46e7-8577-a354ccb90e30'
  AND ticket_type = 'order'
  AND status = 'closed'
  AND closure_reason = 'order_completed'
  AND NOT EXISTS (
    SELECT 1 FROM admin_audit_log a
    WHERE a.action = 'ticket_closure_corrected'
      AND a.metadata->>'ticketId' = support_tickets.id::text
  );
