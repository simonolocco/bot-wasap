-- Jev becomes an explicitly selectable response engine. The rollout remains
-- customer-off until an operator explicitly activates Jev from the panel.
ALTER TABLE ai_settings
  ADD COLUMN IF NOT EXISTS engine TEXT NOT NULL DEFAULT 'legacy';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_settings_engine_check') THEN
    ALTER TABLE ai_settings
      ADD CONSTRAINT ai_settings_engine_check CHECK (engine IN ('legacy', 'jev'));
  END IF;
END $$;

-- This rollout is deliberately test-first: installing the Jev pipeline must
-- never start customer-facing automation on its own.
UPDATE ai_settings
SET enabled = false,
    engine = 'legacy',
    updated_by = 'migration-030',
    updated_at = now()
WHERE id = 1;

-- Canonical answers used by the Jev decision router. These are ordinary IA
-- labels, so the operator can still review and edit the exact customer copy.
INSERT INTO ai_answer_labels (name, normalized_name, answer, active, created_by, updated_by)
VALUES
  ('saludos', 'saludos',
    '¡Hola! Bienvenido/a a *Distribuidora Abasto del Campo* 👋 ¿En qué podemos ayudarte hoy?',
    true, 'migration-030', 'migration-030'),
  ('agradecimientos', 'agradecimientos',
    '¡Gracias por escribirnos! Estamos a tu disposición.',
    true, 'migration-030', 'migration-030'),
  ('informacion', 'informacion',
    'Somos Distribuidora Abasto del Campo, en Córdoba Capital (Av. Juan B. Justo 5048). Atendemos a mayoristas y particulares. Comercializamos quesos, fiambres y lácteos con retiro en el local o despacho coordinado por comisionista. ¿En qué podemos ayudarte?',
    true, 'migration-030', 'migration-030'),
  ('direccion', 'direccion',
    E'📍 *Dirección*\n━━━━━━━━━━━━\nAv. Juan B. Justo 5048\nCórdoba, Argentina\n\n🗺️ *Ver en mapa:*\nhttps://maps.app.goo.gl/gCfNiJEz9Q7k4LzS6',
    true, 'migration-030', 'migration-030'),
  ('horarios', 'horarios',
    E'🕒 *Nuestros horarios*\n━━━━━━━━━━━━\n*Lunes a viernes:* 8:15 a 16:00\n*Sábado:* 8:15 a 12:45\n*Domingo:* cerrado',
    true, 'migration-030', 'migration-030'),
  ('envios', 'envios',
    'Estamos en Córdoba Capital (Av. Juan B. Justo 5048). Los pedidos se retiran en el local o se despachan con un comisionista o transporte de tu confianza. La cobertura y el costo dependen de la localidad; Mauricio puede confirmarlos: https://wa.me/5493517565641',
    true, 'migration-030', 'migration-030'),
  ('compra-minima', 'compra-minima',
    'La compra mínima es de 1/2 horma en adelante. Si necesitás confirmar una presentación o cantidad de un producto, podés consultarle a Mauricio: https://wa.me/5493517565641',
    true, 'migration-030', 'migration-030'),
  ('minorista', 'minorista',
    'Atendemos tanto a clientes mayoristas como minoristas. La compra mínima es de 1/2 horma en adelante.',
    true, 'migration-030', 'migration-030'),
  ('pagos', 'pagos',
    'No tengo medios de pago ni planes de cuotas confirmados en este canal. Mauricio puede confirmarte las opciones disponibles para tu pedido: https://wa.me/5493517565641',
    true, 'migration-030', 'migration-030'),
  ('catalogo', 'catalogo',
    E'Te comparto nuestros catálogos vigentes:\n\n*Mayorista:* https://drive.google.com/file/d/10ooMXAHcm1RL6aILFKq8rsNXsZHQy1CP/view?usp=sharing\n*Minorista:* https://drive.google.com/file/d/1_mQxhP0oKDIJdBonfHSD2YudV3pqtHRQ/view?usp=sharing\n\nPara consultar un producto, precio o disponibilidad puntual, escribile a Mauricio: https://wa.me/5493517565641',
    true, 'migration-030', 'migration-030'),
  ('problema-catalogo', 'problema-catalogo',
    'Probá abrir el catálogo desde el navegador de tu celular, como Chrome o Safari. Si sigue sin abrir, Mauricio puede enviarte la lista por otra vía: https://wa.me/5493517565641',
    true, 'migration-030', 'migration-030'),
  ('consultas-productos', 'consultas-productos',
    'Para confirmar productos, marcas, presentaciones, precios, promociones, unidades por caja o stock actualizado, escribile directamente a Mauricio, nuestro asesor comercial: https://wa.me/5493517565641',
    true, 'migration-030', 'migration-030'),
  ('pedidos', 'pedidos',
    'Para armar tu pedido, elegí «Nuevo Pedido» (opción 4) y enviá la lista completa con cantidades, productos y marcas. La compra mínima es de 1/2 horma en adelante.',
    true, 'migration-030', 'migration-030'),
  ('reclamos', 'reclamos',
    'Lamentamos el inconveniente y entendemos tu molestia. Para revisar tu caso y solucionarlo, comunicate directamente con Mauricio, nuestro asesor comercial: https://wa.me/5493517565641',
    true, 'migration-030', 'migration-030'),
  ('asesor', 'asesor',
    '¡Por supuesto! Podés comunicarte directamente con Mauricio, nuestro asesor comercial: https://wa.me/5493517565641',
    true, 'migration-030', 'migration-030'),
  ('proveedores', 'proveedores',
    'Este canal es exclusivo para atención a clientes y ventas de Distribuidora Abasto del Campo. Para propuestas comerciales, postulaciones laborales o solicitudes institucionales, comunicate con Mauricio: https://wa.me/5493517565641',
    true, 'migration-030', 'migration-030'),
  ('consulta-general', 'consulta-general',
    'Este canal atiende consultas de Distribuidora Abasto del Campo. Puedo ayudarte con horarios, ubicación, envíos, catálogo, pedidos o derivarte con un asesor comercial.',
    true, 'migration-030', 'migration-030'),
  ('pregunta-no-entendible', 'pregunta-no-entendible',
    E'No llegué a comprender bien tu consulta. ¿Podés escribirla de otra forma?\n\nSi preferís, podés hablar con Mauricio, nuestro asesor comercial: https://wa.me/5493517565641',
    true, 'migration-030', 'migration-030')
ON CONFLICT (normalized_name) DO UPDATE SET
  answer = CASE
    WHEN btrim(ai_answer_labels.answer) = '' THEN EXCLUDED.answer
    ELSE ai_answer_labels.answer
  END,
  active = CASE
    WHEN btrim(ai_answer_labels.answer) = '' THEN EXCLUDED.active
    ELSE ai_answer_labels.active
  END,
  updated_by = CASE
    WHEN btrim(ai_answer_labels.answer) = '' THEN EXCLUDED.updated_by
    ELSE ai_answer_labels.updated_by
  END,
  updated_at = CASE
    WHEN btrim(ai_answer_labels.answer) = '' THEN now()
    ELSE ai_answer_labels.updated_at
  END;

-- Remove the obsolete product-search configurations while preserving their
-- historical questions and audit trail under the new advisor-only category.
WITH canonical AS (
  SELECT id FROM ai_answer_labels WHERE normalized_name = 'consultas-productos'
), obsolete AS (
  SELECT id FROM ai_answer_labels
  WHERE normalized_name IN ('productos', 'stock', 'unidades-por-caja', 'ofertas')
)
UPDATE ai_query_logs q
SET matched_label_id = CASE WHEN q.matched_label_id IN (SELECT id FROM obsolete) THEN (SELECT id FROM canonical) ELSE q.matched_label_id END,
    suggested_label_id = CASE WHEN q.suggested_label_id IN (SELECT id FROM obsolete) THEN (SELECT id FROM canonical) ELSE q.suggested_label_id END,
    suggested_label_name = CASE WHEN q.suggested_label_id IN (SELECT id FROM obsolete) OR lower(COALESCE(q.suggested_label_name, '')) IN ('productos', 'stock', 'unidades-por-caja', 'ofertas') THEN 'consultas-productos' ELSE q.suggested_label_name END,
    updated_at = now()
WHERE q.matched_label_id IN (SELECT id FROM obsolete)
   OR q.suggested_label_id IN (SELECT id FROM obsolete)
   OR lower(COALESCE(q.suggested_label_name, '')) IN ('productos', 'stock', 'unidades-por-caja', 'ofertas');

-- Retire old product-search rules from the response pipeline without deleting
-- their IDs or aliases, which remain useful for historical audit records.
WITH canonical AS (
  SELECT id FROM ai_answer_labels WHERE normalized_name = 'consultas-productos'
), obsolete AS (
  SELECT id FROM ai_answer_labels
  WHERE normalized_name IN ('productos', 'stock', 'unidades-por-caja', 'ofertas')
)
UPDATE ai_answer_rules
SET label_id = (SELECT id FROM canonical),
    active = false,
    updated_by = 'migration-030',
    updated_at = now()
WHERE label_id IN (SELECT id FROM obsolete);

DELETE FROM ai_answer_labels
WHERE normalized_name IN ('productos', 'stock', 'unidades-por-caja', 'ofertas');

-- Fold the old empty "more information" bucket into the canonical business
-- information answer so every visible category has a usable Jev response.
WITH canonical AS (
  SELECT id FROM ai_answer_labels WHERE normalized_name = 'informacion'
), obsolete AS (
  SELECT id FROM ai_answer_labels WHERE normalized_name = 'mas-informacion'
)
UPDATE ai_query_logs q
SET matched_label_id = CASE WHEN q.matched_label_id IN (SELECT id FROM obsolete) THEN (SELECT id FROM canonical) ELSE q.matched_label_id END,
    suggested_label_id = CASE WHEN q.suggested_label_id IN (SELECT id FROM obsolete) THEN (SELECT id FROM canonical) ELSE q.suggested_label_id END,
    suggested_label_name = CASE WHEN q.suggested_label_id IN (SELECT id FROM obsolete) OR lower(COALESCE(q.suggested_label_name, '')) = 'mas-informacion' THEN 'informacion' ELSE q.suggested_label_name END,
    updated_at = now()
WHERE q.matched_label_id IN (SELECT id FROM obsolete)
   OR q.suggested_label_id IN (SELECT id FROM obsolete)
   OR lower(COALESCE(q.suggested_label_name, '')) = 'mas-informacion';

WITH canonical AS (
  SELECT id FROM ai_answer_labels WHERE normalized_name = 'informacion'
), obsolete AS (
  SELECT id FROM ai_answer_labels WHERE normalized_name = 'mas-informacion'
)
UPDATE ai_answer_rules
SET label_id = (SELECT id FROM canonical),
    active = false,
    updated_by = 'migration-030',
    updated_at = now()
WHERE label_id IN (SELECT id FROM obsolete);

DELETE FROM ai_answer_labels
WHERE normalized_name = 'mas-informacion';

-- Clean wording left in the old generic/order drafts so no visible answer
-- promises a product lookup after Jev is introduced.
UPDATE ai_answer_labels
SET answer = CASE normalized_name
    WHEN 'pedidos' THEN 'Para armar tu pedido, elegí «Nuevo Pedido» (opción 4) y enviá la lista completa con cantidades, productos y marcas. La compra mínima es de 1/2 horma en adelante.'
    WHEN 'compra-minima' THEN 'La compra mínima es de 1/2 horma en adelante. Si necesitás confirmar una presentación o cantidad de un producto, podés consultarle a Mauricio: https://wa.me/5493517565641'
    WHEN 'consulta-general' THEN 'Este canal atiende consultas de Distribuidora Abasto del Campo. Puedo ayudarte con horarios, ubicación, envíos, catálogo, pedidos o derivarte con un asesor comercial.'
    ELSE answer
  END,
  updated_by = 'migration-030',
  updated_at = now()
WHERE normalized_name IN ('pedidos', 'compra-minima', 'consulta-general');
