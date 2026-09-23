-- Keep the visible approved labels in sync with Jev's catalog-first reply.
-- Only replace the original stock copy; preserve operator-edited answers.
UPDATE ai_answer_labels
SET answer = E'Podés buscar el producto y consultar su precio en nuestros catálogos:\n\nMayorista: https://drive.google.com/file/d/10ooMXAHcm1RL6aILFKq8rsNXsZHQy1CP/view?usp=sharing\nMinorista: https://drive.google.com/file/d/1_mQxhP0oKDIJdBonfHSD2YudV3pqtHRQ/view?usp=sharing\n\nSi no encontrás el producto o el precio en los catálogos, escribile a Mauricio, nuestro asesor comercial: https://wa.me/5493517565641',
    updated_by = 'migration-032',
    updated_at = now()
WHERE normalized_name = 'consultas-productos'
  AND answer = 'Para confirmar productos, marcas, presentaciones, precios, promociones, unidades por caja o stock actualizado, escribile directamente a Mauricio, nuestro asesor comercial: https://wa.me/5493517565641';

UPDATE ai_answer_labels
SET answer = E'Podés buscar el producto y consultar su precio en nuestros catálogos:\n\nMayorista: https://drive.google.com/file/d/10ooMXAHcm1RL6aILFKq8rsNXsZHQy1CP/view?usp=sharing\nMinorista: https://drive.google.com/file/d/1_mQxhP0oKDIJdBonfHSD2YudV3pqtHRQ/view?usp=sharing\n\nSi no encontrás el producto o el precio en los catálogos, escribile a Mauricio, nuestro asesor comercial: https://wa.me/5493517565641',
    updated_by = 'migration-032',
    updated_at = now()
WHERE normalized_name = 'catalogo'
  AND answer = E'Te comparto nuestros catálogos vigentes:\n\n*Mayorista:* https://drive.google.com/file/d/10ooMXAHcm1RL6aILFKq8rsNXsZHQy1CP/view?usp=sharing\n*Minorista:* https://drive.google.com/file/d/1_mQxhP0oKDIJdBonfHSD2YudV3pqtHRQ/view?usp=sharing\n\nPara consultar un producto, precio o disponibilidad puntual, escribile a Mauricio: https://wa.me/5493517565641';
