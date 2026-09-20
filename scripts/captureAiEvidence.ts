import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createPreviewApp } from '../src/ai/previewServer';
import { saveCatalog, type Catalog } from '../src/ai/catalog';
import { createOpenRouterClient } from '../src/ai/openRouter';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', override: true });

async function captureEvidence() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  const catalog: Catalog = {
    version: 1,
    name: 'Catálogo Oficial Mayorista',
    approved: true,
    validFrom: '2026-01-01',
    validUntil: '2099-12-31',
    products: [
      { id: '1', name: 'Cremoso', brand: 'Cañada Negra', presentation: 'horma', price: 7099, unit: 'kg', tier: 'mayorista', conditions: '+ 4 HORMAS', source: 'Catálogo Oficial' },
      { id: '2', name: 'Cremoso', brand: 'Punta del Agua', presentation: 'horma', price: 8520, unit: 'kg', tier: 'mayorista', conditions: '+ 24 HORMAS', source: 'Catálogo Oficial' },
      { id: '3', name: 'Manteca 200g', brand: 'Punta del Agua', presentation: 'unidad', price: 1850, unit: 'unidad', tier: 'minorista', conditions: '', source: 'Catálogo Oficial' },
    ],
  };

  const key = (process.env.OPENROUTER_API_KEY || '').trim();
  const model = process.env.OPENROUTER_MODEL || 'google/gemini-3.5-flash-lite';
  const complete = createOpenRouterClient({ key, model });

  const app = createPreviewApp(complete);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const port = (server.address() as any).port;
  const url = `http://127.0.0.1:${port}`;

  console.log(`Preview server running at ${url}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  try {
    await page.goto(url);
    await page.waitForSelector('#messages');

    const send = async (text: string) => {
      await page.fill('#message', text);
      await Promise.all([
        page.waitForResponse(r => r.url().endsWith('/api/message')),
        page.click('#send')
      ]);
      await page.waitForFunction(() => !(document.getElementById('send') as HTMLButtonElement).disabled);
      await page.waitForTimeout(500);
    };

    // 1. Send the exact screenshot prompt 1
    console.log('Sending: no se peude trabajar asi eh');
    await send('no se peude trabajar asi eh');

    // 2. Send the exact screenshot prompt 2
    console.log('Sending: mas info');
    await send('mas info');

    // 3. Send external proposal
    console.log('Sending: SNACKS BUFFALO...');
    await send('SNACKS BUFFALO ( papas en tubos x 140 gramos ) OFERTA SEPTIEMBRE:\nPrecio Unitario Neto: $ 2.448');

    // 4. Send out of area shipping
    console.log('Sending: Llegan a moreno');
    await send('Llegan a moreno');

    // Take full page screenshot (scrolled bottom view)
    const screenshotPath = path.resolve('qa-artifacts/ai-preview-fixed-chat-bottom.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Saved screenshot to ${screenshotPath}`);

    // Scroll chat to top to show first two messages ("no se peude trabajar asi eh" and "mas info")
    await page.evaluate(() => {
      const el = document.getElementById('messages');
      if (el) el.scrollTop = 0;
    });
    await page.waitForTimeout(300);
    const screenshotTopPath = path.resolve('qa-artifacts/ai-preview-fixed-chat-top.png');
    await page.screenshot({ path: screenshotTopPath, fullPage: true });
    console.log(`Saved top screenshot to ${screenshotTopPath}`);

    // Also copy to artifacts directory
    const artifactDir = 'C:\\Users\\simon\\.gemini\\antigravity\\brain\\3fd3babf-404e-4e7d-bcfc-75374d3edc98';
    try {
      await fs.copyFile(screenshotPath, path.join(artifactDir, 'ai-preview-fixed-chat-bottom.png'));
      await fs.copyFile(screenshotTopPath, path.join(artifactDir, 'ai-preview-fixed-chat-top.png'));
      await fs.copyFile(screenshotTopPath, path.join(artifactDir, 'ai-preview-fixed-chat.png'));
      console.log(`Copied screenshots to artifacts directory`);
    } catch (e) {
      console.warn('Could not copy to artifacts dir:', e);
    }
  } finally {
    await browser.close();
    server.close();
    server.closeAllConnections();
  }
}

captureEvidence().catch(err => {
  console.error(err);
  process.exit(1);
});
