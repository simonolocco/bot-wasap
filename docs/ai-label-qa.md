# QA de respuestas y aprendizaje de IA

Esta guía valida el flujo local sin enviar mensajes reales por WhatsApp ni activar producción.

## Criterio funcional

Responder y aprender son operaciones independientes. Con IA activa, una pregunta nueva se responde aunque sea la primera vez que aparece. La etiqueta y la frecuencia sólo permiten reutilizar conocimiento seguro en consultas futuras.

| Caso | Resultado esperado |
| --- | --- |
| Pregunta nueva y entendible | Se usa la IA y se envía texto no vacío; no cae en `pregunta-no-entendible`. |
| Regla exacta o alias | Se usa la respuesta aprobada, se registra el resultado real y no se llama al proveedor. |
| Etiqueta semántica aprobada | Se usa su respuesta y la nueva variante puede guardarse como alias en producción. |
| Tema aislado | Se conserva el tema sugerido, pero su baja frecuencia no bloquea la respuesta ni crea un fallback. |
| Empate entre etiquetas | Queda sin etiqueta automática; la IA igualmente responde. |
| Error 429, timeout o proveedor | Resultado `unavailable`, respuesta de contingencia no vacía y vista “Errores”. |
| Signos, números o teclado aleatorio | Categoría interna de ruido; nunca aparece como etiqueta reutilizable. |
| Saludo con typo | Respuesta cordial; nunca se marca como ruido. |
| `Sí`, `Ok` o `Dale` tras una pregunta | Usa el historial y no se descarta como silencio. |
| Prueba manual | Usa el mismo resolvedor de producción, queda en “Pruebas” y no crea reglas. |
| IA apagada | Las reglas aprobadas funcionan; una pregunta nueva no llama al proveedor y queda “Por revisar”. |
| Resolver un fallback histórico | Sólo resuelve la fila elegida; jamás agrupa todas las preguntas del fallback. |
| Marcar como ruido | Mueve una sola consulta a “Ruido”; “Volver a revisión” quita esa categoría. |
| Eliminar una etiqueta | Sus consultas pendientes quedan sin tema, no pasan al fallback. |
| Toggle o pausa durante generación | La respuesta terminada no se envía si cambió el estado operativo. |

## Vistas del panel

- **Por revisar:** preguntas retenidas por estado operativo o una decisión pendiente.
- **Respondidas:** historial real de respuestas a clientes.
- **Errores:** consultas entendibles con contingencia del proveedor.
- **Ruido:** sólo mensajes sin significado recuperable.
- **Pruebas:** ejecuciones manuales sin efecto sobre el conocimiento.

Cada fila muestra por separado el resultado del cliente, el estado de revisión, el tema sugerido, la confianza y los detalles técnicos necesarios para diagnosticar.

## Prueba rápida

1. Ejecutar `npm run test:ai:routing` para verificar el contrato de respuesta primero.
2. Ejecutar `npm run test:ai:labels` y `npm run test:ai:label-frequency`.
3. Ejecutar `npm run test:ai:policy` y `npm run test:bot`.
4. Ejecutar `npm run replay:corpus` para cubrir el corpus histórico sin inferencia externa.
5. Ejecutar `npm run test:ai:admin-ui` para revisar escritorio, móvil, tabs y acciones.
6. Con una base aislada, aplicar migraciones y ejecutar `npm run test:ai:db`.
