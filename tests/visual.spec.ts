import { expect, test } from '@playwright/test';
import { login, openNavigationOnMobile } from './helpers';

const viewports = [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'laptop-1280x720', width: 1280, height: 720 },
  { name: 'tablet-768x1024', width: 768, height: 1024 },
  { name: 'mobile-390x844', width: 390, height: 844 },
];

for (const viewport of viewports) {
  test(`panel sin desborde y evidencia ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await login(page);
    await openNavigationOnMobile(page);
    await page.getByRole('button', { name: 'Resumen', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Lo que necesita atención' })).toBeVisible();
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth + 1);
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}.png`), fullPage: true });
  });
}
