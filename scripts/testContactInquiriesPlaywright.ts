import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from './testMobilePlaywright';
(async () => {
  const server = await startServer();
  const address = server.address() as {port:number};
  const browser = await chromium.launch({headless:true});
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({viewport:{width,height:900}});
      let filtered = false;
      await page.route('**/api/contacts?*', route => {
        filtered = new URL(route.request().url()).searchParams.get('inquiry') === 'lista_precio';
        return route.fulfill({json:{items:[{id:'qa',name:'Sergio',phone:'5491100000001',pipelineStatus:'new',labels:[],inquiryTypes: filtered ? ['lista_precio'] : ['horarios','direccion','lista_precio','hacer_pedido','asesor','preguntas_frecuentes','no_reconocidas'],inquiryCounts: filtered ? { lista_precio: 3 } : { lista_precio: 3, direccion: 1 }}],total:1,page:0,limit:25}});
      });
      await page.goto(`http://127.0.0.1:${address.port}`);
      if (await page.locator('.menu-button').isVisible()) await page.locator('.menu-button').click();
      await page.getByRole('button',{name:'Contactos',exact:true}).click();
      await page.locator('.contact-table-grid').getByText('No reconocidas',{exact:true}).waitFor();
      await page.locator('.contact-table-grid').getByText('Dirección',{exact:true}).waitFor();
      await page.screenshot({path:`qa-artifacts/contact-inquiries-all-${width}.png`,fullPage:true});
      await page.getByLabel('Tipo de consulta',{exact:true}).selectOption('lista_precio');
      await page.locator('.contact-table-grid').getByText('Precios',{exact:true}).waitFor();
      await page.locator('.contact-table-grid').getByText('×3',{exact:true}).waitFor();
      await page.waitForFunction(() => document.querySelectorAll('.contact-table-grid .tags-container .chip-badge').length === 1);
      assert.ok(filtered);
      assert.match(await page.getByRole('link',{name:'Exportar CSV'}).getAttribute('href') || '', /inquiry=lista_precio/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({path:`qa-artifacts/contact-inquiries-${width}.png`,fullPage:true});
      await page.close();
    }
    console.log('PASS: contact indicators, filter and CSV link at mobile and desktop widths');
  } finally {await browser.close(); await new Promise<void>(resolve => server.close(() => resolve()));}
})().catch(e=>{console.error(e);process.exitCode=1;});
