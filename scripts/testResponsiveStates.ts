import { chromium, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { startServer } from './testMobilePlaywright';

async function run() {
  const server = await startServer();
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  const baseURL = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch();
  const output = path.join(process.cwd(), 'qa-artifacts', 'responsive-fixed-20260904', 'states');
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
      const context = await browser.newContext({ viewport, hasTouch: true });
      const page = await context.newPage();
      await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { error: 'Sesión requerida' } }));
      await page.route('**/api/auth/login', route => route.fulfill({ status: 401, json: { error: 'Usuario o contraseña incorrectos. Volvé a intentarlo.' } }));
      await page.goto(baseURL);
      await page.getByLabel('Usuario', { exact: true }).fill('qa-user');
      await page.getByLabel('Contraseña', { exact: true }).fill('invalid-test-password');
      await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
      await expect(page.getByText('Usuario o contraseña incorrectos. Volvé a intentarlo.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Ingresar', exact: true })).toBeEnabled();
      await expect(page.locator('html')).toHaveJSProperty('scrollWidth', viewport.width);
      await page.screenshot({ path: path.join(output, `login-error-${viewport.width}.png`), animations: 'disabled' });
      await page.unroute('**/api/auth/me');
      await page.goto(baseURL);
      await page.locator('.conv-row').first().waitFor();

      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      await page.route('**/api/contacts?*', async route => {
        await gate;
        await route.fulfill({ status: 503, json: { error: 'No se pudo cargar la lista. Error de prueba local.' } });
      });
      await page.getByRole('button', { name: 'Contactos', exact: true }).click();
      try {
        await expect(page.getByText(/Cargando/).last()).toBeVisible();
        await page.screenshot({ path: path.join(output, `contacts-loading-${viewport.width}.png`), animations: 'disabled' });
      } finally { release(); }
      await expect(page.getByText('No se pudo cargar la lista. Error de prueba local.')).toBeVisible();
      const overflow = await page.locator('.main-view').evaluate(el => el.scrollWidth > el.clientWidth + 1);
      expect(overflow).toBe(false);
      await page.screenshot({ path: path.join(output, `contacts-error-${viewport.width}.png`), animations: 'disabled' });
      await context.close();
    }
    console.log('Responsive login/loading/error states: OK');
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
