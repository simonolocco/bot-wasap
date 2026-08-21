import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = process.cwd();
const adminDir = path.join(root, 'public', 'admin');

async function run() {
  let sentMessageBody = '';
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = url.pathname;

    if (pathname === '/' || pathname === '/index.html') {
      const html = fs.readFileSync(path.join(adminDir, 'index.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=ut-8' });
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
      return res.end(JSON.stringify({ user: 'qa-admin' }));
    }

    if (pathname === '/api/conversations' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        items: [
          {
            id: 'conv-mob-1',
            phone : '5491101234567',
            name: 'Cliente Mobile Fixture',
            publicName: 'Cliente Mobile Fixture',
            lastMessage: 'Hola, consulta de prueba mobile',
            lastDirection: 'incoming',
            lastMessageAt: new Date().toISOString(),
            unreadCount: 1,
            pipelineStatus: 'new',
            ticketStatus: null,
            botPaused: false,
            labels: ['VIP'],
          },
        ],
        cursor: null,
      }));
    }

    if (pathname === '/api/conversations/conv-mob-1/read') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ id: 'conv-mob-1', unreadCount: 0 }));
    }

    if (pathname === '/api/conversations/conv-mob-1' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        contact: {
          id: 'conv-mob-1',
          phone: '5491101234567',
          name: 'Cliente Mobile Fixture',
          publicName: 'Cliente Mobile Fixture',
          lastIncomingAt: new Date().toISOString(),
          pipelineStatus: 'new',
          consentStatus: 'opted_in',
          botPaused: false,
          labels: ['VIP'],
          notes: 'Cliente de prueba para viewport mobile',
        },
        openTicket: null,
        tickets: [],
        messageCount: 1,
        lastOrder: null,
      }));
    }

    if (pathname === '/api/conversations/conv-mob-1/messages' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        items: [
          {
            id: 'msg-mob-1',
            contactId: 'conv-mob-1',
            direction: 'incoming',
            body: 'Hola, consulta de prueba mobile',
            messageType: 'text',
            deliveryStatus: 'delivered',
            createdAt: new Date().toISOString(),
          },
        ],
        nextBefore: null,
      }));
    }

    if (pathname === '/api/conversations/conv-mob-1/messages' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');
        sentMessageBody = parsed.body || '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'msg-mob-out-1',
          contactId: 'conv-mob-1',
          direction: 'outgoing',
          body: sentMessageBody,
          messageType: 'text',
          deliveryStatus: 'sent',
          createdAt: new Date().toISOString(),
        }));
      });
      return;
    }

    if (pathname === '/api/conversations/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(': keepalive\n\n');
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  const port = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 4002);
    });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
    page.on('pageerror', err => console.error('BROWSER ERR:', err));

    await page.goto(baseUrl);

    // 1. Verificar carga inicial de la lista
    await page.waitForSelector('.conversation-pane', { state: 'visible' });
    const chatInitialCount = await page.locator('.chat').count();
    assert.equal(chatInitialCount, 0, 'en mobile inicial el panel de chat debe estar cerrado');

    // 2. Verificar que existe la conversación y seleccionarla
    const convRow = page.locator('.conv-row').first();
    await convRow.waitFor({ state: 'visible' });
    const rowText = (await convRow.textContent()) || '';
    assert.match(rowText, /Cliente Mobile Fixture/);

    await convRow.click();

    // 3. En mobile: al abrir chat, la lista se oculta y el chat se muestra
    await page.waitForFunction(() => document.body.classList.contains('mobile-chat-open'));
    const isPaneHidden = await page.locator('.conversation-pane').evaluate((el) => {
      const style = window.getComputedStyle(el);
      return style.display === 'none';
    });
    assert.equal(isPaneHidden, true, 'la lista de conversaciones debe ocultarse al abrir chat en mobile');

    const isChatVisible = await page.locator('.chat').evaluate((el) => {
      const htmlEl = el as HTMLElement;
      const style = window.getComputedStyle(el);
      return style.display === 'flex' && htmlEl.offsetWidth > 0 && htmlEl.offsetHeight > 0;
    });
    assert.equal(isChatVisible, true, 'el panel de chat debe ser visible en mobile');

    // 4. Verificar cabecera e historial de mensajes
    await page.waitForSelector('.chat-head');
    await page.waitForSelector('.messages');
    await page.waitForSelector('.message-bubble');
    const msgText = await page.locator('.message-text').innerText();
    assert.match(msgText, /Hola, consulta de prueba mobile/);

    // 5. Verificar compositor y envio manual
    const textarea = page.locator('.composer-input textarea');
    await textarea.waitFor({ state: 'visible' });
    assert.equal(await textarea.isEnabled(), true, 'el textarea del compositor debe estar habilitado');

    const sendBtn = page.locator('.send-btn');
    await sendBtn.waitFor({ state: 'visible' });
    assert.equal(await sendBtn.isDisabled(), true, 'el boton de envio debe estar deshabilitado cuando el textarea esta vacio');

    await textarea.fill('Respuesta manual verificada Playwright');
    assert.equal(await sendBtn.isEnabled(), true, 'el boton de envio debe habilitarse al escribir');

    await sendBtn.click();
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.composer-input textarea') as HTMLTextAreaElement | null;
        return el !== null && el.value === '';
      },
      { timeout: 10000 }
    );
    assert.equal(sentMessageBody, 'Respuesta manual verificada Playwright', 'el mensaje debe enviarse correctamente');
    assert.equal(await textarea.inputValue(), '', 'el textarea debe limpiarse tras el envio');

    // 6. Verificar boton volver y ausencia de overflow horizontal
    const backBtn = page.locator('.mobile-back');
    await backBtn.waitFor({ state: 'visible' });
    const backBtnDisplay = await backBtn.evaluate((el) => window.getComputedStyle(el).display);
    assert.match(backBtnDisplay, /inline-flex|flex/, 'el boton volver debe ser visible en mobile');

    const overflowWithChat = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    assert.ok(
      overflowWithChat.documentWidth <= overflowWithChat.viewportWidth + 1,
      `overflow horizontal detectado con chat abierto: doc ${overflowWithChat.documentWidth} > view ${overflowWithChat.viewportWidth}`
    );

    // 7. Volver a la lista
    await backBtn.click();
    const hasClassAfterBack = await page.locator('body').evaluate((el) => el.classList.contains('mobile-chat-open'));
    assert.equal(hasClassAfterBack, false, 'body no debe tener mobile-chat-open tras presionar volver');

    const isPaneVisibleAgain = await page.locator('.conversation-pane').evaluate((el) => {
      const htmlEl = el as HTMLElement;
      const style = window.getComputedStyle(el);
      return style.display === 'flex' && htmlEl.offsetWidth > 0;
    });
    assert.equal(isPaneVisibleAgain, true, 'la lista debe volver a ser visible tras presionar volver');

    const isChatHiddenAgain = await page.locator('.chat').evaluate((el) => {
      const style = window.getComputedStyle(el);
      return style.display === 'none';
    });
    assert.equal(isChatHiddenAgain, true, 'el chat debe ocultarse al volver a la lista');

    const overflowWithList = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    assert.ok(
      overflowWithList.documentWidth <= overflowWithList.viewportWidth + 1,
      `overflow horizontal detectado con lista: doc ${overflowWithList.documentWidth} > view ${overflowWithList.viewportWidth}`
    );

    // 8. Verificar Desktop
    await page.setViewportSize({ width: 1280, height: 720 });
    const desktopPane = await page.locator('.conversation-pane').evaluate((el) => window.getComputedStyle(el).display);
    assert.match(desktopPane, /flex|block/, 'en desktop la lista debe estar visible');

    await convRow.click();
    const desktopChat = await page.locator('.chat').evaluate((el) => {
      const htmlEl = el as HTMLElement;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && htmlEl.offsetWidth > 0;
    });
    assert.equal(desktopChat, true, 'en desktop el chat debe estar visible');

    const desktopBack = await page.locator('.mobile-back').evaluate((el) => window.getComputedStyle(el).display);
    assert.equal(desktopBack, 'none', 'en desktop el boton volver debe estar oculto');

    console.log('mobile conversation Playwright E2E tests: OK');
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
