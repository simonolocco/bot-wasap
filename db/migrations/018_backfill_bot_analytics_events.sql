-- Backfill seguro para instalaciones que ya aplicaron 017 antes de contar con el backfill.
-- Es idempotente por la restricción UNIQUE (provider_message_id, event_type).
INSERT INTO bot_analytics_events (contact_id, provider_message_id, event_type, selected_option, raw_text, normalized_text, message_type, metadata, created_at)
SELECT
  m.contact_id,
  m.provider_message_id,
  CASE
    WHEN lower(trim(coalesce(m.body, ''))) IN ('1', 'horario', 'horarios') THEN 'menu_option'
    WHEN lower(trim(coalesce(m.body, ''))) IN ('2', 'direccion', 'ubicacion', 'dirección', 'ubicación') THEN 'menu_option'
    WHEN lower(trim(coalesce(m.body, ''))) IN ('3', 'lista', 'precios', 'precio', 'catalogo', 'catálogo', 'lista de precios') THEN 'menu_option'
    WHEN lower(trim(coalesce(m.body, ''))) IN ('4', 'hacer pedido', 'pedido', 'nuevo pedido') THEN 'menu_option'
    WHEN lower(trim(coalesce(m.body, ''))) IN ('5', 'asesor', 'comercial', 'asesor humano', 'hablar con alguien') THEN 'menu_option'
    WHEN lower(trim(coalesce(m.body, ''))) IN ('6', 'faq', 'preguntas', 'preguntas frecuentes') THEN 'menu_option'
    WHEN lower(trim(coalesce(m.body, ''))) IN ('hola', 'hola!', 'buenas', 'buenas tardes', 'buen dia', 'buenos dias', 'menu', 'menú', 'opciones', 'volver', 'inicio') THEN 'menu_requested'
    ELSE 'unrecognized_message'
  END AS event_type,
  CASE
    WHEN lower(trim(coalesce(m.body, ''))) IN ('1', 'horario', 'horarios') THEN 'horarios'
    WHEN lower(trim(coalesce(m.body, ''))) IN ('2', 'direccion', 'ubicacion', 'dirección', 'ubicación') THEN 'direccion'
    WHEN lower(trim(coalesce(m.body, ''))) IN ('3', 'lista', 'precios', 'precio', 'catalogo', 'catálogo', 'lista de precios') THEN 'lista_precio'
    WHEN lower(trim(coalesce(m.body, ''))) IN ('4', 'hacer pedido', 'pedido', 'nuevo pedido') THEN 'hacer_pedido'
    WHEN lower(trim(coalesce(m.body, ''))) IN ('5', 'asesor', 'comercial', 'asesor humano', 'hablar con alguien') THEN 'asesor'
    WHEN lower(trim(coalesce(m.body, ''))) IN ('6', 'faq', 'preguntas', 'preguntas frecuentes') THEN 'preguntas_frecuentes'
    ELSE NULL
  END AS selected_option,
  m.body AS raw_text,
  lower(trim(coalesce(m.body, ''))) AS normalized_text,
  COALESCE(m.message_type, 'text') AS message_type,
  '{"source": "migration_backfill"}'::jsonb AS metadata,
  m.created_at
FROM messages m
WHERE m.direction = 'incoming'
  AND m.provider_message_id IS NOT NULL
  AND m.provider_message_id != ''
ON CONFLICT (provider_message_id, event_type) DO NOTHING;
