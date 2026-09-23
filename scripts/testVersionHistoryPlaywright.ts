import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { APP_VERSION } from '../frontend/src/appVersion';
import { RELEASE_HISTORY } from '../frontend/src/releaseHistory';
import { startServer } from './testMobilePlaywright';

async function run() {
  const server = await startServer();
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      for (const theme of ['light', 'dark'] as const) {
        const context = await browser.newContext({ viewport, colorScheme: theme, hasTouch: viewport.width < 769 });
        await context.addInitScript(value => localStorage.setItem('abasto-theme', value), theme);
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${address.port}/`);
        await page.getByRole('navigation', { name: viewport.width <= 768 ? 'Accesos principales' : 'Navegación principal' }).waitFor();
        if (viewport.width <= 768) await page.getByRole('button', { name: 'Más secciones' }).click();
        assert.equal(await page.getByRole('button', { name: 'Laboratorio', exact: true }).count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Simulador Jev', exact: true }).count(), 0);

        const trigger = page.getByRole('button', { name: `Ver historial de versiones. Versión ${APP_VERSION}` });
        await trigger.click();
        const dialog = page.getByRole('dialog', { name: 'Historial de versiones' });
        await dialog.waitFor();
        assert.equal(await dialog.locator('.release-entry').count(), RELEASE_HISTORY.length);
        assert.match(await dialog.locator('.release-entry.current').innerText(), new RegExp(`v${APP_VERSION.replace(/\./g, '\\.')}`));
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Cerrar historial de versiones');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        const bounds = await dialog.boundingBox();
        assert.ok(bounds && bounds.x >= -1 && bounds.x + bounds.width <= viewport.width + 1);
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Cerrar historial de versiones');
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Ver historial de versiones'));

        await trigger.click();
        await dialog.waitFor();
        await page.locator('.modal-backdrop').click({ position: { x: 4, y: 4 } });
        await dialog.waitFor({ state: 'detached' });
        await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Ver historial de versiones'));
        assert.deepEqual(errors, []);
        await context.close();
      }
    }
    console.log('Version history UI smoke: OK');
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

void run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
