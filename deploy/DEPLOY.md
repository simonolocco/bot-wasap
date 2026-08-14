# Despliegue en Hostinger VPS

La interfaz se construye con React/Vite dentro de la imagen y Express sigue sirviendo el panel y las APIs en el mismo puerto. En producción, los archivos de WhatsApp se guardan de forma privada en el bucket S3/R2 y el volumen Docker `media_data` funciona como caché; nunca se exponen como URLs públicas.

1. Instalá Docker y Docker Compose en Ubuntu, creá un usuario no root y abrí sólo los puertos 80, 443 y SSH.
2. Configurá un hostname público que apunte a la IP de la VPS. Puede ser un dominio propio o uno gratuito, por ejemplo `mi-bot.duckdns.org` en DuckDNS. Colocalo como `PUBLIC_DOMAIN` en `.env`.
3. Copiá `.env.example` a `.env`, completá los secretos y generá `ADMIN_PASSWORD_HASH` con `npm run password:hash -- "contraseña"` en una máquina segura.
4. Ejecutá `npm run production:preflight`. El despliegue se bloquea si Meta, los tags inmutables, S3, backups o WAL todavía no están configurados de forma segura.
5. Construí e inicializá: `docker compose --profile production up -d --build`. El perfil de producción inicia Caddy, el backup lógico, el backup físico WAL-G y el archivado continuo de PostgreSQL. El servicio `migrate` aplica el esquema automáticamente antes de iniciar app y worker.
6. Ejecutá `npm run production:smoke` y confirmá que HTTPS, salud, panel privado y webhook estén correctos.
7. Copiá también la carpeta local `data` al directorio del proyecto en la VPS y ejecutá una sola vez `docker compose --profile tools run --rm legacy-import`. Importa los JSON existentes sin duplicarlos si necesitás repetirlo.
8. Configurá en Meta `https://mi-bot.duckdns.org/webhook` y el mismo `META_VERIFY_TOKEN`.
9. Verificá `https://mi-bot.duckdns.org/readyz` y entrá al panel por `https://mi-bot.duckdns.org`.

## Operación segura

En producción configurá `WHATSAPP_TRANSPORT=cloud`. En local y staging mantené `WHATSAPP_TRANSPORT=mock`, aunque existan tokens reales en el entorno. Después de cada deploy, reiniciá `app` y `worker` para aplicar la migración 013 y el límite de 120 segundos para eventos atrasados.

## Prueba local

1. Copiá `.env.example` a `.env` y completá como mínimo `POSTGRES_PASSWORD`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `META_VERIFY_TOKEN` y `META_APP_SECRET`. Para probar sin WhatsApp real, usá valores aleatorios en las variables de Meta.
2. Generá el hash: `npm run password:hash -- "una contraseña local"` y pegá el resultado en `ADMIN_PASSWORD_HASH`.
3. Ejecutá `docker compose -f docker-compose.yml -f docker-compose.local.yml up --build`.
4. Abrí `http://localhost:4002`, iniciá sesión y probá el panel. Para detenerlo: `docker compose -f docker-compose.yml -f docker-compose.local.yml down`.

Para probar mensajes reales de Meta desde tu PC, necesitás una URL HTTPS temporal; podés usar Cloudflare Quick Tunnel sólo para desarrollo. No sirve como URL definitiva del webhook.

## Backups

El backup lógico incluye PostgreSQL. Si `MEDIA_STORAGE_DRIVER=local`, también incluye un archivo `*.media.tar.gz` del volumen `media_data`. Si `MEDIA_STORAGE_DRIVER=s3`, los archivos ya están guardados individualmente en R2 bajo `MEDIA_S3_PREFIX` y no se duplican dentro de cada backup. PostgreSQL conserva el `storage_key` de cada archivo y mantiene la asociación.

Creá un bucket S3-compatible privado y una cuenta con acceso sólo a ese bucket. Cloudflare R2 sirve para esto sin que tengas un dominio. El perfil `production` activa automáticamente tanto el backup lógico como WAL-G; el perfil `backup` permite iniciarlos por separado. El servicio genera una copia diaria y duplica la del domingo en la carpeta semanal. En R2 configurá dos reglas de ciclo de vida para los prefijos `abastobot/daily/` (7 días) y `abastobot/weekly/` (35 días); [s3-lifecycle.json](s3-lifecycle.json) deja los valores de referencia. WAL-G conserva las dos cadenas físicas más recientes y elimina las anteriores de manera segura. El backup lógico actual es SQL comprimido: restauralo con `gzip -dc archivo.sql.gz | psql ...` y `ON_ERROR_STOP=1`, no con `pg_restore`.
