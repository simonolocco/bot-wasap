CREATE TABLE IF NOT EXISTS bot_analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  provider_message_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'menu_option',
    'menu_requested',
    'order_started',
    'order_submitted',
    'human_advisor_requested',
    'flow_command',
    'unrecognized_message',
    'bot_paused_message'
  )),
  selected_option TEXT CHECK (selected_option IS NULL OR selected_option IN (
    'horarios',
    'direccion',
    'lista_precio',
    'hacer_pedido',
    'asesor',
    'preguntas_frecuentes'
  )),
  raw_text TEXT,
  normalized_text TEXT,
  message_type TEXT NOT NULL DEFAULT 'text',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bot_analytics_events_provider_type_uniq UNIQUE (provider_message_id, event_type)
);

CREATE INDEX IF NOT EXISTS bot_analytics_events_created_idx ON bot_analytics_events (created_at DESC);
CREATE INDEX IF NOT EXISTS bot_analytics_events_contact_created_idx ON bot_analytics_events (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bot_analytics_events_type_created_idx ON bot_analytics_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS bot_analytics_events_option_created_idx ON bot_analytics_events (selected_option, created_at DESC) WHERE selected_option IS NOT NULL;
CREATE INDEX IF NOT EXISTS bot_analytics_events_unrecognized_idx ON bot_analytics_events (normalized_text, created_at DESC) WHERE event_type = 'unrecognized_message';

-- Backfill idempotente y explícito desde mensajes entrantes históricos
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
