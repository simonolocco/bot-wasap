ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS quoted_provider_message_id TEXT;

UPDATE messages AS message
SET quoted_provider_message_id = quoted.provider_message_id
FROM messages AS quoted
WHERE message.quote_message_id = quoted.id
  AND message.quoted_provider_message_id IS NULL
  AND quoted.provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS messages_quoted_provider_id_idx
  ON messages (quoted_provider_message_id)
  WHERE quoted_provider_message_id IS NOT NULL;
