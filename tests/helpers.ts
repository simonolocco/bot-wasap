import { expect, Page } from '@playwright/test';

export async function login(page: Page) {
  const username = process.env.QA_ADMIN_USERNAME;
  const password = process.env.QA_ADMIN_PASSWORD;
  if (!username || !password) throw new Error('Definí QA_ADMIN_USERNAME y QA_ADMIN_PASSWORD para las pruebas del panel.');
  await page.goto('/');
  await page.getByLabel('Usuario').fill(username);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible();
}

export async function openNavigationOnMobile(page: Page) {
  const viewport = page.viewportSize();
  if (!viewport || viewport.width > 760) return;
  const menu = page.getByRole('button', { name: /menú|menu|navegación/i }).first();
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.locator('.sidebar')).toHaveClass(/open/);
}
