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
  let customRequestCount = 0;

  const topPatterns = [
    { text: 'Tienen queso azul?', normalizedText: 'tienen queso azul', count: 12, uniqueContacts: 10, lastSeenAt: '2026-08-20T14:30:00.000Z' },
    { text: 'Hacen envíos especiales?', normalizedText: 'hacen envios especiales', count: 8, uniqueContacts: 7, lastSeenAt: '2026-08-20T12:00:00.000Z' },
    { text: 'Aceptan tarjeta de crédito?', normalizedText: 'aceptan tarjeta de credito', count: 6, uniqueContacts: 5, lastSeenAt: '2026-08-19T10:15:00.000Z' },
    ...Array.from({ length: 9 }, (_, index) => ({
      text: `Consulta adicional ${index + 1}`,
      normalizedText: `consulta adicional ${index + 1}`,
      count: 5 - Math.min(index, 4),
      uniqueContacts: 2,
      lastSeenAt: `2026-08-${String(18 - index).padStart(2, '0')}T10:00:00.000Z`,
    })),
  ];
  const recentUnrecognizedItems = Array.from({ length: 12 }, (_, index) => ({
    id: `unrec-${index + 1}`,
    contactId: `cont-${index + 1}`,
    contactName: index === 0 ? 'Juan Perez' : `Contacto ${index + 1}`,
    phone: `549111234${String(5678 + index).padStart(4, '0')}`,
    rawText: index === 0 ? 'Tienen queso azul?' : `Consulta adicional ${index}`,
    normalizedText: index === 0 ? 'tienen queso azul' : `consulta adicional ${index}`,
    messageType: 'text',
    createdAt: `2026-08-20T${String(14 - Math.min(index, 9)).padStart(2, '0')}:30:00.000Z`,
  }));
  const contactsWithoutMenuItems = [
    { id: 'cont-no-menu-1', name: 'Maria Gomez', publicName: 'Maria Gomez', phone: '5491199887766', pipelineStatus: 'new', lastMessageAt: '2026-08-20T16:00:00.000Z', lastIncomingAt: '2026-08-20T16:00:00.000Z', messageCount: 3, botResponseCount: 1, lastBotResponseAt: '2026-08-20T16:00:10.000Z', responseStatus: 'responded' as const },
    { id: 'cont-no-menu-2', name: 'Roberto Sanchez', publicName: 'Roberto Sanchez', phone: '5491144332211', pipelineStatus: 'in_attention', lastMessageAt: '2026-08-19T18:00:00.000Z', lastIncomingAt: '2026-08-19T18:00:00.000Z', messageCount: 2, botResponseCount: 0, lastBotResponseAt: null, responseStatus: 'unanswered' as const },
    ...Array.from({ length: 16 }, (_, index) => {
      const unanswered = index < 9;
      return {
        id: `cont-no-menu-${index + 3}`,
        name: `Cliente ${index + 3}`,
        publicName: `Cliente ${index + 3}`,
        phone: `549115550${String(index + 3).padStart(4, '0')}`,
        pipelineStatus: 'new',
        lastMessageAt: '2026-08-18T16:00:00.000Z',
        lastIncomingAt: '2026-08-18T16:00:00.000Z',
        messageCount: 1,
        botResponseCount: unanswered ? 0 : 1,
        lastBotResponseAt: unanswered ? null : '2026-08-18T16:00:10.000Z',
        responseStatus: unanswered ? 'unanswered' as const : 'responded' as const,
      };
    }),
  ];

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

    if (pathname === '/api/conversations/stats' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        totalConversations: 1,
        unreadConversations: 0,
        unreadMessages: 0,
        totalMessages: 2,
        openTickets: 0,
      }));
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
      if (lastRequestedPeriod === 'custom') customRequestCount += 1;

      const is7d = lastRequestedPeriod === '7d';
      const is90d = lastRequestedPeriod === '90d';
      const isCustom = lastRequestedPeriod === 'custom';
      const totalUniqueContacts = is7d ? 48 : is90d ? 365 : isCustom ? 77 : 142;

      const mockAnalytics = {
        period: {
          key: lastRequestedPeriod,
          from: lastRequestedFrom || (is7d ? '2026-08-14T00:00:00.000Z' : '2026-07-22T00:00:00.000Z'),
          to: lastRequestedTo || '2026-08-21T18:00:00.000Z',
          label: is7d ? 'Últimos 7 días' : is90d ? 'Últimos 90 días' : isCustom ? 'Rango personalizado' : 'Últimos 30 días',
        },
        summary: {
          totalUniqueContacts,
          totalNewContacts: is7d ? 23 : 35,
          totalReturningContacts: is7d ? 16 : 29,
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
        newContactsByDay: [
          { date: '2026-08-19', newContacts: is7d ? 8 : 12 },
          { date: '2026-08-20', newContacts: is7d ? 10 : 15 },
          { date: '2026-08-21', newContacts: is7d ? 5 : 8 },
        ],
        returningContactsByDay: [
          { date: '2026-08-19', returningContacts: is7d ? 4 : 9 },
          { date: '2026-08-20', returningContacts: is7d ? 7 : 11 },
          { date: '2026-08-21', returningContacts: is7d ? 5 : 9 },
        ],
        unrecognizedMessages: {
          total: is7d ? 12 : 45,
          uniqueContacts: is7d ? 10 : 38,
          topPatterns,
          items: recentUnrecognizedItems,
        },
        contactsWithoutMenu: {
          total: is7d ? 5 : 18,
          withoutBotResponse: is7d ? 3 : 10,
          items: contactsWithoutMenuItems,
        },
        coverage: {
          hasTrackingData: true,
          earliestEventAt: '2026-08-01T00:00:00.000Z',
          totalEventsTracked: is7d ? 120 : 420,
          note: 'Métricas generadas a partir de eventos persistidos en el pipeline del worker. No contiene datos simulados ni mockeados.',
        },
      };

      const respond = () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mockAnalytics));
      };
      if (is90d) return setTimeout(respond, 180);
      return respond();
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

    // 4.2 Verify Desktop Chart Height > 0
    const desktopChartHeight = await page.locator('.recharts-responsive-box').first().evaluate((el) => el.getBoundingClientRect().height);
    assert.ok(desktopChartHeight > 0, 'El gráfico desktop debe tener una altura computable mayor que cero (encontrado: ' + desktopChartHeight + ')');

    // 4.2b Verify New Contacts by Day Bar Chart
    const newContactsSection = page.locator('section[aria-label="Contactos nuevos y recurrentes por día"]');
    assert.ok(await newContactsSection.count() > 0, 'Sección de contactos nuevos por día debe existir');
    const newContactsBarBox = newContactsSection.locator('.recharts-bar-box');
    const barBoxHeight = await newContactsBarBox.evaluate((el) => el.getBoundingClientRect().height);
    assert.ok(barBoxHeight > 0, 'El gráfico de barras de contactos nuevos debe tener altura computable');
    assert.equal(await newContactsBarBox.locator('.recharts-bar-rectangle').count(), 6, 'Deben renderizarse las barras de contactos nuevos y recurrentes');

    // 4.2c Verify Activity Chart date filter (From / To)
    const chartFromInput = page.locator('.chart-date-input').first();
    await chartFromInput.fill('2026-08-20');
    assert.equal(await page.locator('.trend-row').count(), 2, 'Filtrar desde el 20 debe mostrar 2 días');
    await page.locator('.chart-date-clear').click();
    assert.equal(await page.locator('.trend-row').count(), 3, 'Limpiar filtro del gráfico debe restaurar todos los días');

    // 4.3 Every chart-series filter must hide and restore its real series.
    const seriesLabels = ['Mensajes Entrantes', 'Opciones Reconocidas', 'Menú Solicitado', 'No Entendidos', 'Contactos Únicos'];
    assert.equal(await page.locator('.recharts-area').count(), 5, 'El gráfico debe comenzar con sus 5 series visibles');
    for (const label of seriesLabels) {
      const toggle = page.getByRole('button', { name: label, exact: true });
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false', `${label} debe quedar desactivada`);
      assert.equal(await page.locator('.recharts-area').count(), 4, `${label} debe ocultar una serie real`);
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-pressed'), 'true', `${label} debe poder restaurarse`);
      assert.equal(await page.locator('.recharts-area').count(), 5, `${label} debe restaurar la serie`);
    }

    // 5. Verify Unrecognized messages section: Patterns tab
    await page.waitForSelector('.analytics-section-card');
    const patternText = await page.locator('.raw-message-box code').first().innerText();
    assert.match(patternText, /Tienen queso azul\?/i, 'Debe mostrarse el texto del patrón no entendido');

    const patternTable = page.locator('.table-responsive-patterns');
    assert.match(await patternTable.locator('.page-indicator').innerText(), /Página 1 de 2/, 'Los patrones deben paginarse');
    await patternTable.getByRole('button', { name: 'Siguiente' }).click();
    assert.match(await patternTable.locator('.page-indicator').innerText(), /Página 2 de 2/, 'La segunda página de patrones debe abrirse');
    const patternSearch = page.getByPlaceholder('Filtrar patrones por palabra…');
    await patternSearch.fill('envios especiales');
    assert.equal(await page.locator('.table-responsive-patterns tbody tr').count(), 1, 'La búsqueda debe ignorar tildes y resetear la página');
    assert.match(await page.locator('.table-responsive-patterns tbody tr').innerText(), /envíos especiales/i, 'Debe encontrar “envíos” buscando “envios”');
    await page.getByRole('button', { name: 'Limpiar búsqueda' }).click();
    assert.match(await patternTable.locator('.page-indicator').innerText(), /Página 1 de 2/, 'Limpiar búsqueda debe volver a la primera página');

    // 6. Switch to "Últimos mensajes" tab
    const recentTabBtn = page.getByRole('button', { name: /Últimos mensajes/i });
    await recentTabBtn.click();
    await page.waitForSelector('.raw-message-box.full');
    const recentRawText = await page.locator('.raw-message-box.full code').first().innerText();
    assert.match(recentRawText, /Tienen queso azul\?/i, 'Debe mostrarse el texto original en la pestaña de mensajes recientes');
    const recentTable = page.locator('.table-responsive-recent');
    assert.match(await recentTable.locator('.page-indicator').innerText(), /Página 1 de 2/, 'Los mensajes recientes deben paginarse');
    await recentTable.getByRole('button', { name: 'Siguiente' }).click();
    assert.match(await recentTable.locator('.page-indicator').innerText(), /Página 2 de 2/, 'La segunda página de mensajes recientes debe abrirse');
    await page.getByRole('button', { name: /Patrones más frecuentes/i }).click();

    // 7. Verify Contacts without menu section
    const contactNoMenuName = await page.locator('strong:has-text("Maria Gomez")').first().innerText();
    assert.match(contactNoMenuName, /Maria Gomez/, 'Debe listarse el contacto sin menú');
    assert.ok(await page.getByText('Respondió', { exact: true }).count() > 0, 'Debe distinguir contactos con respuesta automática');
    assert.ok(await page.getByText('Sin respuesta', { exact: true }).count() > 0, 'Debe distinguir contactos sin respuesta automática');

    const contactsTableDesktop = page.locator('.table-responsive-contacts');
    assert.match(await contactsTableDesktop.locator('.page-indicator').innerText(), /Página 1 de 2/, 'Los contactos deben paginarse');
    await contactsTableDesktop.getByRole('button', { name: 'Siguiente' }).click();
    assert.match(await contactsTableDesktop.locator('.page-indicator').innerText(), /Página 2 de 2/, 'La segunda página de contactos debe abrirse');
    await contactsTableDesktop.getByRole('button', { name: 'Anterior' }).click();

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

    // 7.2 Clicking KPI card "Contactos sin menú" must navigate to inbox with active filter banner
    const kpiNoMenu = page.locator('.stat-card-actionable');
    await kpiNoMenu.click();
    await page.waitForSelector('.analytics-filter-banner');
    assert.match(await page.locator('.analytics-filter-banner').innerText(), /Contactos sin menú/i);
    await page.locator('.analytics-filter-banner-clear').click();
    assert.equal(await page.locator('.analytics-filter-banner').count(), 0, 'Limpiar filtro debe remover el banner');
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

    // 8.1 30/90-day filters and stale-response protection.
    const btn90d = page.getByRole('button', { name: '90 días', exact: true });
    await btn90d.click();
    await page.waitForFunction(() => document.querySelector('.analytics-kpi-grid .stat-value')?.textContent === '365');
    assert.equal(lastRequestedPeriod, '90d', 'El parámetro period debe ser 90d');
    const btn30d = page.getByRole('button', { name: '30 días', exact: true });
    await btn90d.click();
    await btn30d.click();
    await page.waitForFunction(() => document.querySelector('.analytics-kpi-grid .stat-value')?.textContent === '142');
    await page.waitForTimeout(250);
    assert.equal(await page.locator('.analytics-kpi-grid .stat-value').first().innerText(), '142', 'Una respuesta vieja de 90 días no debe sobrescribir el filtro de 30 días');
    assert.equal(await btn30d.getAttribute('aria-pressed'), 'true', '30 días debe seguir siendo el período activo');

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
    const customRequestsBeforeApply = customRequestCount;
    await applyBtn.click();
    await page.waitForFunction(() => document.querySelector('.analytics-layout') !== null);
    await page.waitForTimeout(50);
    assert.equal(lastRequestedPeriod, 'custom', 'El parámetro period debe ser custom');
    assert.equal(lastRequestedFrom, '2026-08-01', 'Fecha desde en custom');
    assert.equal(lastRequestedTo, '2026-08-15', 'Fecha hasta en custom');
    assert.equal(customRequestCount - customRequestsBeforeApply, 1, 'Aplicar un rango personalizado debe hacer una sola consulta');

    await fromInput.fill('2026-08-02');
    await toInput.fill('2026-08-16');
    const customRequestsBeforeReapply = customRequestCount;
    await applyBtn.click();
    await page.waitForFunction(() => document.querySelector('.analytics-coverage-banner')?.textContent?.includes('Rango personalizado'));
    assert.equal(lastRequestedFrom, '2026-08-02', 'Reaplicar debe usar la fecha desde actualizada');
    assert.equal(lastRequestedTo, '2026-08-16', 'Reaplicar debe usar la fecha hasta actualizada');
    assert.equal(customRequestCount - customRequestsBeforeReapply, 1, 'Reaplicar el rango debe hacer una sola consulta');

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
    const mobileChartHeight = await page.locator('.recharts-responsive-box').first().evaluate((el) => el.getBoundingClientRect().height);
    assert.ok(mobileChartHeight >= 240, 'El gráfico mobile debe conservar una altura útil (encontrado: ' + mobileChartHeight + ')');
    const mobileFunnelDirection = await page.locator('.funnel-pipeline').first().evaluate((el) => window.getComputedStyle(el).flexDirection);
    assert.equal(mobileFunnelDirection, 'column', 'El embudo debe apilarse en mobile');
    const mobileTabHeight = await page.getByRole('button', { name: /Últimos mensajes/i }).evaluate((el) => el.getBoundingClientRect().height);
    assert.ok(mobileTabHeight >= 40, 'Las pestañas de Analíticas deben ser táctiles en mobile');
    const contactsTable = page.locator('.table-responsive-contacts');
    const contactsScroll = await contactsTable.evaluate((el) => ({
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
    }));
    assert.ok(
      contactsScroll.scrollWidth <= contactsScroll.clientWidth + 1,
      'La tabla de contactos mobile debe mostrarse sin desborde horizontal'
    );
    const contactRowDisplay = await contactsTable.locator('tbody tr').first().evaluate((el) => window.getComputedStyle(el).display);
    assert.equal(contactRowDisplay, 'block', 'Los contactos deben presentarse como tarjetas en mobile');
    assert.match(await contactsTable.locator('tbody tr').first().innerText(), /Abrir chat/);

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
