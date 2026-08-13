# Restauración de AbastoBot en staging

Este procedimiento es exclusivamente para una VPS de staging vacía. Nunca restaurar encima de producción.

## Prerrequisitos

- Bucket S3/R2 privado accesible con credenciales temporales o de mínimo privilegio.
- Imagen PostgreSQL versionada que contiene WAL-G.
- Copia de `.env` de staging sin secretos en Git.
- Multimedia en bucket privado y manifiesto/checksums disponibles.
- Fecha/hora objetivo en UTC para la recuperación.

## Restauración física y WAL

1. Detener app y worker de staging para impedir escrituras.
2. Crear un volumen PostgreSQL nuevo y vacío; conservar el anterior hasta aprobar la comparación.
3. Configurar `WALG_S3_PREFIX`, endpoint, región y credenciales.
4. Ejecutar `wal-g backup-fetch <PGDATA> LATEST` dentro de la imagen PostgreSQL.
5. Para recuperación a un punto, crear `recovery.signal` y definir `restore_command = 'wal-g wal-fetch %f %p'` y `recovery_target_time` en UTC.
6. Iniciar únicamente PostgreSQL y esperar a que finalice recovery.
7. Ejecutar migraciones sólo si la versión de app que se probará las requiere.
8. Restaurar o precargar multimedia desde el bucket privado; no hacer público el bucket.
9. Iniciar worker y app de staging, luego `/readyz` y smoke tests.

## Validación obligatoria

- Comparar conteos de contactos, mensajes, webhooks, trabajos, tickets, pedidos y activos multimedia.
- Comprobar cero mensajes huérfanos y cero provider IDs duplicados.
- Comparar checksums de una muestra determinística de multimedia y entidades.
- Confirmar que la última transacción disponible esté a menos de cinco minutos del punto de fallo simulado.
- Registrar inicio/fin en `backup_runs` con `kind='restore'`, RPO medido, RTO y evidencia.
- Abrir conversaciones antiguas, descargar archivos autenticado y ejecutar un mensaje sintético de punta a punta.

## Rechazo

Descartar la restauración si hay diferencias de conteo/checksum, WAL faltante, objetos multimedia ausentes, migración fallida o RPO mayor a cinco minutos. Conservar logs y no promover esa copia.
