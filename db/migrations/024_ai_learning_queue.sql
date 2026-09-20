-- Separate customer-facing AI outcomes from the operator learning queue.
-- A query can have received a generic/menu response and still need review, so
-- review_status is intentionally independent from outcome.
ALTER TABLE ai_query_logs
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'resolved', 'ignored')),
  ADD COLUMN IF NOT EXISTS suggested_label_id UUID REFERENCES ai_answer_labels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggested_label_name TEXT,
  ADD COLUMN IF NOT EXISTS classification_method TEXT,
  ADD COLUMN IF NOT EXISTS classification_confidence REAL
    CHECK (classification_confidence IS NULL OR (classification_confidence >= 0 AND classification_confidence <= 1)),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

-- Manual tests are useful as diagnostics, but must never contaminate the real
-- customer-question inbox. Completed/silent/paused historical rows are also
-- outside the learning queue.
UPDATE ai_query_logs
SET review_status = CASE
      WHEN source = 'manual' THEN 'ignored'
      ELSE 'resolved'
    END,
    reviewed_at = COALESCE(reviewed_at, updated_at)
WHERE source = 'manual'
   OR outcome IN ('answered', 'edited', 'silence', 'paused');

-- Confirmations and conversational closers are not unanswered questions. They
-- require no bot reply and must not create a reusable label.
UPDATE ai_query_logs
SET review_status='ignored', reviewed_at=COALESCE(reviewed_at, updated_at), reviewed_by='migration-024'
WHERE review_status='pending'
  AND lower(btrim(question)) ~ '^(ok|dale|si|sí|gracias|muchas gracias|perfecto|listo|entendido|chau|chao)[[:punct:][:space:]]*$';

-- Older workers logged "disabled" before resolving menu aliases. Reconcile
-- only concrete option replies; greeting/menu fallbacks deliberately remain
-- pending because they did not answer the customer's actual question.
UPDATE ai_query_logs q
SET review_status = 'resolved', reviewed_at = COALESCE(q.reviewed_at, q.updated_at)
WHERE q.source = 'production'
  AND q.provider_message_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM messages m
    WHERE m.contact_id = q.contact_id
      AND m.direction = 'outgoing'
      AND m.outbound_key IN (
        'event:' || q.provider_message_id || ':schedule',
        'event:' || q.provider_message_id || ':address',
        'event:' || q.provider_message_id || ':prices',
        'event:' || q.provider_message_id || ':faq',
        'event:' || q.provider_message_id || ':advisor',
        'event:' || q.provider_message_id || ':order-instructions'
      )
  );

-- Natural menu wording belongs to the deterministic menu, even when an older
-- worker only understood the short alias. Pure greetings are also fully served
-- by the greeting/menu response and are not business questions to learn.
UPDATE ai_query_logs
SET review_status='resolved', reviewed_at=COALESCE(reviewed_at, updated_at), reviewed_by='migration-024-menu'
WHERE review_status='pending'
  AND (
    lower(btrim(question)) ~ '^(hola|buen d[ií]a|buenos d[ií]as|buenas tardes|buenas noches)( (c[oó]mo est[aá]s|c[oó]mo va|qu[eé] tal))?[[:punct:][:space:]]*$'
    OR question ~* '(cat[aá]logos?|lista de precios?|precios mayoristas?)'
    OR question ~* '(de d[oó]nde son|d[oó]nde (est[aá]n|quedan|se encuentran)|ubicaci[oó]n|direcci[oó]n del local)'
    OR question ~* '(horarios?|cu[aá]ndo (abren|cierran|atienden)|hasta qu[eé] hora)'
  );

-- Seed the requested delivery intent for existing unanswered history.
INSERT INTO ai_answer_labels (name, normalized_name, answer, active, created_by, updated_by)
SELECT 'envios', 'envios', '', true, 'migration-024', 'migration-024'
WHERE EXISTS (
  SELECT 1 FROM ai_query_logs
  WHERE review_status='pending'
    AND question ~* '(env.{0,3}os?|envia|reparto|entregas?|traen.{0,40}domicilio|llevan.{0,40}(domicilio|casa))'
)
ON CONFLICT (normalized_name) DO NOTHING;

UPDATE ai_query_logs q
SET suggested_label_id=l.id, suggested_label_name=l.name,
    classification_method='fallback', classification_confidence=0.9, updated_at=now()
FROM ai_answer_labels l
WHERE q.review_status='pending'
  AND q.suggested_label_id IS NULL
  AND l.normalized_name='envios'
  AND q.question ~* '(env.{0,3}os?|envia|reparto|entregas?|traen.{0,40}domicilio|llevan.{0,40}(domicilio|casa))';

-- Backfill the remaining real unanswered examples into stable reusable labels.
-- Empty answers stay visible as drafts; the operator approves their canonical
-- text once and every future wording reuses it.
INSERT INTO ai_answer_labels (name, normalized_name, answer, active, created_by, updated_by)
SELECT 'minorista', 'minorista', '', true, 'migration-024', 'migration-024'
WHERE EXISTS (
  SELECT 1 FROM ai_query_logs WHERE review_status='pending'
    AND question ~* '(minorista|venta al p[uú]blico|por menor|por mayor.{0,20}(por )?menor|menor.{0,25}(comprar|compra|venden))'
)
ON CONFLICT (normalized_name) DO NOTHING;

UPDATE ai_query_logs q
SET suggested_label_id=l.id, suggested_label_name=l.name,
    classification_method='fallback', classification_confidence=0.9, updated_at=now()
FROM ai_answer_labels l
WHERE q.review_status='pending' AND q.suggested_label_id IS NULL
  AND l.normalized_name='minorista'
  AND q.question ~* '(minorista|venta al p[uú]blico|por menor|por mayor.{0,20}(por )?menor|menor.{0,25}(comprar|compra|venden))';

INSERT INTO ai_answer_labels (name, normalized_name, answer, active, created_by, updated_by)
SELECT 'compra-minima', 'compra-minima', '', true, 'migration-024', 'migration-024'
WHERE EXISTS (
  SELECT 1 FROM ai_query_logs WHERE review_status='pending'
    AND question ~* '(compra m[ií]nima|monto m[ií]nimo|m[ií]nimo de compra|hay que.{0,20}(comprar|llevar).{0,30}(precio|mayorista)|comprar.{0,12}[0-9]+.{0,20}(hormas?|unidades?|cajas?|bultos?))'
)
ON CONFLICT (normalized_name) DO NOTHING;

UPDATE ai_query_logs q
SET suggested_label_id=l.id, suggested_label_name=l.name,
    classification_method='fallback', classification_confidence=0.9, updated_at=now()
FROM ai_answer_labels l
WHERE q.review_status='pending' AND q.suggested_label_id IS NULL
  AND l.normalized_name='compra-minima'
  AND q.question ~* '(compra m[ií]nima|monto m[ií]nimo|m[ií]nimo de compra|hay que.{0,20}(comprar|llevar).{0,30}(precio|mayorista)|comprar.{0,12}[0-9]+.{0,20}(hormas?|unidades?|cajas?|bultos?))';

INSERT INTO ai_answer_labels (name, normalized_name, answer, active, created_by, updated_by)
SELECT 'stock', 'stock',
       'No tengo stock en tiempo real. Podés consultarle a Mauricio para confirmar disponibilidad: https://wa.me/5493517565641',
       true, 'migration-024', 'migration-024'
WHERE EXISTS (
  SELECT 1 FROM ai_query_logs WHERE review_status='pending'
    AND question ~* '(stock|disponibilidad|disponible|((hay|ten[eé]s?|tienen|consulta|busco|necesito|venden).{0,35}(cremoso|manteca|queso|fiambre|sardo|tybo|muzzarella|jam[oó]n|salame|panceta|ricota|cheddar)))'
)
ON CONFLICT (normalized_name) DO NOTHING;

UPDATE ai_query_logs q
SET suggested_label_id=l.id, suggested_label_name=l.name,
    classification_method='fallback', classification_confidence=0.9, updated_at=now()
FROM ai_answer_labels l
WHERE q.review_status='pending' AND q.suggested_label_id IS NULL
  AND l.normalized_name='stock'
  AND q.question ~* '(stock|disponibilidad|disponible|(hay|ten[eé]s?|tienen).{0,25}(cremoso|manteca|queso|fiambre|sardo|tybo|muzzarella|jam[oó]n|salame|panceta|ricota|cheddar))';

-- Product questions phrased as a consultation still mean availability.
UPDATE ai_query_logs q
SET suggested_label_id=l.id, suggested_label_name=l.name,
    classification_method='fallback', classification_confidence=0.85, updated_at=now()
FROM ai_answer_labels l
WHERE q.review_status='pending' AND q.suggested_label_id IS NULL
  AND l.normalized_name='stock'
  AND q.question ~* '(consulta|busco|necesito|venden).{0,35}(cremoso|manteca|queso|fiambre|sardo|tybo|muzzarella|jam[oó]n|salame|panceta|ricota|cheddar)';

INSERT INTO ai_answer_labels (name, normalized_name, answer, active, created_by, updated_by)
SELECT 'proveedores', 'proveedores', '', true, 'migration-024', 'migration-024'
WHERE EXISTS (
  SELECT 1 FROM ai_query_logs WHERE review_status='pending'
    AND question ~* '((te|les) interesa|quieren).{0,45}(trabajar|vender|comercializar|distribuir)|(somos|soy).{0,25}(proveedor|fabricante|distribuidor)|ofrecer.{0,35}(productos?|cat[aá]logo|lista)'
)
ON CONFLICT (normalized_name) DO NOTHING;

UPDATE ai_query_logs q
SET suggested_label_id=l.id, suggested_label_name=l.name,
    classification_method='fallback', classification_confidence=0.9, updated_at=now()
FROM ai_answer_labels l
WHERE q.review_status='pending' AND q.suggested_label_id IS NULL
  AND l.normalized_name='proveedores'
  AND q.question ~* '((te|les) interesa|quieren).{0,45}(trabajar|vender|comercializar|distribuir)|(somos|soy).{0,25}(proveedor|fabricante|distribuidor)|ofrecer.{0,35}(productos?|cat[aá]logo|lista)';

INSERT INTO ai_answer_labels (name, normalized_name, answer, active, created_by, updated_by)
SELECT 'pregunta-no-entendible', 'pregunta-no-entendible',
       E'No llegué a comprender bien tu consulta. ¿Podés escribirla de otra forma?\n\nSi preferís, podés hablar con Mauricio, nuestro asesor comercial: https://wa.me/5493517565641',
       true, 'migration-024', 'migration-024'
ON CONFLICT (normalized_name) DO UPDATE SET
  answer=CASE WHEN btrim(ai_answer_labels.answer)='' THEN EXCLUDED.answer ELSE ai_answer_labels.answer END,
  active=true, updated_by='migration-024', updated_at=now();

UPDATE ai_query_logs q
SET suggested_label_id=l.id, suggested_label_name=l.name,
    classification_method='fallback', classification_confidence=0.8, updated_at=now()
FROM ai_answer_labels l
WHERE q.review_status='pending' AND q.suggested_label_id IS NULL
  AND l.normalized_name='pregunta-no-entendible'
  AND (q.question ~ '^[a-záéíóúñ]{1,3}[A-Z]{4,}$'
    OR q.question ~* '^perd.*[0-9]{3,}[[:space:].?!,:-]*$'
    OR q.question ~ '^[0-9]{3,}[[:space:].?!,:-]*$');

-- Hard invariant: every remaining pending item must be operable from a label.
-- When neither deterministic rules nor the provider can classify it safely,
-- it goes to the reusable unclear-question label instead of staying untagged.
UPDATE ai_query_logs q
SET suggested_label_id=l.id, suggested_label_name=l.name,
    classification_method=COALESCE(q.classification_method, 'fallback'),
    classification_confidence=COALESCE(q.classification_confidence, 0), updated_at=now()
FROM ai_answer_labels l
WHERE q.review_status='pending' AND q.suggested_label_id IS NULL
  AND l.normalized_name='pregunta-no-entendible';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_query_logs_pending_label_required') THEN
    ALTER TABLE ai_query_logs ADD CONSTRAINT ai_query_logs_pending_label_required
      CHECK (review_status <> 'pending' OR suggested_label_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ai_query_logs_review_idx
  ON ai_query_logs (review_status, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_query_logs_suggested_label_idx
  ON ai_query_logs (suggested_label_id, review_status, created_at DESC);
