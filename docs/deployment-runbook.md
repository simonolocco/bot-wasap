# Despliegue y rollback

Ventana aprobada: 02:00–05:00 ART. Requiere aprobación explícita del informe QA.

## Antes de desplegar

1. Ejecutar `npm run production:preflight` y confirmar la suite completa verde y staging restaurado.
2. Asignar tags inmutables `APP_IMAGE_TAG` y `POSTGRES_IMAGE_TAG`; registrar digest y commit.
3. Guardar el tag actualmente desplegado como rollback.
4. Ejecutar backup físico WAL-G, forzar un WAL switch y confirmar que el archivo llegó al bucket.
5. Verificar última copia de multimedia y espacio libre.
6. Confirmar que las migraciones nuevas son aditivas y compatibles con la imagen anterior.

## Despliegue

1. Subir el paquete versionado sin `.env`, datos personales ni secretos.
2. Construir o descargar las imágenes con sus tags inmutables.
3. Ejecutar migraciones una sola vez y abortar ante cualquier error.
4. Recrear app y worker; recrear PostgreSQL sólo cuando el cambio WAL-G esté aprobado y haya backup recuperable.
5. Ejecutar `npm run production:smoke` y verificar dashboard operacional, worker heartbeat, cola, último backup y `pg_stat_archiver`.
6. Ejecutar smoke test WhatsApp con el número dedicado: saludo, menú, pedido, asesor, texto y archivo; localizar y responder desde el panel.
7. Observar durante una hora y revisar otra vez a las 24 horas.

## Rollback inmediato

Volver a los tags anteriores si aparece pérdida, duplicación, cola bloqueada, migración fallida, archivos inaccesibles o regresión crítica. Como las migraciones 014/015 son aditivas, la imagen anterior puede funcionar sin revertir esquema. No borrar tablas ni datos durante rollback.

Después del rollback: comprobar integridad, drenar cola con una sola versión de worker, repetir smoke y documentar el incidente antes de un nuevo intento.
