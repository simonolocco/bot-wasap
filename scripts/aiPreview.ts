import dotenv from 'dotenv';
// Only this local file is loaded. Never load the production .env for this process.
if (process.env.NODE_ENV === 'production') throw new Error('La prueba no se inicia en producción.');
dotenv.config({ path: '.env.local', quiet: true, override: true });
import { startPreview } from '../src/ai/previewServer';
startPreview().catch(() => { console.error('No se pudo iniciar la prueba. Revisá .env.local, catálogo y puerto.'); process.exitCode = 1; });
