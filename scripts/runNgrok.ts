import 'dotenv/config';
import { connect } from '@ngrok/ngrok';

async function startTunnel() {
  const authtoken = process.env.NGROK_AUTHTOKEN;
  if (!authtoken) {
    console.error('[ngrok] Falta la variable NGROK_AUTHTOKEN en .env');
    process.exit(1);
  }

  const port = Number(process.env.CLOUD_PORT ?? '4002');
  try {
    const listener = await connect({ addr: port, authtoken });
    console.log(`[ngrok] Tunnel activo para http://localhost:${port}`);
    console.log(`[ngrok] URL pública: ${listener.url()}`);
    console.log('[ngrok] Deja este proceso corriendo mientras uses el webhook.');
    const shutdown = async () => {
      console.log('[ngrok] Cerrando túnel...');
      await listener.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    setInterval(() => {
      /* mantener proceso vivo */
    }, 1e6);
  } catch (error) {
    console.error('[ngrok] Error creando el túnel:', error);
    process.exit(1);
  }
}

startTunnel();
