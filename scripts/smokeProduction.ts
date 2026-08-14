import 'dotenv/config';
import crypto from 'node:crypto';

const domain = process.env.PUBLIC_DOMAIN?.trim();
const verifyToken = process.env.META_VERIFY_TOKEN?.trim();
if (!domain || !verifyToken) throw new Error('PUBLIC_DOMAIN y META_VERIFY_TOKEN son obligatorios para el smoke de producción.');
const baseUrl = `https://${domain}`;

async function request(path: string) {
  return fetch(`${baseUrl}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
}

async function main() {
  const health = await request('/healthz');
  if (!health.ok || !(await health.json() as { ok?: boolean }).ok) throw new Error(`/healthz respondió ${health.status}`);

  const ready = await request('/readyz');
  if (!ready.ok || !(await ready.json() as { ok?: boolean }).ok) throw new Error(`/readyz respondió ${ready.status}`);

  const root = await request('/');
  if (!root.ok) throw new Error(`/ respondió ${root.status}`);
  if (root.headers.has('x-powered-by')) throw new Error('La respuesta pública todavía expone X-Powered-By.');
  if (root.headers.get('x-frame-options') !== 'DENY') throw new Error('Falta X-Frame-Options: DENY.');
  if (!root.headers.get('strict-transport-security')) throw new Error('Falta Strict-Transport-Security.');

  const privateApi = await request('/api/dashboard');
  if (privateApi.status !== 401) throw new Error(`/api/dashboard anónimo respondió ${privateApi.status}, se esperaba 401.`);

  const challenge = `preflight-${crypto.randomUUID()}`;
  const webhook = await request(`/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=${encodeURIComponent(challenge)}`);
  if (!webhook.ok || (await webhook.text()) !== challenge) throw new Error('La verificación pública del webhook de Meta falló.');

  console.log('Smoke de producción: OK');
  console.log('HTTPS, salud, preparación, panel privado, cabeceras y webhook de Meta respondieron correctamente.');
}

main().catch(error => {
  console.error('Smoke de producción: FALLÓ');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
