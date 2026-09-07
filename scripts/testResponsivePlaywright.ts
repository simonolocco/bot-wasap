import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Locator, type Page } from 'playwright';
import { startServer } from './testMobilePlaywright';

// Mock APIs only; use the built frontend without a production server or credentials.
const output = path.join(process.cwd(), 'qa-artifacts/responsive-fixed-20260904');
const sizes = [[320,568],[360,800],[390,844],[768,1024],[769,1024],[820,1180],[844,390],[1280,720]];
const contacts = Array.from({ length: 25 }, (_, i) => ({ id: `qa-${i}`, phone: `549110000${i}`, name: `Distribuidora del Mercado Central ${i}`, publicName: `Cliente ${i}`, pipelineStatus: 'new', messageCount: 3, botResponseCount: 0, responseStatus: 'unanswered', lastMessageAt: new Date().toISOString(), lastIncomingAt: new Date().toISOString() }));

async function contained(locator: Locator, label: string, vertical = true) {
  await locator.waitFor({ state: 'visible' });
  const m = await locator.evaluate(el => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height, vw: innerWidth, vh: innerHeight };
  });
  assert.ok(m.width > 0 && m.height > 0 && m.x >= -1 && m.right <= m.vw + 1 && (!vertical || (m.y >= -1 && m.bottom <= m.vh + 1)), `${label} outside viewport: ${JSON.stringify(m)}`);
}
async function noOverflow(page: Page, selectors: string[]) {
  const bad = await page.evaluate(selectors => selectors.flatMap(selector => [...document.querySelectorAll<HTMLElement>(selector)].filter(el => el.clientWidth && el.scrollWidth > el.clientWidth + 2).map(el => ({ selector, width: el.clientWidth, scroll: el.scrollWidth }))), selectors);
  assert.deepEqual(bad, [], 'Unexpected internal horizontal overflow');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Document horizontal overflow');
}
async function navigate(page: Page, name: string) {
  const target = page.getByRole('button', { name, exact: true });
  if (!await target.isVisible()) await page.getByRole('button', { name: 'Más secciones', exact: true }).click();
  await target.click();
}

async function run() {
  fs.mkdirSync(output, { recursive: true });
  const server = await startServer();
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const browser = await chromium.launch({ headless: true });
  const results: object[] = [];
  try {
    for (const [width,height] of sizes) for (const theme of ['light','dark'] as const) {
      const key = `${width}x${height}-${theme}`;
      const context = await browser.newContext({ viewport: { width,height }, colorScheme: theme, hasTouch: width < 1024 });
      await context.addInitScript(theme => localStorage.setItem('abasto-theme', theme), theme);
      const page = await context.newPage();
      page.setDefaultTimeout(7000);
      const errors: string[] = [];
      page.on('pageerror', err => errors.push(err.message));
      let loggedOut = false;
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        if (/\/conversations\/[^/]+\/messages$/.test(url.pathname) && route.request().method() === 'GET') return route.fulfill({ json: { items: Array.from({ length: 12 }, (_, i) => ({ id: `responsive-${i}`, contactId: 'conv-mob-1', direction: i === 11 ? 'outgoing' : 'incoming', body: i >= 10 ? 'Sí' : `Mensaje para comprobar desplazamiento ${i}`, createdAt: new Date().toISOString(), deliveryStatus: 'delivered', messageType: 'text' })), nextBefore: null } });
        if (url.pathname === '/api/templates') return route.fulfill({ json: { items: [{ id: 'qa-template', metaName: 'confirmacion_pedido_distribuidora', language: 'es_AR', category: 'UTILITY', body: 'Hola {{1}}, confirmamos tu pedido para retirar.', status: 'APPROVED' }] } });
        if (url.pathname === '/api/orders') return route.fulfill({ json: { items: contacts.map((c,i) => ({ id: 1000+i, contactId: c.id, customerName: c.name, phone: c.phone, status: 'submitted', createdAt: new Date().toISOString(), grandTotal: 123456.78, detail: 'Pedido para distribución', items: [{ name: 'Mozzarella de primera calidad', quantity: 12, price: '$ 123.456,78' }] })), total: 120 } });
        if (url.pathname === '/api/analytics') {
          const response = await route.fetch();
          const data = await response.json();
          data.contactsWithoutMenu = { items: contacts, total: 25, withoutBotResponse: 25 };
          return route.fulfill({ json: data });
        }
        if (url.pathname === '/api/auth/logout') { loggedOut = true; return route.fulfill({ json: { success: true } }); }
        if (url.pathname === '/api/auth/me' && loggedOut) return route.fulfill({ status: 401, json: { error: 'No autenticado' } });
        return route.continue();
      });
      try {
        await page.goto(`http://127.0.0.1:${address.port}`);
        await page.locator('.conv-row').first().click();
        await page.locator('.composer-input textarea').waitFor();
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme, 'Actual theme must match requested theme');
        await contained(page.locator('.composer-input textarea'), 'Composer textarea');
        await contained(page.locator('.send-btn').first(), 'Send button');
        const messages = await page.locator('.messages').boundingBox();
        assert.ok(messages && messages.height >= 64, `Messages need useful height: ${JSON.stringify(messages)}`);
        await page.screenshot({ path: path.join(output, `${key}-chat.png`) });
        for (const id of [10,11]) {
          const bubble = page.locator(`[data-message-id="responsive-${id}"]`);
          await bubble.scrollIntoViewIfNeeded();
          await bubble.locator('.message-actions-trigger').click();
          const reply = page.locator('.message-actions-floating').getByRole('button', { name: 'Responder', exact: true });
          await contained(page.locator('.message-actions-floating'), 'Short message menu');
          await contained(reply, 'Short message reply action');
          await page.screenshot({ path: path.join(output, `${key}-menu-${id}.png`) });
          await reply.click();
          await page.getByRole('note', { name: 'Respondiendo a un mensaje' }).waitFor();
          await contained(page.locator('.composer-input textarea'), 'Reply composer');
          await page.getByRole('button', { name: 'Quitar respuesta', exact: true }).click();
        }
        const controls = page.locator('.chat-controls-toggle');
        if (await controls.isVisible() && await controls.getAttribute('aria-expanded') !== 'true') await controls.click();
        await page.getByRole('button', { name: 'Ver ficha comercial', exact: true }).click();
        await contained(page.locator('.contact-drawer'), 'Contact drawer');
        const close = page.getByRole('button', { name: 'Cerrar ficha', exact: true });
        await contained(close, 'Contact drawer close');
        await page.screenshot({ path: path.join(output, `${key}-drawer.png`) });
        await close.click();
        await page.locator('.contact-drawer').waitFor({ state: 'hidden' });
        if (width <= 390) {
          for (const name of ['Plantillas','Pedidos','Analíticas']) {
            await navigate(page, name);
            if (name === 'Plantillas') {
              await page.locator('.template-card-modern').waitFor();
              await noOverflow(page, ['.templates-grid','.template-card-modern','.template-top','.template-card-footer']);
              await contained(page.locator('.copy-template-btn'), 'Template copy', false);
            } else if (name === 'Pedidos') {
              await page.locator('.interactive-row').first().waitFor();
              await noOverflow(page, ['.view-toolbar','.toolbar-filters']);
            } else {
              const next = page.getByRole('button', { name: 'Página siguiente', exact: true }).last();
              await next.scrollIntoViewIfNeeded();
              await contained(next, 'Analytics next page');
              await noOverflow(page, ['.table-footer','.table-footer-controls']);
              await next.click();
              assert.match(await page.locator('.page-indicator').last().innerText(), /Página 2/);
            }
            await page.screenshot({ path: path.join(output, `${key}-${name}.png`) });
          }
          if (await page.locator('.menu-button').isVisible()) await page.locator('.menu-button').click();
          await page.locator('.topbar-settings-toggle').click();
          const logout = page.getByRole('button', { name: 'Cerrar sesión', exact: true });
          await contained(logout.filter({ visible: true }), 'Mobile logout');
          await logout.filter({ visible: true }).click();
          await page.locator('input[type="password"]').waitFor();
        }
        assert.deepEqual(errors, [], 'Browser runtime errors');
        fs.rmSync(path.join(output, `${key}-failure.png`), { force: true });
        results.push({ key, passed: true });
        console.log(`PASS ${key}`);
      } catch (error) {
        await page.screenshot({ path: path.join(output, `${key}-failure.png`) });
        results.push({ key, passed: false, error: String(error), errors });
        console.error(`FAIL ${key}: ${error}`);
      } finally {
        fs.writeFileSync(path.join(output, 'regression-results.json'), JSON.stringify(results, null, 2));
        await context.close();
      }
    }
    assert.ok(results.every((r: any) => r.passed), 'Responsive regressions failed; inspect regression-results.json');
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
