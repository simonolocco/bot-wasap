import { expect, test } from '@playwright/test';
import { login, openNavigationOnMobile } from './helpers';

const viewports = [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'laptop-1280x720', width: 1280, height: 720 },
  { name: 'tablet-768x1024', width: 768, height: 1024 },
  { name: 'mobile-390x844', width: 390, height: 844 },
];

const views = [
  ['Resumen', 'Resumen'],
  ['Conversaciones', 'Conversaciones'],
  ['Tickets', 'Tickets'],
  ['Contactos', 'Contactos'],
  ['Pedidos', 'Pedidos'],
  ['Plantillas', 'Plantillas'],
] as const;

for (const viewport of viewports) {
  for (const theme of ['light', 'dark'] as const) {
    test(`panel completo ${viewport.name} ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await login(page);
      await page.getByLabel('Tema visual').selectOption(theme);
      await openNavigationOnMobile(page);

      for (const [navigation, heading] of views) {
        await page.getByRole('button', { name: navigation, exact: true }).click();
        await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
        await expect(page.locator('.loading-state')).toHaveCount(0);
        await expect(page.locator('.view-state').filter({ hasText: /Cargando/ })).toHaveCount(0);
        const overflow = await page.evaluate(() => ({
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
        }));
        expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth + 1);
        await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-${theme}-${navigation.toLowerCase()}.png`), fullPage: true });
      }
    });
  }
}
