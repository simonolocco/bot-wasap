import { chromium } from 'playwright';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as assert from 'assert';

export async function startServer(): Promise<http.Server> {
  return new Promise((resolve) => {
    let allRead = false;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const pathname = url.pathname;
      console.log('REQ:', req.method, req.url);

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (req.method === 'OPTIONS') { res.writeHead(200); return res.end(); }

      const sendJson = (data: any) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };

      if (pathname === '/api/auth/me') { allRead = false; return sendJson({ user: 'qa-admin' }); }
      if (pathname === '/sw.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end('self.addEventListener("install", () => {});'); }
      if (pathname.startsWith('/api/stream') || pathname.match(/^\/api\/conversations\/[^\/]+\/stream$/)) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); return; }

      if (pathname === '/api/dashboard') return sendJson({ work: { unread: 0, overdueFollowUps: 0, newOrders: 0, openTickets: 0 }, stats: { total: 0 }, transport: 'mock', cloudReady: true, worker: { healthy: true } });
      if (pathname === '/api/dashboard/work') return sendJson({ unread: 0, overdueFollowUps: 0, newOrders: 0, openTickets: 0 });
      if (pathname === '/api/analytics') return sendJson({
        period: { label: 'Últimos 30 días', from: new Date().toISOString(), to: new Date().toISOString() },
        coverage: { earliestEventAt: null, totalEventsTracked: 0 },
        summary: { totalNewContacts: 0, unrecognizedCount: 0, contactsWithoutMenuCount: 0, contactsWithoutBotResponseCount: 0, totalUniqueContacts: 0, totalIncomingMessages: 0, totalMenuOptionsRecognized: 0, totalMenuInteractions: 0, totalUnrecognizedMessages: 0, totalOrdersStarted: 0, totalOrdersSubmitted: 0, totalAdvisorRequests: 0 },
        trend: [],
        newContactsByDay: [],
        menuOptions: [],
        unrecognizedMessages: { uniqueContacts: 0, topPatterns: [], items: [] },
        contactsWithoutMenu: { items: [], total: 0 }
      });
      if (pathname === '/api/conversations/stats') return sendJson({
        totalConversations: 2,
        unreadConversations: allRead ? 0 : 2,
        unreadMessages: allRead ? 0 : 3,
        totalMessages: 7,
        openTickets: 1,
      });
      if (pathname === '/api/conversations/read-all' && req.method === 'POST') {
        allRead = true;
        return sendJson({
          contactsUpdated: 2,
          messagesMarkedRead: 3,
          stats: { totalConversations: 2, unreadConversations: 0, unreadMessages: 0, totalMessages: 7, openTickets: 1 },
        });
      }
      if (pathname === '/api/orders') return sendJson({ items: [], total: 0 });
      if (pathname === '/api/contacts') return sendJson({ items: [], total: 0 });
      if (pathname === '/api/templates') return sendJson({ items: [] });
      if (pathname === '/api/tickets') return sendJson({ items: [{ id: 'tick-mob-1', contactId: 'conv-mob-1', ticketType: 'question', status: 'open', openedAt: new Date().toISOString(), openedBy: 'user', createdAt: new Date().toISOString(), contactName: 'Cliente' }], total: 1 });
      if (pathname === '/api/conversations') {
        const cursor = url.searchParams.get('cursor');
        if (cursor === 'page-2') return sendJson({
          items: [{ id: 'conv-mob-2', phone: '5491109876543', name: 'Segundo cliente', pipelineStatus: 'new', lastMessageAt: new Date(Date.now() - 1000).toISOString(), lastIncomingAt: new Date(Date.now() - 1000).toISOString(), unreadCount: allRead ? 0 : 2, botPaused: false, labels: [] }],
          nextCursor: null,
        });
        return sendJson({
          items: [{ id: 'conv-mob-1', phone: '5491101234567', name: 'Cliente', pipelineStatus: 'new', lastMessageAt: new Date().toISOString(), lastIncomingAt: new Date().toISOString(), unreadCount: allRead ? 0 : 1, ticketStatus: 'open', botPaused: false, labels: [] }],
          nextCursor: 'page-2',
        });
      }
      if (pathname.match(/^\/api\/conversations\/[^\/]+$/)) return sendJson({ contact: { id: 'conv-mob-1', phone: '54911', name: 'Cliente', pipelineStatus: 'new', botPaused: false, labels: [], fields: {}, lastMessageAt: new Date().toISOString(), lastIncomingAt: new Date().toISOString() }, openTicket: { id: 'tick-mob-1', contactId: 'conv-mob-1', ticketType: 'question', status: 'open', openedAt: new Date().toISOString(), openedBy: 'user', createdAt: new Date().toISOString() }, tickets: [] });
      if (pathname.match(/^\/api\/conversations\/[^\/]+\/read/)) return sendJson({ unreadCount: 0 });
      if (pathname.match(/^\/api\/tickets\/[^\/]+\/close$/)) return sendJson({ success: true });

      if (pathname.match(/^\/api\/conversations\/[^\/]+\/messages/)) {
        if (req.method === 'GET') {
          if (url.searchParams.get('before') === 'older-page') return sendJson({
            items: [{ id: 'msg-old', contactId: 'conv-mob-1', direction: 'incoming', body: 'Mensaje anterior cargado automáticamente', messageType: 'text', createdAt: new Date(Date.now() - 86_400_000).toISOString(), deliveryStatus: 'delivered' }],
            nextBefore: null,
          });
          return sendJson({ items: [
            { id: 'msg-1', contactId: 'conv-mob-1', direction: 'incoming', body: 'Mensaje', createdAt: new Date().toISOString(), deliveryStatus: 'delivered' },
            { id: 'msg-reaction', contactId: 'conv-mob-1', direction: 'incoming', body: '[Mensaje reaction recibido]', messageType: 'reaction', createdAt: new Date().toISOString(), deliveryStatus: 'delivered' },
            { id: 'msg-sticker', contactId: 'conv-mob-1', direction: 'incoming', body: '', messageType: 'sticker', mediaId: 'stk-1', mediaStatus: 'ready', createdAt: new Date().toISOString(), deliveryStatus: 'delivered' },
            { id: 'msg-video', contactId: 'conv-mob-1', direction: 'incoming', body: '', messageType: 'video', mediaId: 'vid-1', mediaStatus: 'ready', createdAt: new Date().toISOString(), deliveryStatus: 'delivered' },
            { id: 'msg-audio-pending', contactId: 'conv-mob-1', direction: 'incoming', body: '', messageType: 'audio', mediaId: 'aud-1', mediaStatus: 'pending', createdAt: new Date().toISOString(), deliveryStatus: 'delivered' },
            { id: 'msg-document-failed', contactId: 'conv-mob-1', direction: 'incoming', body: '', messageType: 'document', mediaId: 'doc-1', mediaStatus: 'failed', createdAt: new Date().toISOString(), deliveryStatus: 'delivered' }
          ], nextBefore: 'older-page' });
        }
        if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk.toString());
          req.on('end', () => {
            let data; try { data = JSON.parse(body); } catch { data = {}; }
            sendJson({ id: 'msg-new', contactId: 'conv-mob-1', direction: 'outgoing', body: data.body, createdAt: new Date().toISOString(), deliveryStatus: 'sent' });
          });
          return;
        }
      }

      if (pathname.match(/^\/api\/media\//)) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return res.end();
      }

      const filePath = path.join(process.cwd(), 'public', 'admin', pathname === '/' ? 'index.html' : pathname);
      fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
          const fallbackPath = path.join(process.cwd(), 'public', 'admin', 'index.html');
          fs.readFile(fallbackPath, (fallbackErr, data) => {
            if (fallbackErr) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
            res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(data);
          });
          return;
        }
        const ext = path.extname(filePath);
        const mimeTypes: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function run() {
  const server = await startServer();
  const address = server.address();
  const port = typeof address === 'string' ? 0 : address?.port;
  if (!port) throw new Error('Servidor no inicio puerto');

  const browser = await chromium.launch({ headless: true });

  try {
    const viewports = [
      { width: 320, height: 568 },
      { width: 360, height: 800 },
      { width: 390, height: 844 },
      { width: 1280, height: 720 },
    ];

    for (const viewport of viewports) {
      console.log(`\nProbando viewport: ${viewport.width}x${viewport.height}`);
      const isMobile = viewport.width < 768;

      for (const scheme of ['dark', 'light']) {
        const context = await browser.newContext({
          viewport, colorScheme: scheme as "dark" | "light",
          userAgent: isMobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' : undefined,
          isMobile, hasTouch: isMobile
        });
        await context.addInitScript(theme => localStorage.setItem('abasto-theme', theme), scheme);
        const page = await context.newPage();
        page.on('console', msg => { if (msg.type() === 'error') throw new Error(`[${scheme.toUpperCase()} ERROR] ${msg.text()}`); });
        page.on('pageerror', err => { throw new Error(`[${scheme.toUpperCase()} PAGE ERROR] ${err}`); });
        page.on('response', resp => { if (resp.status() >= 400) throw new Error(`HTTP ERR (${scheme}): ${resp.status()} ${resp.url()}`); });

        await page.goto(`http://127.0.0.1:${port}/`);
        await page.waitForSelector('.sidebar-nav .sidebar-link');

        assert.equal(await page.locator('html').getAttribute('data-theme'), scheme);
        await page.waitForFunction(() => document.querySelectorAll('.conv-row').length === 2);
        assert.equal(await page.locator('.conv-row').count(), 2, 'debe cargar automáticamente todas las páginas de conversaciones');
        assert.equal(await page.locator('.load-more').count(), 0, 'no debe depender de Cargar más conversaciones');
        assert.ok(await page.getByText('Mensajes totales', { exact: true }).count() > 0, 'debe mostrar mensajes totales');
        assert.ok(await page.getByText('Tickets abiertos', { exact: true }).count() > 0, 'debe mostrar tickets abiertos');
        const markAllRead = page.getByRole('button', { name: 'Marcar todo como leído' });
        await markAllRead.click();
        await page.waitForFunction(() => document.querySelectorAll('.unread-badge').length === 0);
        assert.ok(await markAllRead.isDisabled(), 'marcar todo debe quedar deshabilitado cuando no quedan mensajes sin leer');

        const ticketsNavBtn = page.locator('.sidebar-nav .sidebar-link').filter({ hasText: 'Tickets' });
        await ticketsNavBtn.click();
        await page.waitForSelector('.interactive-row');
        const ticketRow = page.locator('.interactive-row').first();

        const atenderBtn = ticketRow.locator('button').filter({ hasText: 'Atender' }).first();
        await atenderBtn.waitFor({ state: 'visible' });
        await atenderBtn.click();

        const textarea = page.locator('.composer-input textarea');
        await textarea.waitFor({ state: 'visible' });
        await page.getByText('Mensaje anterior cargado automáticamente', { exact: true }).waitFor({ state: 'attached' });

        const composerBox = await page.locator('.composer').boundingBox();
        const textareaBox = await textarea.boundingBox();
        assert.ok(composerBox && composerBox.y + composerBox.height <= viewport.height + 1, 'composer overflow');
        assert.ok(textareaBox && textareaBox.y + textareaBox.height <= viewport.height + 1, 'textarea overflow');

        await textarea.fill('Mock reply');
        await page.locator('.send-btn').first().click();
        await page.waitForFunction(() => {
          const el = document.querySelector('.composer-input textarea') as HTMLTextAreaElement;
          return el && el.value === '';
        });
        assert.equal(await textarea.inputValue(), '');

        // Assert sticker/video rendering
        const stickerImg = page.locator('.message-bubble img').first();
        await stickerImg.waitFor({ state: 'visible' });
        const videoElem = page.locator('.message-bubble video').first();
        await videoElem.waitFor({ state: 'visible' });
        assert.ok(await videoElem.getAttribute('controls') !== null, 'video needs controls');
        assert.ok(await page.getByText('Reacción recibida', { exact: true }).count() > 0, 'Las reacciones históricas no deben quedar como burbujas vacías');
        assert.ok(await page.getByText('Preparando audio…', { exact: true }).count() > 0, 'El audio pendiente debe mostrar su estado');
        assert.ok(await page.getByText('No se pudo preparar este archivo.', { exact: true }).count() > 0, 'El archivo fallido debe mostrar su estado');

        const msgBubble = page.locator('.message-bubble').first();
        await msgBubble.scrollIntoViewIfNeeded();
        await msgBubble.locator('.message-actions-trigger').click();
        const replyAction = page.locator('.message-actions-floating').getByRole('button', { name: 'Responder', exact: true });
        await replyAction.click();
        console.log('replyBar wait');
        const replyBar = page.locator('.reply-bar');
        await replyBar.waitFor({ state: 'visible' });
        await page.locator('.reply-bar__dismiss').click();

        console.log('mediaMsg wait');
        const mediaMsg = page.locator('.message-bubble[data-message-id="msg-sticker"]');
        await mediaMsg.scrollIntoViewIfNeeded();
        await mediaMsg.locator('.message-actions-trigger').click();
        const downloadAction = page.locator('.message-actions a').filter({ hasText: 'Descargar' }).first();
        await downloadAction.waitFor({ state: 'visible' });
        await page.keyboard.press('Escape');
        const controlsToggle = page.locator('.chat-controls-toggle');
        if (await controlsToggle.isVisible() && await controlsToggle.getAttribute('aria-expanded') !== 'true') await controlsToggle.click();
        console.log('finalizeBtn wait');
        console.log('finalizeBtn click');
        const finalizeBtn = page.locator('button').filter({ hasText: 'Finalizar consulta' }).first();
        await finalizeBtn.click();

        console.log('modalSheet wait');
        const modalSheet = page.locator('.close-modal-sheet');
        await modalSheet.waitFor({ state: 'visible' });

        assert.equal(await modalSheet.getAttribute('role'), 'dialog');
        assert.equal(await modalSheet.getAttribute('aria-modal'), 'true');
        const modalBox = await modalSheet.boundingBox();
        assert.ok(modalBox && modalBox.width <= viewport.width + 1, 'modal overflow');

        const backdrop = page.locator('.modal-backdrop');
        assert.ok(await backdrop.getAttribute('aria-hidden') !== 'true', 'backdrop must not have aria-hidden true');

        console.log('cancelBtn click');
        await page.locator('.modal-actions button').filter({ hasText: 'Cancelar' }).click();
        await modalSheet.waitFor({ state: 'hidden' });

        console.log('backBtn click');
        if (isMobile) {
          const backBtn = page.locator('.mobile-back').first();
          await backBtn.click();
          await page.waitForFunction(() => !document.body.classList.contains('mobile-chat-open'));
        }
        console.log('routes loop');

        const routes = [{ name: 'Resumen', expected: '.dashboard-hero' }, { name: 'Conversaciones', expected: '.inbox-shell' }, { name: 'Contactos', expected: '.data-page' }, { name: 'Pedidos', expected: '.data-page' }, { name: 'Plantillas', expected: '.data-page' }, { name: 'Analíticas', expected: '.analytics-section-card' }];
        for (const route of routes) {
          console.log('visiting route: ' + route.name);
          const link = page.getByRole('button', { name: route.name, exact: true });
          if (!await link.isVisible()) await page.getByRole('button', { name: 'Más secciones', exact: true }).click();
          await link.click();
          try {
            await page.waitForSelector(route.expected, { state: 'visible', timeout: 5000 });
          } catch (e) {
            console.log('Timeout waiting for', route.expected);
            console.log(await page.evaluate(() => document.body.innerHTML));
            throw e;
          }
          const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
          assert.ok(scrollW <= viewport.width + 1, `Horizontal overflow in ${route.name}`);
        }

        await context.close();
      }
    }
    console.log('Mobile tests: OK');
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

if (require.main === module) run().catch((err) => {
  console.error(err);
  process.exit(1);
});
