-- Normalize legacy closed tickets once. This does not change messages.
UPDATE support_tickets
SET closure_reason = CASE
      WHEN ticket_type = 'order' THEN 'order_completed'
      WHEN answered_at IS NOT NULL THEN 'question_answered'
      ELSE 'customer_no_reply'
    END,
    closed_by = COALESCE(closed_by, 'legacy'),
    updated_at = now()
WHERE status = 'closed'
  AND (closure_reason IS NULL OR closure_reason IN ('answered', 'no_customer_question', 'no_operator_response'));

INSERT INTO admin_audit_log (actor, action, contact_id, metadata)
SELECT 'system', 'ticket_closure_reason_backfilled', contact_id,
       jsonb_build_object('ticketId', id, 'reason', closure_reason)
FROM support_tickets st
WHERE st.status = 'closed'
  AND st.closed_by = 'legacy'
  AND NOT EXISTS (
    SELECT 1 FROM admin_audit_log a
    WHERE a.action = 'ticket_closure_reason_backfilled'
      AND a.metadata->>'ticketId' = st.id::text
  );
