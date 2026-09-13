# Política de respuestas de IA — AbastoBot

Última actualización: 2026-09-13.

## Contrato principal

Cuando la IA generativa está activa, toda consulta de texto entendible recibe una salida no vacía. El recorrido es, en este orden:

1. El menú y los flujos transaccionales conservan prioridad.
2. Se busca una regla o una etiqueta aprobada por el equipo.
3. Si no existe conocimiento aprobado suficiente, `answerQuestion()` responde con datos controlados, pide una aclaración concreta, deriva al asesor o informa una indisponibilidad temporal.
4. Recién después se registra el tema y su frecuencia para aprendizaje.

La frecuencia sirve para detectar conocimiento reutilizable. Nunca decide si el cliente merece una respuesta.

## Resultados para el cliente

| Resultado | Significado |
| --- | --- |
| `answered` | Respuesta fundada en hechos del negocio, catálogo vigente o conocimiento aprobado. |
| `clarify` | Falta un dato concreto o la consulta está fuera del alcance comercial; se orienta al cliente. |
| `handoff` | La información requiere confirmación humana y se ofrece el contacto del asesor. |
| `unavailable` | Falló el proveedor de IA; se envía una respuesta de contingencia. No se clasifica como pregunta incomprensible. |
| `silence` | Sólo para reacciones, cierres u opt-out explícitos sin una pregunta pendiente. |
| `paused` | Una persona ya está atendiendo la conversación; el bot no interviene. |
| `disabled` | El interruptor generativo estaba apagado; la consulta continúa por el flujo determinístico. |

Antes de enviar una respuesta obtenida durante una llamada al proveedor, el worker vuelve a comprobar el interruptor, la pausa humana y la antigüedad del mensaje.

## Qué es “pregunta no entendible”

`pregunta-no-entendible` es una categoría interna de ruido, no una respuesta comodín. Se limita a entradas sin significado recuperable, por ejemplo:

- signos o puntuación sin palabras;
- secuencias de teclado como `asdfgh`;
- números aislados sin contexto;
- combinaciones claramente aleatorias como `asdjkahsd`.

No pertenecen a esa categoría:

- errores ortográficos (`holass`, `Asen envios`);
- preguntas comerciales nuevas;
- frases coherentes fuera del alcance del negocio;
- empates entre etiquetas;
- errores, límites o timeouts del proveedor.

La categoría de ruido no aparece en el catálogo de respuestas reutilizables y nunca puede agrupar consultas distintas como aliases.

## Contexto y silencio

`Sí`, `Ok` y `Dale` sólo cierran en silencio cuando el turno anterior no contiene una pregunta del asistente. El worker carga el historial antes de decidirlo. Si el asistente acaba de pedir un dato, la respuesta corta conserva ese contexto.

## Conocimiento aprobado y aprendizaje

- Una etiqueta representa una respuesta canónica y muchas variantes de una misma pregunta.
- El probador manual usa el mismo resolvedor que WhatsApp, pero no crea reglas ni aliases.
- Todas las respuestas de producción quedan en el historial, incluidas las resueltas por regla o etiqueta.
- Las preguntas respondidas, los errores del proveedor, el ruido y las pruebas se muestran en vistas separadas.
- Una consulta pendiente puede no tener etiqueta. El esquema no la fuerza a una etiqueta genérica.
- Sólo temas repetidos, con confianza suficiente y una respuesta canónica segura, pueden promoverse automáticamente.

## Datos controlados

El modelo interpreta intención y contexto; el servidor compone la respuesta. No se usa el campo libre `reply` del modelo para inventar precios o condiciones. Dirección, horarios, envíos, compra mínima, venta minorista, pagos, feriados e información general salen de hechos del servidor. Los precios sólo salen de un catálogo aprobado y vigente.

## Validación

Pruebas determinísticas sin red ni costo:

```text
npm run test:ai:routing
npm run test:ai:labels
npm run test:ai:label-frequency
npm run test:ai:policy
npm run test:bot
npm run replay:corpus
npm run test:ai:admin-ui
```

La prueba `test:ai:db` requiere una base aislada QA/test/staging. `replay:corpus:live` requiere credenciales y autorización de consumo; no forma parte de la validación local por defecto.
