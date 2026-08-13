import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.QA_BASE_URL ?? 'http://127.0.0.1:4002';
const hostname = new URL(baseURL).hostname.toLowerCase();
if (!['127.0.0.1', 'localhost'].includes(hostname) && !/(qa|staging)/.test(hostname) && process.env.QA_REMOTE_CONFIRM !== 'I_UNDERSTAND_STAGING_ONLY') {
  throw new Error('Playwright sólo puede apuntar a localhost/qa/staging salvo confirmación explícita.');
}

export default defineConfig({
  testDir: './tests',
  outputDir: 'qa-artifacts/playwright',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: 'qa-artifacts/playwright-report', open: 'never' }]],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
});
