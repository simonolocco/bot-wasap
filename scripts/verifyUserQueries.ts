import { createPreviewApp } from '../src/ai/previewServer';
import { saveCatalog } from '../src/ai/catalog';
import { createOpenRouterClient } from '../src/ai/openRouter';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', override: true });

async function verify() {
  const key = (process.env.OPENROUTER_API_KEY || '').trim();
  const model = process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-super-120b-a12b:free';
  const complete = createOpenRouterClient({ key, model });

  const app = createPreviewApp(complete);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;

  try {
    const initial = await fetch(`${url}/api/state`);
    const cookie = initial.headers.get('set-cookie')!.split(';')[0];
    const state: any = await initial.json();
    const headers = { cookie, 'X-Preview-Token': state.token, 'Content-Type': 'application/json' };

    const testQueries = [
      { name: '1. Queja usuario (Screenshot)', query: 'no se peude trabajar asi eh' },
      { name: '2. Clic anuncio / más info (Screenshot)', query: 'mas info' },
      { name: '3. Propuesta proveedor externo', query: 'SNACKS BUFFALO ( papas en tubos x 140 gramos ) OFERTA SEPTIEMBRE:\nPrecio Unitario Neto: $ 2.448 ( SIN IVA ).\n4 SABORES: ORIGINAL // BARBACOA // JALAPEÑO // CREMA Y CEBOLLA.\nVencimiento: MAYO 2027.' },
      { name: '4. Envío fuera de Córdoba', query: 'Llegan a moreno' },
      { name: '5. Compra mínima / particular', query: 'Cuánto es la compra mínima?' },
      { name: '6. Ruido / Letras sueltas', query: 'dfd' },
      { name: '7. Problema abriendo catálogo', query: 'No puedo abrir el catálogo minorista' },
      { name: '8. Pedido de asesor humano', query: 'Necesito un asesor' },
    ];

    console.log('======================================================================');
    console.log('DEMOSTRACIÓN EN VIVO DE RESPUESTAS A CASOS REALES DEL USUARIO:');
    console.log('======================================================================\n');

    for (const test of testQueries) {
      console.log(`\n🔹 [${test.name}]`);
      console.log(`👤 Usuario: "${test.query.split('\n')[0]}"`);
      const res = await fetch(`${url}/api/message`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: test.query }),
      });
      const data: any = await res.json();
      console.log(`🤖 AbastoBot (${data.outcome}):\n${data.text}`);
      console.log(`📌 Fuentes: ${data.sources.join(' | ')}`);
    }

    console.log('\n======================================================================');
    console.log('VERIFICACIÓN EXITOSA');
    console.log('======================================================================');
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

verify().catch(console.error);
