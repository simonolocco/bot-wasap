# Resumen del Bot de WhatsApp para Gemini

Este documento detalla la estructura, funcionalidad y componentes del bot de WhatsApp actual (`bot_db`), diseñado para **Distribuidora Abasto del campo**.

## 🚀 Qué es y para qué sirve
Es un asistente virtual ("AbastoBot") que funciona a través de la **WhatsApp Cloud API** (oficial de Meta). Su objetivo principal es atender a los clientes de la distribuidora de forma automática, ofreciendo información básica y permitiendo la toma de pedidos.

Reemplaza a una versión anterior basada en `whatsapp-web.js` (la cual fue deshabilitada en `src/index.ts`).

## ⚙️ Funcionalidad Principal (Menú Interactivo)
Al iniciar una conversación, el bot saluda y presenta un menú interactivo con botones (definido en `src/botMenu.ts` y gestionado en `src/cloudWebhook.ts`):

1. **📅 Horarios:** Devuelve los días y horarios de atención.
2. **📍 Dirección:** Envía la dirección del local y un link de Google Maps.
3. **💲 Precios:** Envía links a los catálogos mayorista y minorista, y adjunta un mensaje de voz (`mensaje_bot.ogg`).
4. **📝 Nuevo Pedido:** 
   - Pide al usuario que escriba su lista de productos en texto libre.
   - Guarda el pedido en estado pendiente (`data/orders.json`).
   - Envía botones de confirmación (SÍ / NO).
   - Si el usuario confirma, genera un link de `wa.me` pre-armado para que el usuario reenvíe el pedido directamente al número de WhatsApp del equipo comercial.
5. **👤 Asesor Humano:** Proporciona un link para chatear directamente con un vendedor humano.

## 📁 Estructura de Carpetas e Importancia

### `/src` (Código Fuente)
- **`cloudWebhook.ts`**: Es el corazón del bot actual. Levanta un servidor Express (por defecto en el puerto 4002) que escucha los eventos (webhooks) de la API de Cloud de WhatsApp. Procesa los mensajes entrantes, maneja los flujos (como el de tomar pedido o confirmar) y envía las respuestas.
- **`cloudClient.ts`**: Contiene las funciones para hacer las peticiones HTTP (mediante Axios) a la API de WhatsApp de Meta (enviar texto, interactivos, audios).
- **`botMenu.ts`**: Contiene todos los textos estáticos, opciones del menú interactivo, links a catálogos y lógica para normalizar texto.
- **`pedidos.ts`**: Lógica para crear, confirmar y cancelar pedidos. Guarda el estado temporal y persistente de los pedidos usando un archivo JSON.
- **`utils.ts`**: Contiene lógica muy avanzada de "NLP" (Procesamiento de Lenguaje Natural) artesanal. Tiene un `CANON` de sinónimos y errores tipográficos comunes (por ejemplo, mapéa "muzza", "mussarela" a "muzzarella"), funciones para calcular distancia de Levenshtein (corrección de errores), y extracción de unidades (kg, horma, bidon).
- **`products.ts`**: Preparado para manejar la búsqueda e inferencia de productos desde una base de datos o Excel, aunque en la versión actual de Cloud webhook no parece estar completamente integrado al flujo de pedidos de texto libre.
- **`index.ts`**: Script obsoleto que avisa que se debe usar `cloud` en vez de `dev`. `index.ts.bak` contiene el código viejo del bot no-oficial.

### `/data` (Base de Datos y Persistencia)
Aquí se guarda toda la información de estado y productos.
- **`orders.json`**: El archivo "vivo" donde `pedidos.ts` guarda los pedidos que entran. Tiene el ID, el chat ID, el detalle del texto del cliente y el estado del pedido.
- **`productos.xlsx`**: Un archivo Excel con el listado de productos, precios y marcas. Probablemente usado para popular la base de datos o actualizar el catálogo.
- **`products.db` y `orders.db`**: Bases de datos SQLite. Seguramente utilizadas por módulos anteriores o para un sistema de consulta de productos más avanzado.
- **`memory.json`**: Usado por el bot anterior (`whatsapp-web.js`) para recordar el estado de las sesiones.

### `/scripts`
- **`runNgrok.ts`**: Arranca un túnel de Ngrok en el puerto 4002. Esto es **estrictamente necesario** para que los webhooks de Meta (que están en internet) puedan llegar al bot local que corre en la computadora.

### `/public`
Almacena archivos estáticos que el bot puede enviar mediante URLs (Express los sirve en la ruta `/static`).
- **`mensaje_bot.ogg`**: Un audio pregrabado que el bot envía cuando alguien consulta la lista de precios.

## 🛠️ Scripts de npm (en `package.json`)
- **`npm run cloud`**: Levanta el bot usando la Cloud API (corre `src/cloudWebhook.ts`).
- **`npm run ngrok`**: Levanta el túnel para exponer el puerto al mundo.
- `npm run dev`: Obsoleto (usaba la versión web.js).

---
**Resumen para Gemini:** "Gemini, este bot es un asistente de ventas para una distribuidora. Usa la API oficial de WhatsApp (Cloud API) con un menú interactivo. La toma de pedidos es por texto libre que el cliente confirma y luego reenvía a un vendedor. Cuenta con utilidades de NLP avanzadas en `utils.ts` para entender variaciones de nombres de quesos y fiambres, y guarda el estado en `/data/orders.json`. Corre localmente apoyado en ngrok."
