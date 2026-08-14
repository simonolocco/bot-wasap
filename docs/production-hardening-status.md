# Estado del paso a producción de AbastoBot

Última actualización: 2026-08-14 (ART)

Este documento permite continuar el trabajo sin repetir la auditoría. No contiene contraseñas, tokens, claves privadas ni datos de clientes.

## Objetivo

Dejar AbastoBot listo para recibir aproximadamente 500 contactos por día, conservar todas las conversaciones y archivos, mantener WhatsApp operativo sin depender de Gemini y disponer de backups restaurables fuera de la VPS.

## Estado actual de producción

- URL pública: `https://abasto-bot.cloud`.
- VPS: Hostinger, proyecto en `/opt/abastobot`.
- Producción activa y saludable:
  - app y worker: `abastobot-app:7f373b2`;
  - PostgreSQL: `abastobot-postgres:dba9e12`;
  - backup lógico, WAL-G y Caddy: activos.
- `/healthz`, `/readyz` y `/` responden HTTP 200.
- El panel anónimo responde 401, HSTS está presente y `X-Frame-Options` es `DENY`.
- La verificación pública del webhook de Meta funciona con el token reforzado.
- La base y las conversaciones se conservaron.
- Flujo final del menú:
  - primer contacto o saludo explícito: saludo y menú inicial;
  - después de responder horarios, dirección, precios, asesor o finalizar un pedido: menú de seguimiento con “¿En qué más podemos ayudarte?” y acceso al Asesor Humano.

## Capacidad y pruebas completadas

- Suite unitaria: verde.
- Integración PostgreSQL: verde.
- E2E: 6/6.
- Pruebas visuales: 8/8.
- Auditoría npm: 0 vulnerabilidades.
- Presupuesto del frontend: JS 69 KB gzip, CSS 8 KB gzip.
- Prueba de carga: 1.000 contactos y 5.000 mensajes, con duplicados y ráfaga de 50; sin fallos transitorios. Supera el objetivo de 500 contactos diarios.
- Restauración aislada probada anteriormente con los mismos conteos de contactos, mensajes, webhooks y pedidos, sin mensajes huérfanos.

## Cloudflare R2

- Suscripción R2 activa.
- Bucket privado: `abastobot-production`.
- Acceso público desactivado.
- Ciclo de vida configurado:
  - `abastobot/daily/`: eliminación después de 7 días;
  - `abastobot/weekly/`: eliminación después de 35 días;
  - `abastobot/media/`: sin vencimiento automático.
- La credencial anterior fue reemplazada mediante **Roll** en Cloudflare, por lo que sus valores anteriores ya no sirven.
- La credencial nueva tiene permiso **Object Read & Write** limitado exclusivamente a `abastobot-production`.
- La clave nueva no está en Git ni en este documento.
- Configuración candidata privada en la VPS: `/opt/abastobot/releases/.env.candidate-dba9e12`, permiso 600. Contiene la nueva credencial R2.
- La configuración actualmente activa del bot anterior no debe usarse como fuente para R2; el archivo candidato es la fuente correcta para el próximo intento.

## Backups

- Se creó y restauró una copia local previa al trabajo.
- R2 aceptó escritura, lectura y borrado de un objeto de prueba.
- Existe al menos un dump lógico real en R2:
  - `abastobot/daily/2026-08-14T14-25-42Z.dump.gz`;
  - tamaño aproximado: 102 KB;
  - quedó registrado como `succeeded` en `backup_runs`.
- Dos intentos anteriores también subieron archivos, pero dejaron filas `running` por errores del script. Esas filas deben marcarse `failed` con una explicación operativa; no representan pérdida de datos.
- Se corrigieron dos defectos encontrados al probar el backup real:
  1. sustitución de variables de `psql` al actualizar `backup_runs`;
  2. captura del UUID junto al texto `INSERT 0 1`.
- El script corregido se verificó en Linux y una copia completa terminó y se registró correctamente.
- El backup lógico no duplica los archivos cuando `MEDIA_STORAGE_DRIVER=s3`; las imágenes quedan guardadas una sola vez bajo `abastobot/media/`.
- WAL-G conservará dos cadenas físicas completas y eliminará las anteriores de manera segura.

## Versiones creadas

- `24ab26d`: endurecimiento inicial, preflight, smoke y backups automáticos.
- `c0b3250`: corrección del registro de estado de backups.
- `dba9e12`: validación y captura correcta del UUID de cada backup. Es la candidata actual.
- Paquete candidato en la VPS: `/opt/abastobot/releases/release-dba9e12.tar`.
- Imágenes ya construidas en la VPS:
  - `abastobot-app:dba9e12`;
  - `abastobot-postgres:dba9e12`;
  - imagen actualizada de backup `abastobot-backup`.

## Prueba aislada de la candidata

Se levantó `dba9e12` en un proyecto Docker temporal separado llamado `abastobot-stage`, sin puertos públicos y con otra base vacía.

Resultados:

- PostgreSQL candidato con archivado: saludable.
- Migraciones 001 a 016: aplicadas correctamente.
- Aplicación candidata: saludable.
- Los contenedores y volúmenes temporales de staging se eliminaron al finalizar.

Esto demuestra que PostgreSQL, las migraciones y la app candidata arrancan correctamente en la misma VPS. El problema del primer intento en vivo no está en esos tres componentes.

## Rollback disponible

- App anterior activa: `abastobot-app:446a629`.
- PostgreSQL anterior activo: `abastobot-postgres:local`.
- Código previo: `/opt/abastobot/releases/pre-24ab26d-source.tar.gz`.
- Configuración de rollback: `/opt/abastobot/releases/.env.rollback-pre-dba9e12`.
- No eliminar estas imágenes ni archivos hasta completar y observar el despliegue nuevo.

## Próximos pasos exactos

El despliegue requerido quedó completado. La siguiente lista queda como procedimiento de verificación y mantenimiento; los puntos 1 a 11 fueron ejecutados el 2026-08-14.

1. Confirmar otra vez que el bot anterior sigue saludable y que no quedó ningún proyecto temporal `abastobot-stage`.
2. Extraer `release-dba9e12.tar` sobre `/opt/abastobot`.
3. Conservar una copia de `/opt/abastobot/releases/.env.candidate-dba9e12` antes de activarla.
4. Reforzar la contraseña interna de PostgreSQL y el token de verificación de Meta dentro de la configuración candidata. La rotación debe hacerse coordinada con la detención breve de app/worker.
5. Copiar la configuración candidata a `/opt/abastobot/.env` y ejecutar el validador compilado mediante Docker Compose, para que el hash bcrypt sea interpretado igual que en producción.
6. Recrear primero PostgreSQL candidato y esperar `healthy`.
7. Ejecutar migraciones.
8. Iniciar app y worker; esperar que app quede `healthy`.
9. Iniciar backup lógico, WAL-G y Caddy por separado, capturando el error de cada servicio. Evitar un único `up` de todos los servicios hasta conocer cuál provocó el rollback anterior.
10. Verificar:
    - `/healthz`, `/readyz` y raíz por HTTPS;
    - panel anónimo devuelve 401;
    - cabeceras de seguridad;
    - verificación del webhook de Meta;
    - app/worker con imagen `dba9e12`;
    - PostgreSQL con `archive_mode=on`;
    - `pg_stat_archiver` sin fallos;
    - último backup lógico `succeeded`;
    - último backup físico WAL-G `succeeded`;
    - cola sin trabajos atascados.
11. Descargar desde R2 el dump nuevo y restaurarlo en una base temporal aislada; comparar conteos y eliminar solamente ese entorno temporal.
12. Mantener las imágenes de rollback durante la observación inicial.

## Resultado final verificado

- PostgreSQL: `archive_mode=on`.
- Archivador: 5 WAL archivados, 0 fallos al momento del control.
- Último backup lógico: `succeeded` en R2.
- Último backup físico WAL-G: `succeeded` en R2.
- Cola activa: 0.
- Worker heartbeat: reciente.
- Errores recientes en app, worker, PostgreSQL, backup y WAL-G: 0.
- Espacio libre de VPS: aproximadamente 37 GB.
- Restauración real descargada desde R2 en una base aislada:
  - 533 contactos;
  - 276 mensajes;
  - 118 webhooks;
  - 34 pedidos;
  - 0 mensajes huérfanos.
- El contenedor, volumen y archivo utilizados para esa restauración se eliminaron al finalizar.

## Corrección de PDF con texto (2026-08-14)

- La bandeja ahora envía el texto escrito junto al PDF como descripción del mismo mensaje de WhatsApp.
- El servidor también recupera ese texto aunque un cliente anterior no envíe explícitamente el campo de descripción.
- La misma descripción queda guardada en PostgreSQL para visualizarla y reintentar el envío sin perderla.
- El límite de descripción para archivos es de 1024 caracteres, acorde al envío multimedia de WhatsApp.

## Lista minorista (2026-08-14)

- Enlace público vigente: `https://drive.google.com/file/d/1_mQxhP0oKDIJdBonfHSD2YudV3pqtHRQ/view`.
- El acceso anónimo y la descarga del archivo fueron verificados antes del despliegue.
- Para conservar el mismo enlace, reemplazar el contenido desde **Administrar versiones** en Google Drive; no eliminar ni crear otro archivo.

## Cambio de opción durante un pedido (2026-08-14)

- Si el cliente inicia “Nuevo Pedido” y luego elige otra opción del menú, el pedido pendiente se cancela.
- El bot responde inmediatamente a la nueva opción elegida, por ejemplo horarios, precios o asesor humano.
- La detección funciona tanto con el identificador interno del botón como cuando Meta entrega solamente el texto visible de la opción.
- Un texto normal con productos continúa procesándose como pedido.

## Métrica de contactos del panel (2026-08-14)

- La tarjeta que mostraba “Nuevas” usaba el total histórico de contactos, por lo que su etiqueta era incorrecta.
- Ahora se muestra como **Contactos registrados** y conserva el acceso directo al listado de contactos.
- Se actualizó tanto el panel principal como la vista alternativa del resumen.

## Gestión de contactos del panel (2026-08-14)

- La vista **Contactos** permite descargar toda la lista visible en un CSV; respeta la búsqueda y el filtro de consentimiento activos.
- **Agregar contacto** permite cargar un teléfono y un nombre comercial, incluso antes de que ese número escriba por WhatsApp.
- El nombre comercial también se puede editar desde la ficha del contacto y queda guardado en PostgreSQL.
- La creación manual requiere sesión de administrador y queda registrada en la auditoría.

## Reglas de seguridad para continuar

- Nunca imprimir `.env`, claves R2, secretos de Meta, contraseñas ni datos de clientes.
- No guardar secretos en Git.
- No borrar volúmenes o contenedores fuera de proyectos temporales con nombres validados.
- Si falla un paso, mantener o restaurar `446a629` y `abastobot-postgres:local` antes de seguir investigando.
- La IA/Gemini no forma parte del camino crítico del bot y no es necesaria para los menús, carrito, pedidos, soporte ni respuestas predefinidas.
