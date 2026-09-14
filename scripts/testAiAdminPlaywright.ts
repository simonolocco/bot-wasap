import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from '@playwright/test';

const adminDir = path.resolve('public/admin');
const now = '2026-09-13T14:00:00.000Z';
const invoicePreview = 'No tengo confirmada la emisión de factura A en este canal. Podés consultarlo con Mauricio antes de realizar el pedido.';
const label = { id: 'label-envios', name: 'envios', normalizedName: 'envios', answer: 'Coordinamos el traslado con un comisionista.', active: true,
  aliases: ['¿Hacen envíos?'], aliasCount: 1, createdAt: now, updatedAt: now };
const invoiceLabel = { id: 'label-facturacion', name: 'facturacion', normalizedName: 'facturacion', answer: invoicePreview, active: false,
  aliases: ['¿Emiten factura A?'], aliasCount: 1, createdBy: 'ai-auto-preview', createdAt: now, updatedAt: now };
let markedNoise = false;
let resolved = false;
let resolvedPayload: Record<string, unknown> | null = null;

function item(view: string) {
  const base = { id: `query-${view}`, contactId: 'contact-1', contactName: 'María Gómez', phone: '5493515550101',
    source: 'production', aiEnabled: true, matchedAnswerRuleId: null, matchedAnswerLabelId: null,
    suggestedLabelId: null, suggestedLabelName: null, tokens: 14, elapsedMs: 430, messageAt: now, createdAt: now, updatedAt: now };
  if (view === 'answered') return { ...base, question: '¿Aceptan transferencia?', answer: 'Los medios de pago deben confirmarse con el asesor.', previewAnswer: null, previewOutcome: null, previewSource: null, previewGeneratedAt: null, outcome: 'handoff', reviewStatus: 'resolved', classificationMethod: 'semantic', classificationConfidence: .9, model: 'fixture', errorCode: null };
  if (view === 'errors') return { ...base, question: '¿Trabajan con cuenta corriente?', answer: 'El servicio de IA no pudo procesar tu mensaje en este momento. Podés reintentarlo.', previewAnswer: 'El servicio de IA no pudo procesar tu mensaje en este momento. Podés reintentarlo.', previewOutcome: 'unavailable', previewSource: 'generated', previewGeneratedAt: now, outcome: 'unavailable', reviewStatus: 'resolved', classificationMethod: 'none', classificationConfidence: 0, model: 'fixture', errorCode: 'rate_limit' };
  if (view === 'noise') return { ...base, question: 'asdjkahsd', answer: 'No llegué a reconocer una consulta en ese mensaje.', previewAnswer: 'No llegué a reconocer una consulta en ese mensaje.', previewOutcome: 'clarify', previewSource: 'generated', previewGeneratedAt: now, outcome: 'clarify', reviewStatus: 'ignored', classificationMethod: 'unintelligible', classificationConfidence: .96, model: '', errorCode: null };
  if (view === 'tests') return { ...base, contactId: null, contactName: '', phone: '', question: '¿Hacen envíos?', answer: label.answer, previewAnswer: label.answer, previewOutcome: 'answered', previewSource: 'approved-label', previewGeneratedAt: now, outcome: 'answered', source: 'manual', reviewStatus: 'ignored', classificationMethod: 'semantic', classificationConfidence: .96, model: 'respuesta aprobada', errorCode: null };
  return { ...base, question: '¿Emiten factura A?', answer: '', previewAnswer: invoicePreview, previewOutcome: 'handoff', previewSource: 'generated', previewModel: 'fixture', previewGeneratedAt: now, outcome: 'disabled', aiEnabled: false, reviewStatus: 'pending', classificationMethod: 'semantic', classificationConfidence: .9, suggestedLabelId: null, suggestedLabelName: invoiceLabel.name, model: null, errorCode: null };
}

function json(res: http.ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

async function run() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(adminDir, 'index.html')));
    }
    if (url.pathname.startsWith('/assets/')) {
      const file = path.join(adminDir, url.pathname);
      if (fs.existsSync(file)) {
        res.writeHead(200, { 'Content-Type': path.extname(file) === '.css' ? 'text/css' : 'application/javascript' });
        return res.end(fs.readFileSync(file));
      }
    }
    if (url.pathname === '/sw.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(''); }
    if (url.pathname === '/api/auth/me') return json(res, { username: 'qa-admin' });
    if (url.pathname === '/api/conversations/stats') return json(res, { totalConversations: 0, unreadConversations: 0, unreadMessages: 0, totalMessages: 0, openTickets: 0 });
    if (url.pathname === '/api/conversations') return json(res, { items: [], nextCursor: null });
    if (url.pathname === '/api/stream') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': ready\n\n'); return; }
    if (url.pathname === '/api/ai' && req.method === 'GET') {
      const view = url.searchParams.get('view') ?? 'attention';
      const items = view === 'attention' && (markedNoise || resolved) ? [] : [item(view)];
      const query = (url.searchParams.get('q') ?? '').trim().toLocaleLowerCase();
      const labels = [label, invoiceLabel].filter(candidate => !query
        || candidate.name.toLocaleLowerCase().includes(query)
        || candidate.answer.toLocaleLowerCase().includes(query));
      return json(res, { settings: { enabled: false, updatedAt: now, updatedBy: 'qa' }, labels, rules: [], model: 'fixture',
        queries: { items, total: items.length, page: 1, limit: 50 }, totals: { attention: markedNoise || resolved ? 0 : 1, answered: 1, noise: markedNoise ? 2 : 1, errors: 1, tests: 1 } });
    }
    if (url.pathname === '/api/ai/test' && req.method === 'POST') return json(res, { answer: { text: label.answer, label: 'envios', sendMenuAfter: true, responseSource: 'approved-label' } });
    if (url.pathname.endsWith('/resolve') && req.method === 'PATCH') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        resolvedPayload = JSON.parse(body) as Record<string, unknown>;
        resolved = true;
        json(res, item('answered'));
      });
      return;
    }
    if (url.pathname.endsWith('/preview') && req.method === 'POST') return json(res, item('attention'));
    if (url.pathname.endsWith('/noise') && req.method === 'PATCH') { markedNoise = true; return json(res, item('noise')); }
    if (url.pathname.endsWith('/reopen') && req.method === 'PATCH') { markedNoise = false; return json(res, item('attention')); }
    return json(res, { error: 'Ruta fixture inexistente' }, 404);
  });
  server.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  const root = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  const browser = await chromium.launch({ headless: true });
  await fs.promises.mkdir('qa-artifacts', { recursive: true });
  try {
    for (const width of [1440, 390]) {
      markedNoise = false;
      resolved = false;
      resolvedPayload = null;
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(root);
      if (width <= 760) await page.getByRole('button', { name: 'Más secciones' }).click();
      await page.getByRole('button', { name: 'IA', exact: true }).click();
      await page.getByRole('heading', { name: 'Respuestas automáticas a clientes' }).waitFor();
      await page.getByText('La IA no envía mensajes a clientes.', { exact: false }).waitFor();
      await page.getByRole('button', { name: 'Activar respuestas de IA' }).waitFor();
      await page.getByRole('heading', { name: 'Preguntas de clientes' }).waitFor();
      const reviewCard = page.locator('.ai-query-item').filter({ hasText: '¿Emiten factura A?' });
      await reviewCard.waitFor();
      await reviewCard.getByText('María Gómez', { exact: true }).waitFor();
      await reviewCard.getByText('5493515550101', { exact: true }).waitFor();
      assert.equal(await reviewCard.locator(`time[datetime="${now}"]`).count(), 1, 'Cada consulta debe mostrar la hora del mensaje original.');
      assert.equal(await reviewCard.getByLabel('Etiqueta').inputValue(), invoiceLabel.id);
      assert.equal(await reviewCard.getByLabel('Respuesta').inputValue(), invoicePreview);
      assert.equal(await reviewCard.getByRole('option', { name: 'Crear una etiqueta nueva' }).count(), 0);
      assert.equal((await reviewCard.innerText()).includes('IA apagada'), false);
      assert.equal((await reviewCard.innerText()).includes('Qué pasó realmente'), false);
      assert.equal(await page.getByText('pregunta-no-entendible', { exact: false }).count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `Desborde horizontal en ${width}px`);
      await page.locator('.main-view').evaluate(element => { element.scrollTop = 0; });
      await page.screenshot({ path: `qa-artifacts/ai-admin-initial-${width}.png`, fullPage: true });
      await page.locator('.ai-query-item').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `qa-artifacts/ai-admin-review-${width}.png`, fullPage: true });
      const correctedAnswer = 'Respuesta corregida por el operador.';
      await reviewCard.getByLabel('Respuesta').fill(correctedAnswer);
      await reviewCard.getByLabel('Etiqueta').selectOption(label.id);
      assert.equal(await reviewCard.getByLabel('Respuesta').inputValue(), correctedAnswer,
        'Cambiar la etiqueta no debe pisar una respuesta que el operador ya editó.');
      await reviewCard.getByRole('button', { name: 'Guardar respuesta' }).click();
      await page.getByText('Respuesta aprobada. La pregunta quedó asociada a la etiqueta elegida.').waitFor();
      assert.deepEqual(resolvedPayload, { labelId: label.id, answer: correctedAnswer });
      await page.getByPlaceholder('Buscar pregunta o contacto').fill('factura');
      await page.getByRole('button', { name: 'Etiquetas', exact: true }).click();
      await page.getByRole('heading', { name: 'Etiquetas', exact: true }).waitFor();
      await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLInputElement>('.ai-label-card input.ai-label-input'))
        .some(input => input.value === 'envios'));
      assert.equal(await page.locator('.ai-label-card').count(), 2, 'Etiquetas no debe heredar el filtro oculto de Preguntas.');
      assert.equal(await page.getByText('Nueva · creada por IA', { exact: true }).count(), 1);
      assert.equal(await page.getByText('¿Emiten factura A?', { exact: true }).count(), 1);
      assert.equal(await page.getByRole('heading', { name: 'Preguntas de clientes' }).count(), 0);
      await page.screenshot({ path: `qa-artifacts/ai-admin-labels-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Preguntas y respuestas', exact: true }).click();
      await page.getByLabel('Pregunta de prueba').fill('¿Hacen envíos?');
      await page.getByRole('button', { name: 'Probar respuesta' }).click();
      await page.locator('.ai-test-result p').filter({ hasText: label.answer }).waitFor();
      await page.getByRole('button', { name: 'Respondidas', exact: false }).click();
      await page.getByRole('heading', { name: 'Respuestas a clientes' }).waitFor();
      const historicalAnswer = 'Los medios de pago deben confirmarse con el asesor.';
      await page.locator('.ai-readonly-answer p').filter({ hasText: historicalAnswer }).waitFor();
      resolved = false;
      await page.getByRole('button', { name: 'Por revisar', exact: false }).click();
      await page.getByRole('button', { name: 'Marcar como ruido' }).click();
      await page.getByText('No hay consultas esperando revisión.').waitFor();
      await page.screenshot({ path: `qa-artifacts/ai-admin-${width}.png`, fullPage: true });
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
    server.closeAllConnections();
  }
  console.log('AI admin browser tests: OK (desktop y móvil)');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
