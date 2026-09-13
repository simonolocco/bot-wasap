import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, webkit } from '@playwright/test';
import { createPreviewApp } from '../src/ai/previewServer';
import { saveCatalog } from '../src/ai/catalog';
import type { Intent } from '../src/ai/assistant';
import { AiProviderError, type Complete } from '../src/ai/openRouter';

async function run() {
  process.env.OPENROUTER_MODEL = 'Prueba de interfaz sin IA externa';
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'abasto-ai-browser-'));
  process.env.AI_CATALOG_PATH = path.join(temporary, 'catalog.json');
  await saveCatalog({ version: 1, name: 'Catálogo sintético de QA', approved: true, validFrom: '2026-01-01', validUntil: '2099-01-01', products: [
    { id: '1', name: 'Cremoso', brand: 'Prueba', presentation: 'horma', price: 1234.56, unit: 'kg', tier: 'mayorista', conditions: '', source: 'Fixture de QA · página 1' },
  ] });
  const complete: Complete = async messages => {
    const text = String(messages[messages.length - 1].content).toLowerCase();
    if (text.includes('simular fallo')) throw new AiProviderError('credit', 'Saldo insuficiente');
    const intent: Intent = { topics: text.includes('moreno') ? ['shipping'] : [], productQuery: text.includes('cremoso') || text === 'mayorista' ? 'cremoso' : '', tier: text === 'mayorista' ? 'mayorista' : 'unknown',
      catalog: false, human: false, order: false, stock: false, social: 'none', unknown: false };
    return { content: JSON.stringify(intent), model: 'fixture (sin llamada externa)', tokens: 0 };
  };
  const server = createPreviewApp(complete).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  const results: unknown[] = [];
  await fs.mkdir('qa-artifacts', { recursive: true });
  try {
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch({ headless: true });
      try {
        for (const width of [1440, 390, 320]) {
          const page = await browser.newPage({ viewport: { width, height: 900 } });
          const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
          await page.goto(url); await page.getByText('Precios habilitados', { exact: true }).waitFor();
          const send = async (text: string) => {
            await page.getByRole('textbox', { name: 'Tu mensaje' }).fill(text);
            await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/message')), page.getByRole('button', { name: 'Enviar', exact: false }).click()]);
            await page.waitForFunction(() => !(document.getElementById('send') as HTMLButtonElement).disabled);
          };
          await send('¿Cuánto sale el cremoso?');
          assert.match(await page.locator('.bubble.assistant').last().innerText(), /mayorista o minorista/);
          await send('Mayorista');
          assert.match(await page.locator('.bubble.assistant').last().innerText(), /1\.234,56/);
          await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/pause')), page.getByRole('checkbox', { name: 'Asesor atendiendo' }).check()]);
          const before = await page.locator('.bubble.assistant').count(); await send('Hola');
          assert.equal(await page.locator('.bubble.assistant').count(), before);
          await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/reset')), page.getByRole('button', { name: 'Nueva conversación' }).click()]);
          await page.waitForFunction(() => !(document.getElementById('pause') as HTMLInputElement).checked);
          await send('4'); await send('2 hormas de cremoso');
          assert.match(await page.locator('.bubble.assistant').last().innerText(), /ningún pedido real/);
          await send('Simular fallo'); assert.match(await page.locator('#chat-status').innerText(), /saldo suficiente/);
          const beforeSilence = await page.locator('.bubble.assistant').count();
          await send('Gracias');
          assert.equal(await page.locator('.bubble.assistant').count(), beforeSilence, 'silence must not add an assistant bubble');
          assert.match(await page.locator('#evidence').innerText(), /Silencio deliberado/);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `desborde ${engine.name()} ${width}`);
          await page.screenshot({ path: `qa-artifacts/ai-${engine.name()}-${width}.png`, fullPage: true });
          await page.getByRole('button', { name: 'Revisar o cargar catálogo' }).click();
          await page.locator('#catalog-dialog').waitFor({ state: 'visible' });
          await page.getByRole('button', { name: 'Activar catálogo revisado' }).click();
          assert.match(await page.locator('#catalog-status').innerText(), /Confirmá la revisión/);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
          await page.screenshot({ path: `qa-artifacts/ai-catalog-${engine.name()}-${width}.png`, fullPage: true });
          await page.keyboard.press('Escape'); await page.locator('#catalog-dialog').waitFor({ state: 'hidden' });
          assert.deepEqual(errors, []);
          results.push({ engine: engine.name(), width, passed: true });
          await page.close();
        }
      } finally { await browser.close(); }
    }
  } finally { server.close(); server.closeAllConnections(); }
  await fs.writeFile('qa-artifacts/ai-browser-results.json', JSON.stringify(results, null, 2));
  console.log('PASS 6 combinaciones de navegador y pantalla: chat, precios, aclaración, pausa, pedido, fallo, revisión y Escape.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
