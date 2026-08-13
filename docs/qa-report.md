# Informe QA integral de AbastoBot

Fecha de campaña: 13 de agosto de 2026 (ART)

Rama: `codex/qa-hardening`
Punto de rollback previo: `8bb4b1f` (`codex/pre-qa-snapshot`)

## Estado ejecutivo

El candidato local está compilado y pasó pruebas unitarias, integración PostgreSQL, HTTP/panel, visuales, carga, histórico anual y recuperación ante reinicios de app, worker y PostgreSQL. Producción fue auditada sólo en lectura y continúa funcionando sin cambios.

La liberación permanece **bloqueada** hasta completar los prerrequisitos externos y recibir aprobación: VPS de staging separada, bucket S3/R2 privado, número de WhatsApp dedicado, acceso seguro al panel y prueba real de restauración WAL-G. No se certifica RPO ≤5 minutos hasta ejecutar esa restauración desde el almacenamiento real.

## Producción observada, sin modificaciones

- Dominio: `https://abasto-bot.cloud`.
- Contenedores app, worker, PostgreSQL y Caddy activos; app saludable y reinicios en cero.
- PostgreSQL 16.14, base de aproximadamente 10 MB.
- Foto de integridad: 532 contactos, 214 mensajes, 93 webhooks, 33 pedidos y 3 tickets.
- Cero provider IDs duplicados, cero mensajes huérfanos y cero eventos entrantes sin mensaje.
- `/healthz` y `/readyz`: HTTP 200; `/api/dashboard` anónimo: HTTP 401.
- TLS válido hasta el 10 de noviembre de 2026.
- Brecha P1: `archive_mode=off`, sin WAL archivado, sin cron/contenedor de backup activo y sin credenciales de backup configuradas.
- Brecha P1: multimedia persistida únicamente en el volumen de la VPS; no hay almacenamiento externo configurado.
- Brecha P2: la versión desplegada aún expone `X-Powered-By` y no incluye las cabeceras endurecidas del candidato.

## Defectos encontrados y correcciones

| Severidad | Defecto | Causa | Corrección/regresión | Estado |
|---|---|---|---|---|
| P1 | Multimedia entrante podía no asociarse al mensaje | Se consultaba por ID de medio donde correspondía ID de mensaje | Lookup correcto, idempotencia por medio y soporte de video; integración verde | Corregido en candidato |
| P1 | Producción no cumple RPO ≤5 min | Sin archive mode, WAL-G ni almacenamiento configurado | Imagen WAL-G, archivado, registro de backups y runbook | Pendiente de credenciales y despliegue |
| P1 | Multimedia depende de una sola VPS | Driver local único | Driver S3/R2 privado con caché autenticada | Pendiente de credenciales y despliegue |
| P2 | Cola no drenaba en 120 s con seis carriles | Worker procesaba lotes rígidos y esperaba al trabajo más lento | Carriles continuos, índice de cola, concurrencia 16 | Corregido; 101,4 s |
| P2 | Recuperación de proceso muerto podía tardar 10 min | Stale job dependía sólo de `locked_at` | Heartbeats cada 5 s y recuperación de dueño muerto/timeout | Corregido; reinicio forzado verde |
| P2 | “Conectado” no probaba actividad real | Panel se basaba en credenciales | Salud basada en actividad, worker, cola, backup, WAL y storage | Corregido en candidato |
| P2 | Dependencia Excel vulnerable | SheetJS 0.18.5 vulnerable | Migración a ExcelJS y overrides seguros | Corregido; `npm audit` 0 |
| P2 | Cabeceras HTTP incompletas | Express/Caddy sin política explícita | Cabeceras en ambos niveles y `x-powered-by` desactivado | Corregido en candidato |
| P2 | Archivo activo podía disfrazarse mediante MIME | Se confiaba en el tipo enviado por el navegador | Firmas binarias, lista segura, SVG rechazado y Office como descarga | Corregido; regresión verde |
| P3 | Prueba visual móvil no abría el menú | El helper confundía “presente” con “visible en viewport” | Helper corregido y 8/8 regresiones verdes | Corregido |

## Resultados y criterios

### Funcional, datos y seguridad

- Unitarias de flujos del bot, tickets, rutas de archivos y edición de pedidos: verde.
- Integración PostgreSQL: redelivery secuencial y concurrente, contacto único, mensajes, video, estados fuera de orden y ausencia de huérfanos: verde.
- E2E: APIs privadas, firma HMAC, fuerza bruta, login, navegación y logout: 4/4.
- Auditoría de dependencias completa y productiva: cero vulnerabilidades conocidas.
- Imagen PostgreSQL + WAL-G 3.0.8 construida y checksum del binario validado.

### Carga objetivo

- 1.000 contactos, cinco mensajes por contacto, ráfaga 50 y 10% de reentrega.
- 5.000 eventos/mensajes únicos persistidos; cero duplicados, pérdidas, trabajos fallidos o huérfanos.
- Webhook p95 final: **336 ms** (objetivo <1.000 ms).
- Cola drenada final: **109.351 ms** (objetivo <120.000 ms).
- Pasadas confirmatorias adicionales: p95 entre 280–337 ms y drenaje entre 101.426–119.980 ms.

### Resiliencia local aislada

- Worker matado durante 2.500 mensajes: cero pérdida/duplicación; drenaje 46.075 ms.
- App reiniciada durante 1.500 mensajes: 250 fallos HTTP transitorios reentregados; cero pérdida/duplicación; drenaje 34.037 ms.
- PostgreSQL reiniciado durante 1.500 mensajes: 250 fallos transitorios reentregados; cero pérdida/duplicación; drenaje 22.748 ms.

### Histórico anual

- 183.000 contactos y 3.660.000 mensajes sintéticos.
- p95: bandeja 81 ms, búsqueda 4 ms, conversación 3 ms, paginación profunda 142 ms.
- Todos los resultados están por debajo del objetivo de 2 segundos.

### Visual

- Resoluciones: 1440×900, 1280×720, 768×1024 y 390×844.
- Chromium desktop y emulación móvil: 8/8, sin desborde horizontal.
- Evidencia local: `qa-artifacts/playwright/` y reporte `qa-artifacts/playwright-report/index.html`.

### Restauración

- Dump lógico restaurado en una base QA separada.
- Original/restaurada: 100 contactos, 1.100 mensajes, 500 webhooks y 500 trabajos.
- Checksum ordenado de teléfonos idéntico: `fa05c09923c053f76d5b7a59f57c6c1a`.
- Falta obligatoria: restaurar base física + WAL y multimedia desde S3/R2 de staging para demostrar RPO ≤5 minutos.

## Gate de salida

No desplegar mientras alguno de estos puntos siga pendiente:

1. Configurar y aislar staging.
2. Configurar bucket privado S3/R2 para WAL/backups y multimedia.
3. Ejecutar backup físico, archivar WAL y restaurar hasta un punto de recuperación.
4. Ejecutar el recorrido WhatsApp real con número dedicado.
5. Verificar el panel autenticado de producción con una cuenta facilitada de forma segura.
6. Aprobar informe, imagen versionada, migraciones y rollback.
