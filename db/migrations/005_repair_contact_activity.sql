-- Los contactos importados desde campaign_contacts.json no son conversaciones.
-- La actividad debe derivarse exclusivamente de mensajes persistidos.
WITH activity AS (
  SELECT contact_id,
    max(created_at) AS last_message_at,
    max(created_at) FILTER (WHERE direction = 'incoming') AS last_incoming_at,
    max(created_at) FILTER (WHERE direction = 'outgoing') AS last_outgoing_at
  FROM messages
  GROUP BY contact_id
)
UPDATE contacts c
SET last_message_at = a.last_message_at,
    last_incoming_at = a.last_incoming_at,
    last_outgoing_at = a.last_outgoing_at,
    unread_count = 0,
    updated_at = now()
FROM activity a
WHERE c.id = a.contact_id;

UPDATE contacts c
SET last_message_at = NULL,
    last_incoming_at = NULL,
    last_outgoing_at = NULL,
    unread_count = 0,
    updated_at = now()
WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.contact_id = c.id);
