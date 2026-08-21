import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = process.cwd();
const adminDir = path.join(root, 'public', 'admin');

async function run() {
  let lastRequestedPeriod = '';
  let lastRequestedFrom = '';
  let lastRequestedTo = '';

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = url.pathname;

    if (pathname === '/' || pathname === '/index.html') {
      const html = fs.readFileSync(path.join(adminDir, 'index.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    if (pathname.startsWith('/assets/')) {
      const filePath = path.join(adminDir, pathname);
      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath);
        const contentType = ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        return res.end(fs.readFileSync(filePath));
      }
    }

    if (pathname === '/sw.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      return res.end('// mock sw');
    }

    if (pathname === '/api/auth/me') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ username: 'qa-admin' }));
    }

    if (pathname === '/api/conversations' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ items: [], nextCursor: null }));
    }

    if (pathname === '/api/conversations/cont-no-menu-1/read' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        id: 'cont-no-menu-1', phone: '5491199887766', name: 'Maria Gomez', publicName: 'Maria Gomez',
        consentStatus: 'unknown', consentSource: null, consentAt: null, notes: '', labels: [],
        pipelineStatus: 'new', assignedTo: null, followUpAt: null, unreadCount: 0,
        lastIncomingAt: '2026-08-20T16:00:00.000Z', lastMessageAt: '2026-08-20T16:00:00.000Z', botPaused: false,
      }));
    }

    if (pathname === '/api/conversations/cont-no-menu-1' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        contact: {
          id: 'cont-no-menu-1', phone: '5491199887766', name: 'Maria Gomez', publicName: 'Maria Gomez',
          consentStatus: 'unknown', consentSource: null, consentAt: null, notes: '', labels: [],
          pipelineStatus: 'new', assignedTo: null, followUpAt: null, unreadCount: 0,
          lastIncomingAt: '2026-08-20T16:00:00.000Z', lastMessageAt: '2026-08-20T16:00:00.000Z', botPaused: false,
        }, lastOrder: null, messageCount: 3, openTicket: null, tickets: [],
      }));
    }

    if (pathname === '/api/conversations/cont-no-menu-1/messages' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        items: [
          { id: 'msg-maria-1', direction: 'incoming', body: 'Hola, necesito ayuda', messageType: 'text', createdAt: '2026-08-20T15:59:00.000Z', providerMessageId: 'provider-maria-1', deliveryStatus: null },
          { id: 'msg-maria-2', direction: 'outgoing', body: '¿En qué podemos ayudarte?', messageType: 'text', createdAt: '2026-08-20T15:59:10.000Z', providerMessageId: 'provider-maria-2', deliveryStatus: 'sent' },
        ], nextBefore: null,
      }));
    }

    if (pathname === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(': keepalive\n\n');
      return;
    }

    if (pathname === '/api/analytics' && req.method === 'GET') {
      lastRequestedPeriod = url.searchParams.get('period') || '30d';
      lastRequestedFrom = url.searchParams.get('from') || '';
      lastRequestedTo = url.searchParams.get('to') || '';

      const is7d = lastRequestedPeriod === '7d';

      const mockAnalytics = {
        period: {
          key: lastRequestedPeriod,
          from: lastRequestedFrom || (is7d ? '2026-08-14T00:00:00.000Z' : '2026-07-22T00:00:00.000Z'),
          to: lastRequestedTo || '2026-08-21T18:00:00.000Z',
          label: is7d ? 'Últimos 7 días' : lastRequestedPeriod === 'custom' ? 'Rango personalizado' : 'Últimos 30 días',
        },
        summary: {
          totalUniqueContacts: is7d ? 48 : 142,
          totalIncomingMessages: is7d ? 110 : 380,
          totalMenuInteractions: is7d ? 85 : 295,
          totalMenuOptionsRecognized: is7d ? 72 : 260,
          totalUnrecognizedMessages: is7d ? 12 : 45,
          totalOrdersStarted: is7d ? 18 : 68,
          totalOrdersSubmitted: is7d ? 14 : 52,
          totalAdvisorRequests: is7d ? 9 : 34,
          contactsWithoutMenuCount: is7d ? 5 : 18,
          contactsWithoutBotResponseCount: is7d ? 3 : 10,
          menuOptionRate: is7d ? 65.5 : 68.4,
          unrecognizedRate: is7d ? 10.9 : 11.8,
        },
        menuOptions: [
          { id: 'horarios', label: 'Horarios', number: '1', count: is7d ? 15 : 54, uniqueContacts: is7d ? 12 : 44, percentage: 20.8 },
          { id: 'direccion', label: 'Dirección', number: '2', count: is7d ? 10 : 42, uniqueContacts: is7d ? 9 : 36, percentage: 16.2 },
          { id: 'lista_precio', label: 'Precios', number: '3', count: is7d ? 18 : 60, uniqueContacts: is7d ? 15 : 51, percentage: 23.1 },
          { id: 'hacer_pedido', label: 'Nuevo Pedido', number: '4', count: is7d ? 18 : 68, uniqueContacts: is7d ? 14 : 52, percentage: 26.2 },
          { id: 'asesor', label: 'Asesor Humano', number: '5', count: is7d ? 7 : 22, uniqueContacts: is7d ? 6 : 20, percentage: 8.5 },
          { id: 'preguntas_frecuentes', label: 'Preguntas frecuentes', number: '6', count: is7d ? 4 : 14, uniqueContacts: is7d ? 4 : 12, percentage: 5.4 },
        ],
        trend: [
          { date: '2026-08-19', incomingMessages: 25, menuInteractions: 20, menuRequested: 2, optionsRecognized: 18, unrecognized: 3, uniqueContacts: 15 },
          { date: '2026-08-20', incomingMessages: 30, menuInteractions: 24, menuRequested: 2, optionsRecognized: 22, unrecognized: 4, uniqueContacts: 18 },
          { date: '2026-08-21', incomingMessages: 20, menuInteractions: 16, menuRequested: 1, optionsRecognized: 15, unrecognized: 2, uniqueContacts: 12 },
        ],
        unrecognizedMessages: {
          total: is7d ? 12 : 45,
          uniqueContacts: is7d ? 10 : 38,
          topPatterns: [
            { text: 'Tienen queso azul?', normalizedText: 'tienen queso azul', count: is7d ? 4 : 12, uniqueContacts: is7d ? 3 : 10, lastSeenAt: '2026-08-20T14:30:00.000Z' },
            { text: 'Hacen envios a Villa Carlos Paz?', normalizedText: 'hacen envios a villa carlos paz', count: is7d ? 3 : 8, uniqueContacts: is7d ? 3 : 7, lastSeenAt: '2026-08-20T12:00:00.000Z' },
            { text: 'Aceptan tarjeta de credito?', normalizedText: 'aceptan tarjeta de credito', count: is7d ? 2 : 6, uniqueContacts: is7d ? 2 : 5, lastSeenAt: '2026-08-19T10:15:00.000Z' },
          ],
          items: [
            { id: 'unrec-1', contactId: 'cont-1', contactName: 'Juan Perez', phone: '5491112345678', rawText: 'Tienen queso azul?', normalizedText: 'tienen queso azul', messageType: 'text', createdAt: '2026-08-20T14:30:00.000Z' },
            { id: 'unrec-2', contactId: 'cont-2', contactName: 'Carlos Lopez', phone: '5491187654321', rawText: 'Hacen envios a Villa Carlos Paz?', normalizedText: 'hacen envios a villa carlos paz', messageType: 'text', createdAt: '2026-08-20T12:00:00.000Z' },
          ],
        },
        contactsWithoutMenu: {
          total: is7d ? 5 : 18,
          withoutBotResponse: is7d ? 3 : 10,
          items: [
            { id: 'cont-no-menu-1', name: 'Maria Gomez', publicName: 'Maria Gomez', phone: '5491199887766', pipelineStatus: 'new', lastMessageAt: '2026-08-20T16:00:00.000Z', lastIncomingAt: '2026-08-20T16:00:00.000Z', messageCount: 3, botResponseCount: 1, lastBotResponseAt: '2026-08-20T16:00:10.000Z', responseStatus: 'responded' },
            { id: 'cont-no-menu-2', name: 'Roberto Sanchez', publicName: 'Roberto Sanchez', phone: '5491144332211', pipelineStatus: 'in_attention', lastMessageAt: '2026-08-19T18:00:00.000Z', lastIncomingAt: '2026-08-19T18:00:00.000Z', messageCount: 2, botResponseCount: 0, lastBotResponseAt: null, responseStatus: 'unanswered' },
          ],
        },
        coverage: {
          hasTrackingData: true,
          earliestEventAt: '2026-08-01T00:00:00.000Z',
          totalEventsTracked: is7d ? 120 : 420,
          note: 'Métricas generadas a partir de eventos persistidos en el pipeline del worker. No contiene datos simulados ni mockeados.',
        },
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(mockAnalytics));
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 4002);
    });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ headless: true });

  try {
    // ══════════════════════════════════════════════════════
    // DESKTOP VERIFICATION (1280x800)
    // ══════════════════════════════════════════════════════
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(baseUrl);

    // 1. Verify navigation link exists in desktop sidebar and click it
    const analyticsNavBtn = page.getByRole('button', { name: 'Analíticas', exact: true });
    await analyticsNavBtn.waitFor({ state: 'visible' });
    await analyticsNavBtn.click();

    // 2. Verify Analytics title and header
    await page.waitForSelector('.analytics-layout');
    const headerTitle = await page.locator('.topbar-copy h1').innerText();
    assert.match(headerTitle, /Analíticas/i, 'La cabecera debe indicar Analíticas');

    // 3. Verify KPI Summary cards values
    const kpiTexts = await page.locator('.analytics-kpi-grid .stat-value').allInnerTexts();
    assert.ok(kpiTexts.length >= 4, 'Debe haber 4 tarjetas KPI principales');
    assert.equal(kpiTexts[0], '142', 'KPI contactos interactuando');
    assert.equal(kpiTexts[1], '260', 'KPI opciones reconocidas');
    assert.equal(kpiTexts[2], '45', 'KPI mensajes no entendidos');
    assert.equal(kpiTexts[3], '18', 'KPI contactos sin menú');

    const advisorFunnel = page.locator('.funnel-card').nth(1);
    assert.equal(await advisorFunnel.locator('.step-val').innerText(), '34', 'Las derivaciones a asesor deben incluir la opción 5');

    // 4. Verify the 6 menu options in table
    const optionRows = page.locator('.option-row');
    const optionCount = await optionRows.count();
    assert.equal(optionCount, 6, 'Deben listarse las 6 opciones del bot');

    const optionNames = await page.locator('.option-name').allInnerTexts();
    assert.ok(optionNames.some(n => /Horarios/i.test(n)), 'Opción Horarios');
    assert.ok(optionNames.some(n => /Dirección|Direccion/i.test(n)), 'Opción Dirección');
    assert.ok(optionNames.some(n => /Precios/i.test(n)), 'Opción Precios');
    assert.ok(optionNames.some(n => /Nuevo Pedido/i.test(n)), 'Opción Nuevo Pedido');
    assert.ok(optionNames.some(n => /Asesor Humano/i.test(n)), 'Opción Asesor Humano');
    assert.ok(optionNames.some(n => /Preguntas frecuentes/i.test(n)), 'Opción Preguntas frecuentes');

    // 4.1 Verify Daily Trend section in desktop
    const trendRows = page.locator('.trend-row');
    const trendRowCount = await trendRows.count();
    assert.equal(trendRowCount, 3, 'Deben listarse los 3 días de tendencia');
    const trendDates = await page.locator('.trend-date').allInnerTexts();
    assert.ok(trendDates.length >= 3, 'Fechas de tendencia presentes');
    assert.ok(trendDates.every(date => !/a\. m\.|p\. m\./i.test(date)), 'La tendencia debe mostrar fechas, no la hora 9:00 p. m.');
    assert.ok(await page.getByText('Cómo leer esta tabla', { exact: true }).count() > 0, 'La tendencia debe explicar sus métricas');
    assert.equal(await page.locator('.trend-row').first().locator('td').count(), 6, 'La tendencia debe mostrar las métricas diarias explicadas');

    // 5. Verify Unrecognized messages section: Patterns tab
    await page.waitForSelector('.analytics-section-card');
    const patternText = await page.locator('.raw-message-box code').first().innerText();
    assert.match(patternText, /Tienen queso azul\?/i, 'Debe mostrarse el texto del patrón no entendido');

    // 6. Switch to "Últimos mensajes" tab
    const recentTabBtn = page.getByRole('button', { name: /Últimos mensajes/i });
    await recentTabBtn.click();
    await page.waitForSelector('.raw-message-box.full');
    const recentRawText = await page.locator('.raw-message-box.full code').first().innerText();
    assert.match(recentRawText, /Tienen queso azul\?/i, 'Debe mostrarse el texto original en la pestaña de mensajes recientes');

    // 7. Verify Contacts without menu section
    const contactNoMenuName = await page.locator('strong:has-text("Maria Gomez")').first().innerText();
    assert.match(contactNoMenuName, /Maria Gomez/, 'Debe listarse el contacto sin menú');
    assert.ok(await page.getByText('Respondió', { exact: true }).count() > 0, 'Debe distinguir contactos con respuesta automática');
    assert.ok(await page.getByText('Sin respuesta', { exact: true }).count() > 0, 'Debe distinguir contactos sin respuesta automática');

    const unansweredFilter = page.getByRole('button', { name: /Sin respuesta \(/i });
    await unansweredFilter.click();
    assert.equal(await page.locator('strong:has-text("Maria Gomez")').count(), 0, 'El filtro sin respuesta no debe mostrar contactos respondidos');
    assert.ok(await page.locator('strong:has-text("Roberto Sanchez")').count() > 0, 'El filtro sin respuesta debe mostrar el contacto correcto');
    await page.getByRole('button', { name: /Todos sin menú \(/i }).click();

    // 7.1 Abrir chat must load the exact contact selected from analytics
    await page.getByRole('button', { name: 'Abrir chat', exact: true }).first().click();
    await page.waitForSelector('.chat');
    await page.waitForFunction(() => document.querySelector('.chat-head-info strong')?.textContent?.includes('Maria Gomez'));
    assert.equal(await page.locator('.chat-head-info strong').first().innerText(), 'Maria Gomez', 'Abrir chat debe abrir el contacto seleccionado');
    await page.getByRole('button', { name: 'Analíticas', exact: true }).click();
    await page.waitForSelector('.analytics-layout');

    // 8. Verify Range Filtering: switch to 7 days
    const btn7d = page.getByRole('button', { name: '7 días', exact: true });
    await btn7d.click();
    await page.waitForFunction(() => {
      const el = document.querySelector('.analytics-kpi-grid .stat-value');
      return el && el.textContent === '48';
    });
    assert.equal(lastRequestedPeriod, '7d', 'El parámetro period debe ser 7d');

    // 9. Verify Custom Range Filtering & Invalidation
    const btnCustom = page.getByRole('button', { name: 'Personalizado', exact: true });
    await btnCustom.click();
    await page.waitForSelector('.custom-range-form');

    const fromInput = page.locator('.custom-range-form input[type="date"]').first();
    const toInput = page.locator('.custom-range-form input[type="date"]').nth(1);

    // Inverted range test: from > to
    await fromInput.fill('2026-08-20');
    await toInput.fill('2026-08-01');
    const applyBtn = page.getByRole('button', { name: 'Aplicar rango' });
    const isDisabled = await applyBtn.isDisabled();
    assert.ok(isDisabled, 'El botón de aplicar rango debe estar deshabilitado con fechas invertidas');
    const errorHint = await page.locator('.range-error-hint').innerText();
    assert.match(errorHint, /Desde.*anterior.*Hasta/i, 'Mensaje de error de rango invertido');

    // Valid range test
    await fromInput.fill('2026-08-01');
    await toInput.fill('2026-08-15');
    assert.equal(await applyBtn.isDisabled(), false, 'El botón debe habilitarse con fechas válidas');
    await applyBtn.click();
    await page.waitForFunction(() => document.querySelector('.analytics-layout') !== null);
    assert.equal(lastRequestedPeriod, 'custom', 'El parámetro period debe ser custom');
    assert.equal(lastRequestedFrom, '2026-08-01', 'Fecha desde en custom');
    assert.equal(lastRequestedTo, '2026-08-15', 'Fecha hasta en custom');

    // ══════════════════════════════════════════════════════
    // MOBILE VERIFICATION (390x844)
    // ══════════════════════════════════════════════════════
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(baseUrl);

    // Mobile bottom navigation should have Analíticas button
    const mobileAnalyticsBtn = page.getByRole('button', { name: 'Analíticas', exact: true });
    await mobileAnalyticsBtn.waitFor({ state: 'visible' });
    await mobileAnalyticsBtn.click();

    await page.waitForSelector('.analytics-layout');

    // Check no horizontal overflow on mobile
    const overflowMobile = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    assert.ok(
      overflowMobile.documentWidth <= overflowMobile.viewportWidth + 1,
      `Overflow horizontal detectado en Analíticas mobile: doc ${overflowMobile.documentWidth} > view ${overflowMobile.viewportWidth}`
    );

    // Check single column layout for KPI cards
    const kpiGridCols = await page.locator('.analytics-kpi-grid').evaluate((el) => {
      return window.getComputedStyle(el).gridTemplateColumns;
    });
    // Single column means only 1 width track (no space separated values)
    assert.ok(!kpiGridCols.includes(' '), `En mobile las tarjetas KPI deben estar en 1 sola columna (encontrado: ${kpiGridCols})`);

    // Check tables (including daily trend table) are horizontally scrollable without breaking page viewport
    const mobileTrendRows = page.locator('.trend-row');
    assert.ok((await mobileTrendRows.count()) >= 3, 'Tabla de tendencia visible en mobile');
    const trendTableScroll = await page.locator('.table-responsive-trend').evaluate((el) => ({
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
    }));
    assert.ok(trendTableScroll.scrollWidth > trendTableScroll.clientWidth, 'La tabla mobile debe quedar contenida en su propio scroll');
    const mobileChartHeight = await page.locator('.recharts-responsive-box').evaluate((el) => el.getBoundingClientRect().height);
    assert.ok(mobileChartHeight >= 240, 'El gráfico mobile debe conservar una altura útil (encontrado: ' + mobileChartHeight + ')');
    const mobileFunnelDirection = await page.locator('.funnel-pipeline').first().evaluate((el) => window.getComputedStyle(el).flexDirection);
    assert.equal(mobileFunnelDirection, 'column', 'El embudo debe apilarse en mobile');
    const mobileTabHeight = await page.getByRole('button', { name: /Últimos mensajes/i }).evaluate((el) => el.getBoundingClientRect().height);
    assert.ok(mobileTabHeight >= 40, 'Las pestañas de Analíticas deben ser táctiles en mobile');

    // Mobile navigation from analytics must open the selected chat, not only change the route.
    await page.getByRole('button', { name: /Todos sin menú \(/i }).click();
    await page.getByRole('button', { name: 'Abrir chat', exact: true }).first().click();
    await page.waitForFunction(() => document.body.classList.contains('mobile-chat-open'));
    await page.waitForFunction(() => document.querySelector('.chat-head-info strong')?.textContent?.includes('Maria Gomez'));
    assert.equal(await page.locator('.chat-head-info strong').first().innerText(), 'Maria Gomez', 'Abrir chat debe funcionar también en mobile');

    console.log('analytics Playwright E2E tests: OK');
    await page.close();
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
