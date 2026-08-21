import { expect, test } from '@playwright/test';
import crypto from 'node:crypto';
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
    ['Resumen', 'Resumen'],
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

test('imagen privada genera miniatura WebP autenticada', async ({ page, request }) => {
  const run = Date.now().toString();
  const phone = `549110${run.slice(-7)}`;
  const webhookPayload = {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: {
      contacts: [{ profile: { name: `QA Media ${run}` }, wa_id: phone }],
      messages: [{ from: phone, id: `wamid.qa-media-${run}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'hola' } }],
    } }] }],
  };
  const rawPayload = JSON.stringify(webhookPayload);
  const signature = crypto.createHmac('sha256', process.env.META_APP_SECRET ?? 'qa-app-secret').update(rawPayload).digest('hex');
  const incoming = await request.post('/webhook', {
    data: rawPayload,
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${signature}` },
  });
  expect(incoming.status()).toBe(200);

  await login(page);
  const result = await page.evaluate(async currentPhone => {
    const conversations = await fetch(`/api/conversations?q=${encodeURIComponent(currentPhone)}&limit=1`).then(response => response.json());
    const contact = conversations.items?.[0];
    if (!contact) throw new Error('No se encontró la conversación sintética recién creada.');
    const binary = atob('iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAYAAABr5z2BAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGklEQVQokWPgb8n5TwlmGDXg/2gY5AyHMAAA1xd+kP6IR7AAAAAASUVORK5CYII=');
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const form = new FormData();
    form.append('file', new File([bytes], 'qa-miniatura.png', { type: 'image/png' }));
    const uploaded = await fetch('/api/media', { method: 'POST', body: form });
    if (!uploaded.ok) throw new Error(`La carga respondiÃ³ ${uploaded.status}`);
    const asset = await uploaded.json();
    const sent = await fetch(`/api/conversations/${contact.id}/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Prueba visual QA', assetId: asset.assetId, mediaType: 'image' }),
    });
    if (!sent.ok) throw new Error(`El envÃ­o respondiÃ³ ${sent.status}`);
    const message = await sent.json();
    const thumbnail = await fetch(`/api/messages/${message.id}/media/thumbnail?w=240`);
    return { status: thumbnail.status, contentType: thumbnail.headers.get('content-type'), bytes: (await thumbnail.arrayBuffer()).byteLength };
  }, phone);
  expect(result.status).toBe(200);
  expect(result.contentType).toContain('image/webp');
  expect(result.bytes).toBeGreaterThan(20);
});

test('botones seguros, cierre de ficha y detalle de pedido responden', async ({ page }) => {
  await login(page);
  const firstConversation = page.locator('.conv-row').first();
  await expect(firstConversation).toBeVisible();
  await firstConversation.click();
  await expect(page.locator('.chat-head')).toBeVisible();

  const info = page.getByRole('button', { name: 'Ver ficha comercial', exact: true });
  await info.click();
  await expect(page.locator('.contact-drawer.open')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar ficha' }).click();
  await expect(page.locator('.contact-drawer.open')).toHaveCount(0);
  await expect(page.locator('.inbox-shell')).not.toHaveClass(/info-visible/);
  await info.click();
  await expect(page.locator('.contact-drawer.open')).toBeVisible();

  const notifications = page.getByRole('button', { name: /Notificaciones/ });
  const notificationBefore = await notifications.getAttribute('aria-pressed');
  await notifications.click();
  expect(await notifications.getAttribute('aria-pressed')).not.toBe(notificationBefore);
  await notifications.click();
  await page.getByLabel('Tema visual').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('Tema visual').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.getByRole('button', { name: 'Pedidos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pedidos', exact: true })).toBeVisible();
  const orderRows = page.locator('.order-table .table-row');
  if (await orderRows.count()) {
    await orderRows.first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Detalle del pedido', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ir a la conversación' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await orderRows.first().click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});

test('flujo mobile de conversaciones: selección, historial, compositor y volver', async ({ page, request }) => {
  // Asegurar que existe al menos una conversación mediante un evento sintético de WhatsApp
  const run = Date.now().toString();
  const phone = `549110${run.slice(-7)}`;
  const webhookPayload = {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: {
      contacts: [{ profile: { name: `QA Mobile ${run}` }, wa_id: phone }],
      messages: [{ from: phone, id: `wamid.qa-mob-${run}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Mensaje de prueba mobile' } }],
    } }] }],
  };
  const rawPayload = JSON.stringify(webhookPayload);
  const signature = crypto.createHmac('sha256', process.env.META_APP_SECRET ?? 'qa-app-secret').update(rawPayload).digest('hex');
  const incoming = await request.post('/webhook', {
    data: rawPayload,
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${signature}` },
  });
  expect(incoming.status()).toBe(200);

  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await openNavigationOnMobile(page);
  await page.getByRole('button', { name: 'Conversaciones', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Conversaciones', exact: true }).first()).toBeVisible();

  // En mobile inicial: la lista de conversaciones es visible y el chat está oculto
  await expect(page.locator('.conversation-pane')).toBeVisible();
  await expect(page.locator('.chat')).toHaveCount(0);

  // La conversación debe existir obligatoriamente y ser seleccionable
  const firstConversation = page.locator('.conv-row').first();
  await expect(firstConversation).toBeVisible({ timeout: 10_000 });
  await firstConversation.click();

  // Al seleccionar: el chat, cabecera, mensajes y compositor son visibles
  await expect(page.locator('body')).toHaveClass(/mobile-chat-open/);
  await expect(page.locator('.conversation-pane')).toBeHidden();
  await expect(page.locator('.chat')).toBeVisible();
  await expect(page.locator('.chat-head')).toBeVisible();
  await expect(page.locator('.messages')).toBeVisible();
  await expect(page.locator('.composer')).toBeVisible();

  // El compositor y botón de envío están visibles y usables
  const textarea = page.locator('.composer-input textarea');
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeEnabled();
  const sendBtn = page.locator('.send-btn');
  await expect(sendBtn).toBeVisible();

  await textarea.fill('Respuesta de prueba mobile');
  await expect(sendBtn).toBeEnabled();

  // El botón volver está disponible y visible
  const backBtn = page.getByRole('button', { name: 'Volver a conversaciones' });
  await expect(backBtn).toBeVisible();

  // Sin overflow horizontal en mobile con chat abierto
  const overflowChat = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(overflowChat.documentWidth).toBeLessThanOrEqual(overflowChat.viewportWidth + 1);

  // Al presionar volver: regresa a la lista
  await backBtn.click();
  await expect(page.locator('body')).not.toHaveClass(/mobile-chat-open/);
  await expect(page.locator('.conversation-pane')).toBeVisible();
  await expect(page.locator('.chat')).toBeHidden();

  // Sin overflow horizontal en mobile con lista abierta
  const overflowList = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(overflowList.documentWidth).toBeLessThanOrEqual(overflowList.viewportWidth + 1);
});
