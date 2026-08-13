/**
 * Sends signed webhook traffic to a non-production endpoint.
 * Usage: LOAD_WEBHOOK_URL=http://localhost:4002/webhook META_APP_SECRET=... npm run test:load
 * Optional: LOAD_COUNT=500 LOAD_BURST=50 LOAD_WAIT_MS=1000
 */
import 'dotenv/config';
import crypto from 'node:crypto';

const configuredUrl = process.env.LOAD_WEBHOOK_URL;
const configuredSecret = process.env.META_APP_SECRET;
if (!configuredUrl || !configuredSecret) throw new Error('Definí LOAD_WEBHOOK_URL y META_APP_SECRET antes de ejecutar la prueba.');
const url: string = configuredUrl;
const secret: string = configuredSecret;
const count = Math.max(1, Number.parseInt(process.env.LOAD_COUNT ?? '500', 10) || 500);
const burst = Math.max(1, Number.parseInt(process.env.LOAD_BURST ?? '50', 10) || 50);
const waitMs = Math.max(0, Number.parseInt(process.env.LOAD_WAIT_MS ?? '1000', 10) || 1000);

function payloadFor(index: number, sourceTimestamp = Math.floor(Date.now() / 1000)) {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: {
      contacts: [{ profile: { name: `Carga ${index}` } }],
      messages: [{
        id: `load-${Date.now()}-${index}-${crypto.randomUUID()}`,
        from: `549351${String(index).padStart(7, '0')}`,
        timestamp: String(sourceTimestamp),
        type: 'text',
        text: { body: index % 5 === 0 ? 'nuevo pedido' : 'hola' },
      }],
    } }] }],
  });
}

async function send(index: number, sourceTimestamp = Math.floor(Date.now() / 1000)) {
  const payload = payloadFor(index, sourceTimestamp);
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
  const start = performance.now();
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, body: payload });
  if (!response.ok) throw new Error(`Evento ${index}: HTTP ${response.status}`);
  return performance.now() - start;
}

async function main() {
  const started = performance.now();
  const batches: number[][] = [];
  for (let start = 0; start < count; start += burst) {
    batches.push(await Promise.all(Array.from({ length: Math.min(burst, count - start) }, (_, offset) => send(start + offset))));
  }
  const latencies = batches.flat().sort((a, b) => a - b);
  const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * .95))];
  const staleLatency = await send(count + 1, Math.floor(Date.now() / 1000) - 600);
  await new Promise(resolve => setTimeout(resolve, waitMs));
  console.log(`[load] ${count} eventos + 1 stale persistidos en ${Math.round(performance.now() - started)}ms; p95 webhook=${Math.round(p95)}ms; stale=${Math.round(staleLatency)}ms`);
  if (p95 > 1000) throw new Error(`p95 del webhook supera 1s: ${Math.round(p95)}ms`);
}

main().catch(error => { console.error(error); process.exit(1); });
