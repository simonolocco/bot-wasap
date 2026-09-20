-- Keep per-contact ordering efficient while allowing different contacts to
-- be processed concurrently during bursts.
CREATE INDEX IF NOT EXISTS jobs_contact_pending_order_idx
  ON jobs (contact_id, created_at, id)
  WHERE status IN ('queued', 'retrying', 'processing');
