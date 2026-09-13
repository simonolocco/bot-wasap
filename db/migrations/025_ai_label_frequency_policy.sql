-- Learn reusable AI labels from repeated customer topics, not from one-off
-- messages. Frequency is intentionally based on both messages and distinct
-- contacts so retries or a single noisy conversation cannot promote a label.

CREATE TABLE IF NOT EXISTS ai_label_candidates (
  normalized_name TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ai_label_candidate_observations (
  id BIGSERIAL PRIMARY KEY,
  normalized_name TEXT NOT NULL REFERENCES ai_label_candidates(normalized_name) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  provider_message_id TEXT,
  question TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0
    CHECK (confidence >= 0 AND confidence <= 1),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_label_candidate_observations_message_uniq
  ON ai_label_candidate_observations (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_label_candidate_observations_topic_seen_idx
  ON ai_label_candidate_observations (normalized_name, observed_at DESC);

CREATE INDEX IF NOT EXISTS ai_label_candidate_observations_contact_seen_idx
  ON ai_label_candidate_observations (contact_id, observed_at DESC)
  WHERE contact_id IS NOT NULL;

INSERT INTO ai_label_candidates (normalized_name, display_name)
VALUES
  ('envios', 'envios'),
  ('stock', 'stock'),
  ('unidades-por-caja', 'unidades-por-caja'),
  ('compra-minima', 'compra-minima'),
  ('minorista', 'minorista'),
  ('proveedores', 'proveedores')
ON CONFLICT (normalized_name) DO UPDATE SET
  display_name = EXCLUDED.display_name;

-- This table represents a rolling 30-day signal. The migration normally runs
-- once, but pruning makes a rerun preserve that meaning instead of turning the
-- counters into lifetime totals.
DELETE FROM ai_label_candidate_observations
WHERE observed_at < now() - interval '30 days';

-- Pick one primary topic per message. More specific commercial questions are
-- evaluated before broad product/stock wording to avoid double counting and to
-- satisfy the unique-per-provider-message observation invariant.
WITH source_events AS (
  SELECT DISTINCT ON (e.provider_message_id)
    e.contact_id,
    e.provider_message_id,
    btrim(COALESCE(NULLIF(e.raw_text, ''), e.normalized_text, '')) AS question,
    lower(btrim(COALESCE(NULLIF(e.normalized_text, ''), e.raw_text, ''))) AS normalized_question,
    e.created_at
  FROM bot_analytics_events e
  WHERE e.created_at >= now() - interval '30 days'
    AND e.provider_message_id <> ''
    AND btrim(COALESCE(NULLIF(e.raw_text, ''), e.normalized_text, '')) <> ''
    AND e.event_type = 'unrecognized_message'
  ORDER BY e.provider_message_id, e.created_at DESC
), classified AS (
  SELECT
    contact_id,
    provider_message_id,
    question,
    created_at,
    CASE
      WHEN normalized_question ~* '((cu[aá]ntas?|cantas?|cantidad de)[[:space:][:alnum:]áéíóúüñ-]{0,35}(unidades?|paquetes?|hormas?|piezas?|sobres?)[[:space:][:alnum:]áéíóúüñ-]{0,25}(caja|bulto|trae|viene|entran?)|(cu[aá]ntos?|cantas?)[[:space:][:alnum:]áéíóúüñ-]{0,25}(trae|tre|viene|entran?)[[:space:][:alnum:]áéíóúüñ-]{0,25}(caja|bulto)|(caja|bulto)[[:space:][:alnum:]áéíóúüñ-]{0,30}(trae|viene|contiene|unidades?|paquetes?|hormas?|piezas?)|fraccionado.{0,20}por caja)'
        THEN 'unidades-por-caja'
      WHEN normalized_question ~* '(compra m[ií]nima|monto m[ií]nimo|m[ií]nimo de compra|cu[aá]nto es lo m[ií]nimo|hay que.{0,25}(comprar|llevar).{0,30}(precio|mayorista)|comprar.{0,15}[0-9]+.{0,25}(hormas?|unidades?|cajas?|bultos?))'
        THEN 'compra-minima'
      WHEN normalized_question ~* '(env[ií]os?|enviar|env[ií]an|despach|repartos?|delivery|entregas?|traen.{0,45}(domicilio|casa|zona|barrio)|llevan.{0,45}(domicilio|casa|zona|barrio)|mandan.{0,45}(domicilio|casa|zona|barrio))'
        THEN 'envios'
      WHEN normalized_question ~* '(((te|les) interesa|quieren).{0,50}(trabajar|vender|comercializar|distribuir)|(somos|soy).{0,30}(proveedores?|fabricantes?|distribuidores?)|(proveedores?|fabricantes?|distribuidores?).{0,40}(de|productos?)|productos?.{0,80}(cadena de distribuci[oó]n|distribuidora mayorista)|poner.{0,35}productos?.{0,40}distribuidora|ofrecer.{0,40}(productos?|cat[aá]logo|lista|servicios?)|[aá]rea de compras)'
        THEN 'proveedores'
      WHEN normalized_question ~* '(minorista|mayorista|venta al p[uú]blico|particulares?|por menor|por mayor)'
        THEN 'minorista'
      WHEN normalized_question ~* '(stock|disponibilidad|disponible|qu[eé] productos|productos? tienen|productos? venden|hay.{0,30}(cremoso|manteca|queso|fiambre|sardo|tybo|muzzarella|muzarella|jam[oó]n|salame|panceta|ricota|cheddar|l[aá]cteos?)|(ten[eé]s?|tienen|consulta|busco|necesito|venden).{0,40}(cremoso|manteca|queso|fiambre|sardo|tybo|muzzarella|muzarella|jam[oó]n|salame|panceta|ricota|cheddar|l[aá]cteos?))'
        THEN 'stock'
      ELSE NULL
    END AS normalized_name
  FROM source_events
)
INSERT INTO ai_label_candidate_observations (
  normalized_name, contact_id, provider_message_id, question, confidence, observed_at
)
SELECT normalized_name, contact_id, provider_message_id, question, 0.90, created_at
FROM classified
WHERE normalized_name IS NOT NULL
ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL DO UPDATE SET
  normalized_name = EXCLUDED.normalized_name,
  contact_id = EXCLUDED.contact_id,
  question = EXCLUDED.question,
  confidence = EXCLUDED.confidence,
  observed_at = EXCLUDED.observed_at;

UPDATE ai_label_candidates
SET last_seen_at = NULL;

UPDATE ai_label_candidates c
SET last_seen_at = stats.last_seen_at
FROM (
  SELECT normalized_name, max(observed_at) AS last_seen_at
  FROM ai_label_candidate_observations
  WHERE observed_at >= now() - interval '30 days'
  GROUP BY normalized_name
) stats
WHERE stats.normalized_name = c.normalized_name;

-- The fallback is always usable. Existing operator text wins; only an empty
-- answer is repaired. It remains active because pending questions depend on it.
INSERT INTO ai_answer_labels (
  name, normalized_name, answer, active, created_by, updated_by
)
VALUES (
  'pregunta-no-entendible',
  'pregunta-no-entendible',
  E'Esta consulta todavía no tiene una respuesta automática específica.\n\nPara ayudarte correctamente, podés hablar con Mauricio, nuestro asesor comercial: https://wa.me/5493517565641',
  true,
  'migration-025',
  'migration-025'
)
ON CONFLICT (normalized_name) DO UPDATE SET
  answer = CASE
    WHEN btrim(ai_answer_labels.answer) = ''
      OR COALESCE(ai_answer_labels.updated_by, ai_answer_labels.created_by, '')
        IN ('ai-auto', 'ai-auto-frequency', 'migration-024', 'migration-025')
      THEN EXCLUDED.answer
    ELSE ai_answer_labels.answer
  END,
  active = true,
  updated_by = CASE
    WHEN btrim(ai_answer_labels.answer) = ''
      OR COALESCE(ai_answer_labels.updated_by, ai_answer_labels.created_by, '')
        IN ('ai-auto', 'ai-auto-frequency', 'migration-024', 'migration-025')
      THEN 'migration-025'
    ELSE ai_answer_labels.updated_by
  END,
  updated_at = CASE
    WHEN btrim(ai_answer_labels.answer) = '' OR NOT ai_answer_labels.active
      OR COALESCE(ai_answer_labels.updated_by, ai_answer_labels.created_by, '')
        IN ('ai-auto', 'ai-auto-frequency', 'migration-024', 'migration-025')
      THEN now()
    ELSE ai_answer_labels.updated_at
  END;

-- A family is frequent after 6 messages from 5 contacts in 30 days, or a
-- recent spike from 3 contacts in 7 days. Canonical answers contain stable facts;
-- anything requiring current stock, quantities or logistics is sent to Mauricio.
WITH frequent AS (
  SELECT normalized_name
  FROM ai_label_candidate_observations
  WHERE observed_at >= now() - interval '30 days'
  GROUP BY normalized_name
  HAVING (count(*) >= 6 AND count(DISTINCT contact_id) >= 5)
    OR count(DISTINCT contact_id) FILTER (WHERE observed_at >= now() - interval '7 days') >= 3
), safe_answers(normalized_name, display_name, answer) AS (
  VALUES
    ('envios', 'envios', E'Estamos en Córdoba Capital (Av. Juan B. Justo 5048). Los pedidos se retiran en el local o se despachan con un comisionista o transporte de tu confianza. La cobertura y el costo dependen de la localidad; Mauricio puede confirmarlos: https://wa.me/5493517565641'),
    ('stock', 'stock', E'No tengo stock en tiempo real. Indicame el producto, la marca y la presentación que buscás. Mauricio puede confirmar la disponibilidad actual: https://wa.me/5493517565641'),
    ('unidades-por-caja', 'unidades-por-caja', E'La cantidad de unidades por caja o bulto cambia según el producto y la presentación. Indicame el producto y la marca para identificarlo; Mauricio puede confirmar la cantidad exacta: https://wa.me/5493517565641'),
    ('compra-minima', 'compra-minima', E'Atendemos compras mayoristas y minoristas. La compra mínima puede variar según el producto y la modalidad del pedido; no tengo un monto único confirmado. Mauricio puede indicarte la condición correspondiente: https://wa.me/5493517565641'),
    ('minorista', 'minorista', E'Sí, atendemos tanto a mayoristas como a particulares. La presentación y la compra mínima dependen de cada producto. Indicame qué producto buscás para orientarte, o consultalo con Mauricio: https://wa.me/5493517565641'),
    ('proveedores', 'proveedores', E'Este WhatsApp está destinado a la atención de clientes y ventas. Para propuestas comerciales de proveedores, podés comunicarte con Mauricio, nuestro asesor comercial: https://wa.me/5493517565641')
)
INSERT INTO ai_answer_labels (
  name, normalized_name, answer, active, created_by, updated_by
)
SELECT a.display_name, a.normalized_name, a.answer, true, 'migration-025', 'migration-025'
FROM safe_answers a
JOIN frequent f USING (normalized_name)
ON CONFLICT (normalized_name) DO UPDATE SET
  answer = CASE
    WHEN btrim(ai_answer_labels.answer) = ''
      AND COALESCE(ai_answer_labels.updated_by, ai_answer_labels.created_by, '')
        IN ('', 'ai-auto', 'ai-auto-frequency', 'migration-024', 'migration-025')
      THEN EXCLUDED.answer
    ELSE ai_answer_labels.answer
  END,
  active = CASE
    WHEN btrim(ai_answer_labels.answer) = ''
      AND COALESCE(ai_answer_labels.updated_by, ai_answer_labels.created_by, '')
        IN ('', 'ai-auto', 'ai-auto-frequency', 'migration-024', 'migration-025')
      THEN true
    ELSE ai_answer_labels.active
  END,
  updated_by = CASE
    WHEN btrim(ai_answer_labels.answer) = ''
      AND COALESCE(ai_answer_labels.updated_by, ai_answer_labels.created_by, '')
        IN ('', 'ai-auto', 'ai-auto-frequency', 'migration-024', 'migration-025')
      THEN 'migration-025'
    ELSE ai_answer_labels.updated_by
  END,
  updated_at = CASE
    WHEN btrim(ai_answer_labels.answer) = ''
      AND COALESCE(ai_answer_labels.updated_by, ai_answer_labels.created_by, '')
        IN ('', 'ai-auto', 'ai-auto-frequency', 'migration-024', 'migration-025')
      THEN now()
    ELSE ai_answer_labels.updated_at
  END;

-- Pending questions attached to empty or rare automatic labels are sent to the
-- common fallback. A label counts as automatic only if neither its creator nor
-- its last editor indicates an operator edit.
WITH frequent AS (
  SELECT normalized_name
  FROM ai_label_candidate_observations
  WHERE observed_at >= now() - interval '30 days'
  GROUP BY normalized_name
  HAVING (count(*) >= 6 AND count(DISTINCT contact_id) >= 5)
    OR count(DISTINCT contact_id) FILTER (WHERE observed_at >= now() - interval '7 days') >= 3
), automatic_rare_labels AS (
  SELECT l.id
  FROM ai_answer_labels l
  WHERE l.normalized_name <> 'pregunta-no-entendible'
    AND COALESCE(l.created_by, '') IN ('ai-auto', 'ai-auto-frequency', 'migration-024', 'migration-025')
    AND COALESCE(l.updated_by, l.created_by, '') IN ('ai-auto', 'ai-auto-frequency', 'migration-024', 'migration-025')
    AND (
      btrim(l.answer) = ''
      OR NOT EXISTS (SELECT 1 FROM frequent f WHERE f.normalized_name = l.normalized_name)
    )
), fallback AS (
  SELECT id, name FROM ai_answer_labels WHERE normalized_name = 'pregunta-no-entendible'
)
UPDATE ai_query_logs q
SET suggested_label_id = fallback.id,
    suggested_label_name = fallback.name,
    classification_method = 'frequency-fallback',
    classification_confidence = 0,
    updated_at = now()
FROM fallback
WHERE q.review_status = 'pending'
  AND q.suggested_label_id IN (SELECT id FROM automatic_rare_labels);

WITH frequent AS (
  SELECT normalized_name
  FROM ai_label_candidate_observations
  WHERE observed_at >= now() - interval '30 days'
  GROUP BY normalized_name
  HAVING (count(*) >= 6 AND count(DISTINCT contact_id) >= 5)
    OR count(DISTINCT contact_id) FILTER (WHERE observed_at >= now() - interval '7 days') >= 3
)
UPDATE ai_answer_labels l
SET active = false,
    updated_by = 'migration-025',
    updated_at = now()
WHERE l.normalized_name <> 'pregunta-no-entendible'
  AND COALESCE(l.created_by, '') IN ('ai-auto', 'ai-auto-frequency', 'migration-024', 'migration-025')
  AND COALESCE(l.updated_by, l.created_by, '') IN ('ai-auto', 'ai-auto-frequency', 'migration-024', 'migration-025')
  AND (
    btrim(l.answer) = ''
    OR NOT EXISTS (SELECT 1 FROM frequent f WHERE f.normalized_name = l.normalized_name)
  );

-- Do not leave a pending query attached to any unusable label, including a
-- legacy/manual empty label. The label row and all operator-entered text remain
-- preserved; only the pending assignment moves to the safe fallback.
WITH fallback AS (
  SELECT id, name FROM ai_answer_labels WHERE normalized_name = 'pregunta-no-entendible'
), unusable AS (
  SELECT id FROM ai_answer_labels WHERE NOT active OR btrim(answer) = ''
)
UPDATE ai_query_logs q
SET suggested_label_id = fallback.id,
    suggested_label_name = fallback.name,
    classification_method = 'frequency-fallback',
    classification_confidence = 0,
    updated_at = now()
FROM fallback
WHERE q.review_status = 'pending'
  AND q.suggested_label_id IN (SELECT id FROM unusable)
  AND q.suggested_label_id <> fallback.id;

-- Empty labels cannot be active after this policy. Non-empty labels last edited
-- by an operator are otherwise left byte-for-byte unchanged.
UPDATE ai_answer_labels
SET active = false,
    updated_by = CASE
      WHEN COALESCE(updated_by, created_by, '') IN ('', 'ai-auto', 'ai-auto-frequency', 'migration-024', 'migration-025')
        THEN 'migration-025'
      ELSE updated_by
    END,
    updated_at = now()
WHERE active = true AND btrim(answer) = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_answer_labels_active_answer_required'
      AND conrelid = 'ai_answer_labels'::regclass
  ) THEN
    ALTER TABLE ai_answer_labels
      ADD CONSTRAINT ai_answer_labels_active_answer_required
      CHECK (NOT active OR btrim(answer) <> '');
  END IF;
END $$;
