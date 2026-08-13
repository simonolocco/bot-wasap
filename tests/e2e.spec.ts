import { expect, test } from '@playwright/test';
import { login, openNavigationOnMobile } from './helpers';

test('las APIs privadas rechazan sesiones anónimas', async ({ request }) => {
  const response = await request.get('/api/dashboard');
  expect(response.status()).toBe(401);
  const upload = await request.post('/api/media', { multipart: { file: { name: 'malware.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') } } });
  expect(upload.status()).toBe(401);
});

test('webhook exige firma válida', async ({ request }) => {
  const response = await request.post('/webhook', {
    data: { object: 'whatsapp_business_account', entry: [] },
    headers: { 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` },
  });
  expect(response.status()).toBe(401);
});

test('login limita fuerza bruta por origen', async ({ request }) => {
  const headers = { 'x-forwarded-for': `198.51.100.${(Date.now() % 200) + 1}` };
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await request.post('/api/auth/login', { headers, data: { username: 'qa-admin', password: `incorrecta-${attempt}` } });
    expect(response.status()).toBe(401);
  }
  const blocked = await request.post('/api/auth/login', { headers, data: { username: 'qa-admin', password: 'incorrecta-final' } });
  expect(blocked.status()).toBe(429);
  expect(Number(blocked.headers()['retry-after'])).toBeGreaterThan(0);
});

test('login, navegación principal, salud y logout', async ({ page }) => {
  await login(page);
  for (const [nav, heading] of [
    ['Resumen', 'Lo que necesita atención'],
    ['Conversaciones', 'Conversaciones'],
    ['Tickets', 'Tickets'],
    ['Contactos', 'Contactos'],
    ['Pedidos', 'Pedidos'],
    ['Plantillas', 'Plantillas'],
  ] as const) {
    await openNavigationOnMobile(page);
    await page.getByRole('button', { name: new RegExp(`^${nav}(?:\\s|$)`) }).click();
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
  }
  await openNavigationOnMobile(page);
  await page.getByRole('button', { name: 'Resumen', exact: true }).click();
  await expect(page.getByText('Estado del sistema')).toBeVisible();
  await expect(page.getByText('Worker', { exact: true })).toBeVisible();
  await expect(page.getByText('Último backup', { exact: true })).toBeVisible();
  const disguisedUploadStatus = await page.evaluate(async () => {
    const form = new FormData();
    form.append('file', new File([new TextEncoder().encode('MZ executable')], 'foto.png', { type: 'image/png' }));
    return (await fetch('/api/media', { method: 'POST', body: form })).status;
  });
  expect(disguisedUploadStatus).toBe(415);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible();
});
