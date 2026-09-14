-- Business copy approved in September 2026. The menu itself is appended by
-- the response pipeline, so saved answers no longer need a [[MENU]] marker.
WITH approved(normalized_name, answer) AS (
  VALUES
    ('minorista', E'Atendemos tanto a clientes mayoristas como minoristas. La compra mínima es de 1/2 horma en adelante.'),
    ('compra-minima', E'La compra mínima es de 1/2 horma en adelante. Podés indicarnos qué producto buscás para ayudarte con la presentación disponible.'),
    ('pedidos', E'Para armar el pedido, elegí «Nuevo Pedido» (opción 4) y enviá la lista con cantidades, productos y marcas. La compra mínima es de 1/2 horma en adelante.')
)
UPDATE ai_answer_labels label
SET answer=approved.answer,
    updated_by='migration-028',
    updated_at=now()
FROM approved
WHERE label.normalized_name=approved.normalized_name;
