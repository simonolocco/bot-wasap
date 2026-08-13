# Documentación del Bot de Comprobantes

Es un monolito simple desarrollado en JavaScript que automatiza la descarga, análisis (OCR por IA) y conciliación bancaria de comprobantes de transferencia.

## Arquitectura
* **Backend**: Node.js con Express + Socket.io (para comunicación en tiempo real).
* **Frontend**: HTML, CSS y JS básico (Vanilla).
* **Bot de WhatsApp**: Integrado localmente a través de la librería `@whiskeysockets/baileys` (se conecta localmente, no requiere API oficial de Meta).
* **Procesamiento de imágenes**: Utiliza Inteligencia Artificial a través de OpenRouter (`google/gemini-2.5-flash`).
* **Base de datos**: Supabase (PostgreSQL) en la nube.

## Requisitos
* Tener instalado **Node.js** y **npm** o **pnpm** (mejor).
* Un puerto libre en el VPS (por ejemplo, el `3000`) para levantar el panel web.
* Permisos de lectura y escritura en el disco para dos directorios clave:
  * `/auth_info`: Almacena la credencial de la sesión de WhatsApp (evita tener que escanear el QR cada vez que se reinicie el servicio).
  * `/media`: Guarda temporalmente las imágenes y PDFs descargados de los comprobantes.

## Implementación
1. Clonar el repositorio e instalar paquetes:
   ```bash
   pnpm install
   ```
2. Crear el archivo `.env` en la raíz y configurar las variables de entorno (claves de Supabase, OpenRouter API y el JID del grupo).
3. Iniciar el servicio con PM2 para dejarlo corriendo de fondo:
   ```bash
   pm2 start server.js --name "whatsapp-invoice-bot"
   ```
4. Abrir el Dashboard en el navegador (puerto 3000) y vincular la cuenta de WhatsApp escaneando el código QR.
