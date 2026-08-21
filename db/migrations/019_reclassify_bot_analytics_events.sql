-- Reclassifica el backfill histórico usando la misma normalización del bot:
-- quita tildes, emojis y puntuación antes de resolver aliases del menú.
DELETE FROM bot_analytics_events
WHERE metadata->>'source' IN ('migration_backfill', 'migration_backfill_v2');

WITH normalized_messages AS (
  SELECT
    m.contact_id,
    m.provider_message_id,
    m.body,
    m.message_type,
    m.created_at,
    trim(regexp_replace(
      translate(lower(coalesce(m.body, '')), 'áéíóúüñ', 'aeiouun'),
      '[^a-z0-9]+', ' ', 'g'
    )) AS normalized_text
  FROM messages m
  WHERE m.direction = 'incoming'
    AND m.provider_message_id IS NOT NULL
    AND m.provider_message_id <> ''
), classified_messages AS (
  SELECT
    normalized_messages.*,
    CASE
      WHEN normalized_text IN ('1', 'horario', 'horarios') OR normalized_text LIKE '%horarios%'
        OR normalized_text LIKE '%horario de atencion%'
        OR normalized_text LIKE '%cuando atienden%'
        OR normalized_text LIKE '%cuando abren%' THEN 'horarios'
      WHEN normalized_text IN ('2', 'direccion', 'ubicacion') OR normalized_text LIKE '%direccion%'
        OR normalized_text LIKE '%ubicacion%'
        OR normalized_text LIKE '%donde estan%'
        OR normalized_text LIKE '%como llego%' THEN 'direccion'
      WHEN normalized_text IN ('3', 'lista', 'precios', 'precio', 'catalogo', 'lista de precios')
        OR normalized_text LIKE '%lista de precios%'
        OR normalized_text LIKE '%catalog%'
        OR normalized_text LIKE '%precio%'
        OR normalized_text LIKE '%ofertas%' THEN 'lista_precio'
      WHEN normalized_text IN ('4', 'hacer pedido', 'pedido', 'nuevo pedido')
        OR normalized_text LIKE '%nuevo pedido%'
        OR normalized_text LIKE '%hacer un pedido%'
        OR normalized_text LIKE '%quiero pedir%'
        OR normalized_text LIKE '%quiero hacer un pedido%' THEN 'hacer_pedido'
      WHEN normalized_text IN ('5', 'asesor', 'comercial', 'asesor humano', 'hablar con alguien')
        OR normalized_text LIKE '%asesor humano%'
        OR normalized_text LIKE '%hablar con alguien%'
        OR normalized_text LIKE '%hablar con un asesor%'
        OR normalized_text LIKE '%persona%'
        OR normalized_text LIKE '%humano%' THEN 'asesor'
      WHEN normalized_text IN ('6', 'faq', 'preguntas', 'preguntas frecuentes')
        OR normalized_text LIKE '%pregunta frecuente%'
        OR normalized_text LIKE '%preguntas%'
        OR normalized_text LIKE '%faq%' THEN 'preguntas_frecuentes'
      ELSE NULL
    END AS selected_option
  FROM normalized_messages
), classified_events AS (
  SELECT
    classified_messages.*,
    CASE
      WHEN selected_option IS NOT NULL THEN 'menu_option'
      WHEN normalized_text IN ('hola', 'hola bot', 'buenas', 'buenas bot', 'buen dia', 'buenas tardes', 'buenas noches', 'menu', 'opciones', 'ver menu', 'ver opciones', 'volver', 'volver al menu', 'inicio') THEN 'menu_requested'
      ELSE 'unrecognized_message'
    END AS event_type
  FROM classified_messages
)
INSERT INTO bot_analytics_events (
  contact_id, provider_message_id, event_type, selected_option, raw_text,
  normalized_text, message_type, metadata, created_at
)
SELECT
  contact_id,
  provider_message_id,
  event_type,
  selected_option,
  body,
  normalized_text,
  coalesce(message_type, 'text'),
  '{"source":"migration_backfill_v2"}'::jsonb,
  created_at
FROM classified_events
ON CONFLICT (provider_message_id, event_type) DO NOTHING;
