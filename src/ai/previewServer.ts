import 'express-async-errors';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { answerQuestion, advisorUrl, facts, type Turn, type Answer } from './assistant';
import { catalogReady, readCatalog, saveCatalog, importExcel, importPdf, type Catalog } from './catalog';
import { createOpenRouterClient, type Complete } from './openRouter';
import { MAIN_MENU_OPTIONS, BUSINESS_ADDRESS, BUSINESS_SCHEDULE, FAQ_GENERAL, ORDER_INSTRUCTIONS, normalizeText } from '../botMenu';

type Session = { history: Turn[]; token: string; updated: number; paused: boolean; order: boolean };
export function createPreviewApp(complete: Complete) {
  const app = express();
  const sessions = new Map<string, Session>();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
  let busy = false;
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? '')) return res.sendStatus(403);
    if (req.headers.origin && ![`http://${req.headers.host}`].includes(req.headers.origin)) return res.sendStatus(403);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'");
    for (const [id, session] of sessions) if (Date.now() - session.updated > 60 * 60 * 1000) sessions.delete(id);
    let id = (req.headers.cookie ?? '').split(';').map(s => s.trim()).find(s => s.startsWith('ai_preview='))?.slice(11);
    if (!id || !sessions.has(id)) {
      if (sessions.size >= 100) return res.status(429).json({ error: 'Demasiadas sesiones de prueba.' });
      id = randomUUID(); sessions.set(id, { history: [], token: randomUUID(), updated: Date.now(), paused: false, order: false });
      res.cookie('ai_preview', id, { httpOnly: true, sameSite: 'strict', maxAge: 3600000 });
    }
    const session = sessions.get(id)!; session.updated = Date.now(); res.locals.session = session;
    if (req.method !== 'GET' && req.headers['x-preview-token'] !== session.token) return res.sendStatus(403);
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.get('/api/state', async (_req, res) => {
    res.json({ token: res.locals.session.token, catalog: await readCatalog(),
      model: process.env.OPENROUTER_MODEL ?? 'openai/gpt-oss-120b', configured: !!process.env.OPENROUTER_API_KEY,
      facts, menu: MAIN_MENU_OPTIONS, history: res.locals.session.history, paused: res.locals.session.paused });
  });
  app.post('/api/reset', (_req, res) => { Object.assign(res.locals.session, { history: [], paused: false, order: false }); res.json({ ok: true }); });
  app.post('/api/pause', (req, res) => { res.locals.session.paused = req.body.paused === true; res.json({ paused: res.locals.session.paused }); });
  app.post('/api/message', async (req, res) => {
    const { message } = z.object({ message: z.string().trim().min(1).max(2500) }).parse(req.body);
    if (busy) return res.status(429).json({ error: 'Hay otra consulta en curso. Esperá a que termine.' });
    const session: Session = res.locals.session;
    if (session.paused) return res.json({ text: '', outcome: 'paused', sources: [], products: [], tokens: 0, elapsedMs: 0, model: '' });
    busy = true;
    try {
      const selected = MAIN_MENU_OPTIONS.find(o => [o.number, normalizeText(o.label), ...o.keywords].includes(normalizeText(message)));
      let answer: Answer;
      const simple = (text: string): Answer => ({ text, outcome: 'answered', sources: ['Menú del bot · simulación local'], products: [], tokens: 0, elapsedMs: 0, model: '' });
      if (['menu', 'opciones', 'cancelar'].includes(normalizeText(message))) {
        session.order = false; answer = simple(MAIN_MENU_OPTIONS.map(o => `${o.number}. ${o.label}`).join('\n'));
      } else if (selected) {
        session.order = selected.id === 'hacer_pedido';
        const texts: Record<string, string> = { horarios: BUSINESS_SCHEDULE, direccion: BUSINESS_ADDRESS, preguntas_frecuentes: FAQ_GENERAL,
          hacer_pedido: ORDER_INSTRUCTIONS, asesor: `Podés contactar a nuestro asesor: ${advisorUrl()}` };
        answer = texts[selected.id] ? simple(texts[selected.id]) : await answerQuestion({ message: 'Pasame las listas de precios completas', history: session.history }, await readCatalog(), complete);
      } else if (session.order) {
        session.order = false;
        answer = simple(`Pedido de prueba recibido:\n${message}\n\nEn esta pantalla no se guarda ni se envía ningún pedido real.`);
      } else answer = await answerQuestion({ message, history: session.history }, await readCatalog(), complete);
      if (session.paused) return res.json({ text: '', outcome: 'paused', sources: [], products: [], tokens: 0, elapsedMs: 0, model: '' });
      session.history.push({ role: 'user', content: message }, { role: 'assistant', content: answer.text });
      session.history = session.history.slice(-12);
      res.json(answer);
    } finally { busy = false; }
  });
  app.post('/api/catalog/import', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Seleccioná un PDF o Excel.' });
    if (busy) return res.status(429).json({ error: 'Esperá a que termine la consulta en curso.' });
    busy = true;
    try {
      const name = path.basename(req.file.originalname).slice(0, 150);
      let draft: Catalog;
      if (/\.pdf$/i.test(name)) draft = await importPdf(req.file.buffer, name, complete);
      else if (/\.xlsx$/i.test(name)) draft = await importExcel(req.file.buffer, name);
      else throw new Error('Formato no compatible. Usá PDF o XLSX.');
      // Importing does not replace the active catalog. The browser holds the review draft.
      res.json(draft);
    } finally { busy = false; }
  });
  app.post('/api/catalog', async (req, res) => {
    if (busy) return res.status(429).json({ error: 'Esperá a que termine la consulta en curso.' });
    busy = true;
    try { res.json(await saveCatalog(req.body)); } finally { busy = false; }
  });
  app.use(express.static(path.resolve('public/ai-preview'), { index: 'index.html' }));
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const known = error instanceof z.ZodError ? 'Revisá los campos: falta un dato o tiene un formato incorrecto.'
      : error.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera el límite de 8 MB.'
      : typeof error.message === 'string' && !error.message.includes(process.cwd()) ? error.message.slice(0, 240) : 'No se pudo completar la operación.';
    res.status(400).json({ error: known });
  });
  return app;
}

export async function startPreview() {
  if (process.env.NODE_ENV === 'production') throw new Error('La prueba de IA no puede iniciarse en producción.');
  const current = await readCatalog();
  if (!current.products.length) {
    try { await saveCatalog(await importExcel(await fs.readFile('data/productos.xlsx'), 'productos.xlsx (archivo local histórico)')); }
    catch { /* A missing workbook leaves an explicit empty catalog. */ }
  }
  const complete = createOpenRouterClient({ key: process.env.OPENROUTER_API_KEY ?? '', model: process.env.OPENROUTER_MODEL ?? 'openai/gpt-oss-120b' });
  const port = Number(process.env.AI_PREVIEW_PORT ?? 4010);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Puerto de prueba inválido.');
  createPreviewApp(complete).listen(port, '127.0.0.1', () => console.log(`Prueba de AbastoBot: http://127.0.0.1:${port} · WhatsApp y base de producción desconectados.`));
}
