# Prueba local de AbastoBot con IA

Esta versión está en la rama `codex/ai-preview`, en una carpeta separada del repositorio principal. No fue publicada. El simulador escucha sólo en `127.0.0.1`; no importa el cliente WhatsApp, el worker ni PostgreSQL.

## Abrir

Desde esta carpeta: `npm run ai:preview`. Luego abrir <http://127.0.0.1:4010>.

Usa `.env.local` (ver `.env.ai-preview.example`). La configuración local prevalece sobre variables heredadas del sistema. No copiar el `.env` completo de producción: la prueba sólo necesita OpenRouter y los enlaces comerciales. La clave queda fuera de Git y del navegador.

La clave de la prueba se sincronizó con `OPENROUTER_API_KEY` de `/opt/comprobantes-wa/.env`, por solicitud del usuario. La copia antigua de `invoice/.env` correspondía a otra cuenta. El modelo de conversación y lectura visual es `google/gemini-3.5-flash-lite`.

## Qué probar

- Preguntas libres: envíos, ubicación, horarios, venta minorista, información general y varias consultas en un mensaje.
- Producto y contexto: preguntar por cremoso y luego responder “mayorista”.
- Información ausente: mínimos en dinero, pagos, feriados y stock requieren confirmación del asesor. No se inventan políticas.
- Menú 1 a 6, captura de un pedido simulado y pausa “Asesor atendiendo”. No se envían ni guardan pedidos reales.
- Un error de OpenRouter produce una respuesta de contacto con el asesor y un diagnóstico en la pantalla de pruebas.

La IA interpreta intenciones y referencias del historial. El servidor compone las respuestas con información comercial existente y filas validadas del catálogo: el modelo no genera importes, enlaces ni condiciones libremente. La memoria de cada conversación de prueba está aislada por una cookie y se pierde al reiniciar; conserva hasta 12 mensajes y vence tras una hora.

## Precios y documentos

“Revisar o cargar catálogo” acepta XLSX o PDF de hasta 8 MB. El texto del PDF se extrae localmente (máximo 20 páginas); OpenRouter interpreta las filas de cada página. Se compara el conjunto de importes extraídos con todos los importes que llevan signo peso en el original, incluyendo repeticiones. Si hay diferencias se rechaza el resultado. Los PDF escaneados sin texto deben reemplazarse por una versión con texto o Excel. La extracción de filas es una operación de IA que consume saldo; no se hace por cada mensaje. Si alguna página falla no se activa un catálogo parcial.

Importar genera un borrador en el navegador. Revisar producto, marca, precio, unidad, lista, presentación y condiciones contra el documento original. La vista identifica la página o fila de origen. Completar las fechas de vigencia y activar sólo después de revisar todas las filas. Guardar como borrador mantiene los precios deshabilitados. Activar reemplaza el catálogo local anterior. Una lista puede contener precios mayoristas y minoristas, pero no se adivina cuál corresponde al cliente.

El catálogo persistido está en `storage/ai-preview/catalog.json` (ignorado por Git); se puede cambiar con `AI_CATALOG_PATH`. Un borrador, una lista vencida o una unidad/tipo de lista sin confirmar no se cotiza. Si hay varias presentaciones se solicita aclaración. La presencia de un producto no asegura stock y no confirma una compra.

El Excel incluido es histórico (octubre de 2025). Nunca se aprobó como precio actual. El PDF mayorista enlazado por el bot tiene fecha 07/09/2026 y se usa para comprobar la importación; una fecha de emisión no se transforma automáticamente en fecha de vencimiento. No activar un catálogo por el mero hecho de que la extracción terminó.

## Integración preparada para el worker

El worker incluye el mismo resolvedor que usa el probador del panel. En desarrollo se habilita con `AI_ASSISTANT_ENABLED=true`; en producción se controla desde el interruptor persistido de la sección IA. Respeta botones, comandos de menú, modo pedido, antigüedad y duplicados. Comprueba de nuevo la pausa humana, el interruptor y la antigüedad al terminar una llamada. Las salidas usan el mecanismo de envío idempotente existente.

Una pregunta entendible no depende de que su tema sea frecuente. Primero se responde mediante una regla aprobada, una etiqueta o la IA; después se registra el aprendizaje. `pregunta-no-entendible` queda reservado para ruido real. Las pruebas manuales no crean reglas y el panel separa respuestas, errores, ruido y consultas por revisar.

La pantalla local simula los efectos de menú y pedidos; no prueba la entrega real de Meta ni escribe en su base. Antes de habilitar un worker externo hace falta una base y número de prueba, y validación de entrega e idempotencia con ellos. Esta versión no transcribe audios ni genera notas de voz: el modelo elegido trabaja con texto.

## Validación

- `npm run build:server`
- `npm run test:unit` (suite existente, sin producción)
- `npm run test:ai:routing` (contrato compartido entre WhatsApp y el probador)
- `npm run test:ai:admin-ui` (panel IA en escritorio y móvil, con API simulada)
- `npm run test:ai` (22 comprobaciones: datos, separación de listas, vigencia, errores, pausa, importación completa, sesiones y controles de acceso)
- `node node_modules/ts-node/dist/bin.js scripts/testAiPreviewBrowser.ts` (Chromium y WebKit, 1440/390/320 px; datos sintéticos sin llamadas externas)
- `node node_modules/ts-node/dist/bin.js scripts/smokeAiPreview.ts` (7 consultas reales a OpenRouter; consume saldo, no usa conversaciones identificables; los precios de prueba existen sólo en memoria)

Evidencias en `qa-artifacts/ai-live-smoke.json`, `qa-artifacts/ai-browser-results.json` y capturas `qa-artifacts/ai-*.png`. Las pruebas de conversación no sustituyen una evaluación completa de todas las preguntas históricas.
