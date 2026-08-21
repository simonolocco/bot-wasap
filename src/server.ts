import 'dotenv/config';
import 'express-async-errors';
import crypto from 'node:crypto';
import path from 'node:path';
import express, { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { buildMediaPayload, getWhatsAppTransport, hasCloudCredentials, sendCloudMessage, sendCloudTextMessage, uploadCloudMedia } from './cloudClient';
import { pool, query } from './db/pool';
import { audit, claimOrderTicketFallback, claimOrderTicketFallbackById, closeSupportTicket, createContact, dashboard, deleteContact, deleteTemplate, exportContacts, getBotAnalytics, getConversation, getContactById, getMediaAssetById, getMediaAssetByMessageId, getMessageById, getTicketById, listAudit, listContacts, listConversations, listMessages, listOrders, listTemplates, listTickets, markConversationRead, markOutgoingFailed, markOutgoingSent, prepareManualMessage, prepareOutgoingMessage, previewCampaignSegment, recordMessageStatus, retryOutgoingMessage, saveTemplate, setBotPaused, storeIncomingEvent, updateContact, updateMediaAsset, updateOrder, type SupportTicket } from './db/repository';
import { orderWindowExpired, sendOrderTicketFallback } from './services/orderTicketFallback';
import { MENU_BUTTON_LABEL, MENU_HEADER_TEXT, MENU_PROMPT, buildMenuListSections, ticketClosureMessage } from './messageCatalog';
import { checkMediaStorage, ensureMediaCached, ensureMediaThumbnail, isSafeUpload, markMediaUploadFailed, storeMedia } from './services/mediaStorage';

declare global { namespace Express { interface Request { rawBody?: Buffer; } } }
declare module 'express-session' { interface SessionData { user?: string; } }

const PORT = Number(process.env.PORT ?? process.env.CLOUD_PORT ?? '4002');
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const APP_SECRET = process.env.META_APP_SECRET;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const SESSION_SECRET = process.env.SESSION_SECRET;
const production = process.env.NODE_ENV === 'production';
const allowUnsignedWebhooks = !production && process.env.ALLOW_UNSIGNED_WEBHOOKS === 'true';
if (production && (!VERIFY_TOKEN || !APP_SECRET || !ADMIN_USERNAME || !ADMIN_PASSWORD_HASH || !SESSION_SECRET || !process.env.DATABASE_URL)) throw new Error('Faltan variables obligatorias para producción. Revisá .env.example.');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
const streams = new Map<Response, string | null>();
void (async () => {
  const listener = await pool.connect();
  await listener.query('LISTEN abastobot_events');
  listener.on('notification', event => {
    let payload: { contactId?: string; table?: string; operation?: string } = {};
    try { payload = JSON.parse(event.payload ?? '{}'); } catch { return; }
    const eventName = payload.table === 'media_assets' ? 'media.ready' : payload.table === 'contacts' ? 'contact.updated' : payload.operation === 'INSERT' ? 'message.created' : 'message.status';
    for (const [stream, contactId] of streams) {
      if (contactId && payload.contactId && payload.contactId !== contactId) continue;
      try { stream.write(`event: ${eventName}\ndata: ${event.payload ?? '{}'}\n\n`); } catch { streams.delete(stream); }
    }
  });
})().catch(error => console.error('[realtime] No se pudo iniciar LISTEN/NOTIFY:', error));

function rawBody(req: Request, _res: Response, buffer: Buffer) { req.rawBody = Buffer.from(buffer); }
app.use('/webhook', express.json({ limit: '1mb', verify: rawBody }));
app.use(express.json({ limit: '1mb' }));
const PgStore = connectPgSimple(session);
app.use(session({ store: new PgStore({ pool, tableName: 'app_sessions', createTableIfMissing: false }), secret: SESSION_SECRET ?? 'development-only-change-me', resave: false, saveUninitialized: false, name: 'abasto_admin', cookie: { httpOnly: true, sameSite: 'lax', secure: production, maxAge: 1000 * 60 * 60 * 12 } }));

function verifyMetaSignature(req: Request) {
  if (!APP_SECRET) return allowUnsignedWebhooks;
  const received = req.header('x-hub-signature-256'); if (!received?.startsWith('sha256=') || !req.rawBody) return false;
  const expected = `sha256=${crypto.createHmac('sha256', APP_SECRET).update(req.rawBody).digest('hex')}`;
  return expected.length === received.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}
type ParsedIncoming = { providerMessageId: string; from: string; profileName?: string; text?: string; selectedOptionId?: string; buttonReplyId?: string; type: string; sourceTimestamp?: number; quotedProviderMessageId?: string; media?: { id?: string; mimeType?: string; filename?: string; caption?: string } };
function parseIncoming(message: any, profileName?: string): ParsedIncoming | null {
  if (!message?.id || !message?.from) return null;
  const providerMessageId = String(message.id).slice(0, 512);
  const from = String(message.from).replace(/\D/g, '');
  if (!providerMessageId || from.length < 6 || from.length > 20) return null;
  const incoming: ParsedIncoming = { providerMessageId, from, profileName: profileName?.slice(0, 200), type: String(message.type ?? 'unknown').slice(0, 40) };
  if (message.context?.id) incoming.quotedProviderMessageId = String(message.context.id).slice(0, 512);
  const timestamp = Number(message.timestamp);
  if (Number.isFinite(timestamp) && timestamp > 0) incoming.sourceTimestamp = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
  if (message.type === 'text') incoming.text = String(message.text?.body ?? '').slice(0, 4096);
  if (message.type === 'interactive') { if (message.interactive?.list_reply) { incoming.text = String(message.interactive.list_reply.title ?? ''); incoming.selectedOptionId = String(message.interactive.list_reply.id ?? ''); } if (message.interactive?.button_reply) { incoming.text = String(message.interactive.button_reply.title ?? ''); incoming.buttonReplyId = String(message.interactive.button_reply.id ?? ''); } }
  if (['image', 'document', 'audio', 'video'].includes(incoming.type)) { const media = message[incoming.type] ?? {}; incoming.text = String(media.caption ?? ''); incoming.media = { id: media.id ? String(media.id) : undefined, mimeType: media.mime_type ? String(media.mime_type) : undefined, filename: media.filename ? String(media.filename) : undefined, caption: media.caption ? String(media.caption) : undefined }; }
  return incoming;
}
app.get('/webhook', (req, res) => { if (!VERIFY_TOKEN) return res.status(500).send('META_VERIFY_TOKEN no configurado'); if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) return res.status(200).send(req.query['hub.challenge']); return res.sendStatus(403); });
app.post('/webhook', async (req, res) => {
  if (!verifyMetaSignature(req)) return res.sendStatus(401);
  if (req.body?.object !== 'whatsapp_business_account') return res.sendStatus(404);
  try {
    for (const entry of Array.isArray(req.body.entry) ? req.body.entry : []) for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value;
      const profileName = value?.contacts?.[0]?.profile?.name;
      for (const status of Array.isArray(value?.statuses) ? value.statuses : []) {
        const statusName = status?.status === 'accepted' ? 'sent' : status?.status;
        if (!status?.id || !['sent', 'delivered', 'read', 'failed'].includes(statusName)) continue;
        const errorText = status?.errors?.[0]?.title || status?.errors?.[0]?.message || status?.errors?.[0]?.code?.toString() || null;
        await recordMessageStatus(String(status.id), statusName, errorText, status);
      }
      for (const message of Array.isArray(value?.messages) ? value.messages : []) {
        const incoming = parseIncoming(message, profileName);
        if (!incoming) continue;
        await storeIncomingEvent({ providerMessageId: incoming.providerMessageId, phone: incoming.from, profileName: incoming.profileName, body: incoming.text || `[Mensaje ${incoming.type} recibido]`, messageType: incoming.type, sourceTimestamp: incoming.sourceTimestamp, quotedProviderMessageId: incoming.quotedProviderMessageId, media: incoming.media, payload: { incoming } });
      }
    }
    return res.sendStatus(200);
  } catch (error) {
    console.error('[webhook] No se pudo persistir el evento:', error);
    return res.sendStatus(503);
  }
});
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/readyz', async (_req, res) => { try { await query('SELECT 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); } });

const loginSchema = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200) });
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const loginAttemptCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, attempt] of loginAttempts) if (attempt.resetAt <= now) loginAttempts.delete(key);
}, 60_000);
loginAttemptCleanup.unref();
app.post('/api/auth/login', async (req, res) => {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (current && current.resetAt > now && current.count >= 5) {
    res.setHeader('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
    return res.status(429).json({ error: 'Demasiados intentos. Esperá 15 minutos.' });
  }
  const parsed = loginSchema.safeParse(req.body);
  const valid = parsed.success && ADMIN_USERNAME && ADMIN_PASSWORD_HASH && parsed.data.username === ADMIN_USERNAME && await bcrypt.compare(parsed.data.password, ADMIN_PASSWORD_HASH);
  if (!valid) {
    const next = current && current.resetAt > now ? { count: current.count + 1, resetAt: current.resetAt } : { count: 1, resetAt: now + 15 * 60_000 };
    loginAttempts.set(key, next);
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }
  loginAttempts.delete(key);
  return req.session.regenerate(error => {
    if (error) return res.status(500).json({ error: 'No se pudo crear la sesión.' });
    req.session.user = ADMIN_USERNAME;
    return res.json({ username: ADMIN_USERNAME });
  });
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.sendStatus(204)));
app.get('/api/auth/me', (req, res) => req.session.user ? res.json({ username: req.session.user }) : res.status(401).json({ error: 'Sesión requerida.' }));
function requireAdmin(req: Request, res: Response, next: NextFunction) { return req.session.user ? next() : res.status(401).json({ error: 'Sesión requerida.' }); }
function positive(value: unknown, fallback: number, maximum: number) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback; }
function page(value: unknown) { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0; }
function qs(value: unknown) { return typeof value === 'string' ? value.trim().slice(0, 160) : undefined; }
function csvCell(value: unknown) {
  const raw = value == null ? '' : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}


const closeReasons = ['order_completed', 'question_answered', 'customer_no_reply', 'operator_cancelled'] as const;
type ManualCloseReason = typeof closeReasons[number];

function closeReasonAllowed(ticketType: SupportTicket['ticketType'], reason: ManualCloseReason) {
  return ticketType === 'order'
    ? ['order_completed', 'customer_no_reply', 'operator_cancelled'].includes(reason)
    : ['question_answered', 'customer_no_reply', 'operator_cancelled'].includes(reason);
}

async function closeTicketWithNotice(ticket: any, reason: ManualCloseReason, actor: string) {
  if (!closeReasonAllowed(ticket.ticketType, reason)) throw new Error('El motivo no corresponde al tipo de ticket.');
  const body = ticketClosureMessage(ticket.ticketType, reason);
  const contact = await getContactById(ticket.contactId);
  if (!contact) throw new Error('Contacto inexistente.');
  const withinWindow = Boolean(contact.lastIncomingAt && new Date(contact.lastIncomingAt).getTime() > Date.now() - 24 * 60 * 60 * 1000);
  let noticeSent = false;
  if (body && withinWindow) {
    const stored = await prepareOutgoingMessage(contact.id, `ticket-close:${ticket.id}:${reason}`, body);
    if (stored.delivery_status !== 'sent') {
      try {
        const providerId = await sendCloudTextMessage(contact.phone, body);
        await markOutgoingSent(stored.id, providerId);
      } catch (error) {
        await markOutgoingFailed(stored.id, error);
        await audit(actor, 'support_ticket_close_notice_failed', contact.id, stored.id, { ticketId: ticket.id, reason });
        throw new Error('No se pudo enviar el mensaje final. El ticket sigue abierto y el bot continúa pausado.');
      }
    }
    noticeSent = true;
    await audit(actor, 'support_ticket_close_notice_sent', contact.id, stored.id, { ticketId: ticket.id, reason });
  } else if (body && !withinWindow) {
    await audit(actor, 'support_ticket_close_notice_skipped_window', contact.id, undefined, { ticketId: ticket.id, reason });
  }
  if (!withinWindow) {
    await audit(actor, 'support_ticket_close_menu_skipped_window', contact.id, undefined, { ticketId: ticket.id, reason });
    const closed = await closeSupportTicket(ticket.id, reason, actor);
    return { ticket: closed, contact: await getContactById(contact.id), noticeSent, menuSent: false, windowOpen: false, message: body };
  }
  const menuKey = `ticket-close:${ticket.id}:${reason}:menu`;
  const menu = await prepareOutgoingMessage(contact.id, menuKey, MENU_PROMPT, 'interactive');
  if (menu.delivery_status !== 'sent') {
    try {
      const providerId = await sendCloudMessage({
        messaging_product: 'whatsapp',
        to: contact.phone,
        type: 'interactive',
        interactive: {
          type: 'list',
          header: { type: 'text', text: MENU_HEADER_TEXT },
          body: { text: MENU_PROMPT },
          action: { button: MENU_BUTTON_LABEL, sections: buildMenuListSections() },
        },
      });
      await markOutgoingSent(menu.id, providerId);
      await audit(actor, 'support_ticket_close_menu_sent', contact.id, menu.id, { ticketId: ticket.id, reason });
    } catch (error) {
      await markOutgoingFailed(menu.id, error);
      await audit(actor, 'support_ticket_close_menu_failed', contact.id, menu.id, { ticketId: ticket.id, reason });
      throw new Error('No se pudo enviar el menú de reanudación. El ticket sigue abierto y el bot continúa pausado.');
    }
  }
  const closed = await closeSupportTicket(ticket.id, reason, actor);
  return { ticket: closed, contact: await getContactById(contact.id), noticeSent, menuSent: true, windowOpen: withinWindow, message: body };
}

app.use('/api', requireAdmin);
function openStream(req: Request, res: Response, contactId: string | null) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write('event: ready\ndata: {}\n\n');
  streams.set(res, contactId);
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); streams.delete(res); }
  }, 25_000);
  req.on('close', () => { clearInterval(heartbeat); streams.delete(res); });
}
app.get('/api/dashboard', async (_req, res) => res.json({ ...(await dashboard()), cloudReady: hasCloudCredentials(), transport: getWhatsAppTransport(), mediaStorage: await checkMediaStorage() }));
app.get('/api/analytics', async (req, res) => {
  const schema = z.object({
    period: z.enum(['7d', '30d', '90d', 'custom']).optional().default('30d'),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  }).superRefine((val, ctx) => {
    if (val.period === 'custom') {
      if (!val.from || !/^\d{4}-\d{2}-\d{2}/.test(val.from) || Number.isNaN(Date.parse(val.from))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'El parámetro "from" es obligatorio y debe ser una fecha válida (YYYY-MM-DD) para períodos personalizados.',
          path: ['from'],
        });
      }
      if (!val.to || !/^\d{4}-\d{2}-\d{2}/.test(val.to) || Number.isNaN(Date.parse(val.to))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'El parámetro "to" es obligatorio y debe ser una fecha válida (YYYY-MM-DD) para períodos personalizados.',
          path: ['to'],
        });
      }
      if (val.from && val.to && !Number.isNaN(Date.parse(val.from)) && !Number.isNaN(Date.parse(val.to))) {
        const fromDate = new Date(val.from);
        const toDate = new Date(val.to);
        if (fromDate > toDate) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'El rango de fechas personalizado es inválido. "Desde" debe ser anterior o igual a "Hasta".',
            path: ['from'],
          });
        }
      }
    }
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message || 'Parámetros de consulta de analíticas inválidos.';
    return res.status(400).json({ error: message, issues: parsed.error.issues });
  }
  const data = await getBotAnalytics(parsed.data);
  return res.json(data);
});
async function sendMediaFile(req: Request, res: Response, download: boolean) {
  const asset = await getMediaAssetByMessageId(req.params.id);
  if (!asset || asset.status !== 'ready') return res.status(404).json({ error: 'El archivo todavía no está disponible.' });
  try {
    const filePath = await ensureMediaCached(asset.storageKey);
    res.type(asset.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=300, must-revalidate');
    const safeInline = /^(image\/(jpeg|png|gif|webp|heic|heif)|audio\/(mpeg|ogg|wav|x-wav|mp4|aac)|application\/pdf)$/i.test(asset.mimeType);
    res.setHeader('Content-Disposition', `${download || !safeInline ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(asset.filename)}`);
    return res.sendFile(filePath);
  } catch { return res.status(404).json({ error: 'Archivo inexistente.' }); }
}
app.get('/api/messages/:id/media', (req, res) => sendMediaFile(req, res, false));
app.get('/api/messages/:id/media/download', (req, res) => sendMediaFile(req, res, true));
app.get('/api/messages/:id/media/thumbnail', async (req, res) => {
  const width = Number(req.query.w ?? 480);
  if (![240, 480, 960].includes(width)) return res.status(400).json({ error: 'Tamaño de miniatura inválido.' });
  const asset = await getMediaAssetByMessageId(req.params.id);
  if (!asset || asset.status !== 'ready' || !asset.mimeType.startsWith('image/')) return res.status(404).json({ error: 'La imagen todavía no está disponible.' });
  try {
    const filePath = await ensureMediaThumbnail(asset.storageKey, width as 240 | 480 | 960);
    res.type('image/webp');
    res.setHeader('Cache-Control', 'private, max-age=300, must-revalidate');
    res.setHeader('Content-Disposition', 'inline');
    return res.sendFile(filePath);
  } catch {
    return res.status(415).json({ error: 'No se pudo preparar la vista previa de esta imagen.' });
  }
});
app.post('/api/media', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Seleccioná un archivo.' });
  if (!isSafeUpload(req.file.buffer, req.file.mimetype)) return res.status(415).json({ error: 'El contenido no coincide con un formato de imagen, audio, PDF u Office permitido.' });
  let asset: Awaited<ReturnType<typeof storeMedia>> | null = null;
  try {
    asset = await storeMedia(req.file.buffer, req.file.mimetype, req.file.originalname);
    const mediaId = await uploadCloudMedia(req.file.buffer, req.file.mimetype, req.file.originalname);
    const updated = await updateMediaAsset(asset.id, { providerMediaId: mediaId, status: 'ready' });
    const mediaType = req.file.mimetype.startsWith('image/') ? 'image' : req.file.mimetype.startsWith('audio/') ? 'audio' : 'document';
    return res.json({ assetId: asset.id, mediaId, mimeType: req.file.mimetype, filename: req.file.originalname, size: req.file.size, mediaType, status: updated?.status ?? 'ready' });
  } catch (error) {
    if (asset) await markMediaUploadFailed(asset.id, error);
    return res.status(502).json({ error: error instanceof Error ? error.message : 'No se pudo cargar el archivo.' });
  }
});
app.post('/api/conversations/:id/messages', async (req, res) => {
  const schema = z.object({ body: z.string().max(4096).default(''), assetId: z.string().uuid().optional(), mediaId: z.string().max(200).optional(), mediaType: z.enum(['image', 'document', 'audio']).optional(), mediaMimeType: z.string().max(120).optional(), mediaFilename: z.string().max(255).optional(), mediaSize: z.number().int().nonnegative().max(25 * 1024 * 1024).optional(), caption: z.string().max(1024).optional(), quoteMessageId: z.string().uuid().nullable().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || (!parsed.data.body.trim() && !parsed.data.assetId && !parsed.data.mediaId)) return res.status(400).json({ error: 'Escribí un mensaje o adjuntá un archivo.' });
  const contact = await getContactById(req.params.id);
  if (!contact) return res.status(404).json({ error: 'Contacto inexistente.' });
  const withinWindow = Boolean(contact.lastIncomingAt && new Date(contact.lastIncomingAt).getTime() > Date.now() - 24 * 60 * 60 * 1000);
  if (!withinWindow) return res.status(409).json({ error: 'La ventana de atención está cerrada. Necesitás una plantilla aprobada para contactar a esta persona.' });
  const asset = parsed.data.assetId ? await getMediaAssetById(parsed.data.assetId) : null;
  if (parsed.data.assetId && (!asset || asset.status !== 'ready' || !asset.providerMediaId)) return res.status(409).json({ error: 'El archivo todavía no está listo para enviar.' });
  const mediaId = asset?.providerMediaId ?? parsed.data.mediaId;
  if (mediaId && !parsed.data.mediaType) return res.status(400).json({ error: 'Falta indicar el tipo de archivo.' });
  const quote = parsed.data.quoteMessageId ? await getMessageById(parsed.data.quoteMessageId) : null;
  if (parsed.data.quoteMessageId && (!quote || quote.contactId !== req.params.id)) return res.status(400).json({ error: 'El mensaje citado no pertenece a esta conversación.' });
  const messageType = parsed.data.mediaType ?? 'text';
  const typedBody = parsed.data.body.trim();
  const mediaCaption = mediaId && messageType !== 'audio' ? (parsed.data.caption?.trim() || typedBody || undefined) : undefined;
  if (mediaCaption && mediaCaption.length > 1024) return res.status(400).json({ error: 'El texto que acompaña al archivo no puede superar los 1024 caracteres.' });
  const body = typedBody || mediaCaption || `[${messageType}]`;
  const stored = await prepareManualMessage(req.params.id, `manual:${crypto.randomUUID()}`, body, messageType, mediaId ? { id: mediaId, assetId: asset?.id, mimeType: asset?.mimeType ?? parsed.data.mediaMimeType, filename: asset?.filename ?? parsed.data.mediaFilename, size: asset?.sizeBytes ?? parsed.data.mediaSize, caption: mediaCaption } : undefined, parsed.data.quoteMessageId);
  try {
    const providerId = mediaId
      ? await sendCloudMessage(buildMediaPayload(contact.phone, mediaId, parsed.data.mediaType!, mediaCaption, asset?.filename ?? parsed.data.mediaFilename, quote?.providerMessageId))
      : await sendCloudTextMessage(contact.phone, typedBody, quote?.providerMessageId);
    await markOutgoingSent(stored.id, providerId);
    await audit(req.session.user ?? 'admin', 'manual_message_sent', req.params.id, stored.id, { messageType, assetId: asset?.id ?? null, quoteMessageId: parsed.data.quoteMessageId ?? null });
    return res.status(201).json({ id: stored.id, deliveryStatus: 'sent' });
  } catch (error) {
    await markOutgoingFailed(stored.id, error);
    await audit(req.session.user ?? 'admin', 'manual_message_failed', req.params.id, stored.id, { messageType });
    return res.status(502).json({ error: error instanceof Error ? error.message : 'No se pudo enviar el mensaje.', messageId: stored.id });
  }
});
app.post('/api/messages/:id/retry', async (req, res) => {
  const message = await getMessageById(req.params.id);
  if (!message || message.direction !== 'outgoing' || message.deliveryStatus !== 'failed') return res.status(404).json({ error: 'Mensaje fallido inexistente.' });
  const asset = message.mediaAssetId ? await getMediaAssetById(message.mediaAssetId) : await getMediaAssetByMessageId(message.id);
  const mediaId = message.mediaId ?? asset?.providerMediaId;
  const reset = await retryOutgoingMessage(req.params.id);
  if (!reset) return res.status(409).json({ error: 'El mensaje ya no está disponible para reintento.' });
  try {
    const quote = message.quoteMessageId ? await getMessageById(message.quoteMessageId) : null;
    const providerId = mediaId
      ? await sendCloudMessage(buildMediaPayload(message.phone, mediaId, message.messageType as 'image' | 'document' | 'audio', message.mediaCaption ?? undefined, asset?.filename ?? message.mediaFilename ?? undefined, quote?.providerMessageId ?? message.quotedProviderMessageId))
      : await sendCloudTextMessage(message.phone, message.body, quote?.providerMessageId ?? message.quotedProviderMessageId);
    await markOutgoingSent(message.id, providerId);
    await audit(req.session.user ?? 'admin', 'manual_message_retried', message.contactId, message.id);
    return res.json({ id: message.id, deliveryStatus: 'sent' });
  } catch (error) {
    await markOutgoingFailed(message.id, error);
    return res.status(502).json({ error: error instanceof Error ? error.message : 'No se pudo reintentar el mensaje.', messageId: message.id });
  }
});
app.get('/api/conversations', async (req, res) => res.json(await listConversations({ q: qs(req.query.q), consent: qs(req.query.consent), pipeline: qs(req.query.pipeline), unread: req.query.unread === 'true', botPaused: req.query.botPaused === 'true' ? true : req.query.botPaused === 'false' ? false : undefined, followUp: req.query.followUp === 'overdue' || req.query.followUp === 'scheduled' ? req.query.followUp : undefined, ticket: req.query.ticket === 'open' ? 'open' : undefined, cursor: qs(req.query.cursor), limit: positive(req.query.limit, 30, 100) })));
app.get('/api/conversations/:id', async (req, res) => { const detail = await getConversation(req.params.id); return detail ? res.json(detail) : res.status(404).json({ error: 'Conversación inexistente.' }); });
app.get('/api/stream', (req, res) => openStream(req, res, null));
app.get('/api/conversations/:id/stream', (req, res) => openStream(req, res, req.params.id));
app.get('/api/conversations/:id/messages', async (req, res) => res.json(await listMessages(req.params.id, typeof req.query.before === 'string' ? req.query.before : undefined, positive(req.query.limit, 50, 100))));
app.patch('/api/conversations/:id', async (req, res) => updateConversation(req, res));
app.post('/api/conversations/:id/take', async (req, res) => { const contact = await setBotPaused(req.params.id, true, req.session.user ?? 'admin'); return contact ? res.json(contact) : res.status(404).json({ error: 'Contacto inexistente.' }); });
app.post('/api/conversations/:id/release', async (req, res) => { const detail = await getConversation(req.params.id); if (!detail) return res.status(404).json({ error: 'Contacto inexistente.' }); if (detail.openTicket) return res.status(409).json({ error: 'Esta conversación tiene un ticket abierto. Elegí un motivo explícito para cerrarlo desde el ticket.' }); const contact = await setBotPaused(req.params.id, false, req.session.user ?? 'admin'); return contact ? res.json(contact) : res.status(404).json({ error: 'Contacto inexistente.' }); });
app.post('/api/conversations/:id/order-fallback', async (req, res) => { const data = await claimOrderTicketFallback(req.params.id, false); if (!data) return res.status(404).json({ error: 'No hay un ticket de pedido abierto para esta conversación.' }); try { const result = await sendOrderTicketFallback(data, orderWindowExpired(data.contact.lastIncomingAt), req.session.user ?? 'admin'); return res.json({ ...data.contact, fallbackSent: result.sent, viaTemplate: result.viaTemplate }); } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : 'No se pudo enviar el link del pedido. El ticket sigue pausado.' }); } });
app.get('/api/tickets', async (req, res) => res.json(await listTickets({
  type: req.query.type === 'question' || req.query.type === 'order' ? req.query.type : undefined,
  status: req.query.status === 'open' || req.query.status === 'responded' || req.query.status === 'closed' ? req.query.status : undefined,
  closureReason: qs(req.query.closureReason), q: qs(req.query.q), page: page(req.query.page), limit: positive(req.query.limit, 30, 100),
})));
app.get('/api/tickets/:id', async (req, res) => { const ticket = await getTicketById(req.params.id); return ticket ? res.json(ticket) : res.status(404).json({ error: 'Ticket inexistente.' }); });
app.post('/api/tickets/:id/close', async (req, res) => {
  const parsed = z.object({ reason: z.enum(closeReasons) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Elegí un motivo de cierre válido.' });
  const ticket = await getTicketById(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket inexistente.' });
  try {
    const result = await closeTicketWithNotice(ticket, parsed.data.reason, req.session.user ?? 'admin');
    return res.json(result);
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : 'No se pudo cerrar el ticket.' });
  }
});
app.post('/api/tickets/:id/order-link', async (req, res) => {
  const ticket = await getTicketById(req.params.id);
  if (!ticket || ticket.ticketType !== 'order' || ticket.status !== 'open') return res.status(404).json({ error: 'No hay un ticket de pedido abierto.' });
  const data = await claimOrderTicketFallbackById(req.params.id);
  if (!data) return res.status(409).json({ error: 'El ticket está siendo procesado por otra acción. Intentá nuevamente.' });
  try {
    const result = await sendOrderTicketFallback(data, orderWindowExpired(data.contact.lastIncomingAt), req.session.user ?? 'admin');
    return res.json({ ...result, ticket: await getTicketById(req.params.id) });
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : 'No se pudo enviar el link del pedido. El ticket sigue pausado.' });
  }
});
app.post('/api/conversations/:id/read', async (req, res) => { const contact = await markConversationRead(req.params.id); if (contact) await audit(req.session.user ?? 'admin', 'conversation_read', req.params.id); return contact ? res.json(contact) : res.status(404).json({ error: 'Contacto inexistente.' }); });
app.post('/api/contacts', async (req, res) => {
  const parsed = z.object({ phone: z.string().min(6).max(30), name: z.string().trim().min(1).max(200) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Indicá un teléfono y un nombre válidos.' });
  const phone = parsed.data.phone.replace(/\D/g, '');
  if (phone.length < 6 || phone.length > 20) return res.status(400).json({ error: 'El teléfono debe tener entre 6 y 20 dígitos.' });
  const contact = await createContact(phone, parsed.data.name);
  if (!contact) return res.status(409).json({ error: 'No se pudo guardar el contacto.' });
  await audit(req.session.user ?? 'admin', 'contact_created', contact.id, undefined, { source: 'admin' });
  return res.status(201).json(contact);
});
app.get('/api/contacts/export', async (req, res) => {
  const rows = await exportContacts({ q: qs(req.query.q), consent: qs(req.query.consent) });
  const header = ['Nombre', 'Teléfono', 'Consentimiento', 'Etiquetas', 'Estado', 'Última actividad'];
  const body = rows.map(row => [row.name, row.phone, row.consentStatus, Array.isArray(row.labels) ? row.labels.join(', ') : '', row.pipelineStatus, row.lastMessageAt].map(csvCell).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="contactos.csv"');
  return res.send(`\uFEFF${[header.map(csvCell).join(','), ...body].join('\r\n')}\r\n`);
});
app.get('/api/contacts/:id', async (req, res) => { const contact = await getContactById(req.params.id); return contact ? res.json(contact) : res.status(404).json({ error: 'Contacto inexistente.' }); });
app.get('/api/contacts', async (req, res) => res.json(await listContacts({ q: qs(req.query.q), consent: qs(req.query.consent), page: page(req.query.page), limit: positive(req.query.limit, 50, 100) })));
app.delete('/api/contacts/:id', async (req, res) => {
  const parsedId = z.string().uuid().safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ error: 'Identificador de contacto inválido.' });
  const contact = await deleteContact(parsedId.data, req.session.user ?? 'admin');
  return contact ? res.json({ ok: true, contact }) : res.status(404).json({ error: 'Contacto inexistente.' });
});
app.patch('/api/contacts/:id', async (req, res) => updateConversation(req, res));
app.get('/api/orders', async (req, res) => res.json(await listOrders(page(req.query.page), positive(req.query.limit, 50, 100), { status: qs(req.query.status), contactId: qs(req.query.contactId), from: qs(req.query.from), to: qs(req.query.to) })));
app.patch('/api/orders/:id', async (req, res) => { const parsed = z.object({ status: z.enum(['pending_customer','submitted','canceled','accepted']) }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Estado de pedido inválido.' }); const order = await updateOrder(Number(req.params.id), parsed.data.status, req.session.user ?? 'admin'); return order ? res.json(order) : res.status(404).json({ error: 'Pedido inexistente.' }); });
app.get('/api/audit', async (req, res) => res.json({ items: await listAudit(qs(req.query.contactId), positive(req.query.limit, 100, 200)) }));

async function updateConversation(req: Request, res: Response) {
  const schema = z.object({ name: z.string().max(200).optional(), publicName: z.string().max(200).optional(), notes: z.string().max(4000).optional(), consentStatus: z.enum(['unknown','opted_in','opted_out']).optional(), consentSource: z.string().max(500).optional(), labels: z.array(z.string().max(40)).max(30).optional(), pipelineStatus: z.enum(['new','in_attention','follow_up','order_received','won','lost']).optional(), assignedTo: z.string().max(100).nullable().optional(), followUpAt: z.string().datetime().nullable().optional() });
  const parsed = schema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Datos de contacto inválidos.' }); if (parsed.data.consentStatus === 'opted_in' && !parsed.data.consentSource?.trim()) return res.status(400).json({ error: 'Indicá el origen del consentimiento.' });
  const contact = await updateContact(req.params.id, parsed.data, req.session.user); return contact ? res.json(contact) : res.status(404).json({ error: 'Contacto inexistente.' });
}
app.get('/api/templates', async (_req, res) => res.json({ items: await listTemplates() }));
app.post('/api/templates', async (req, res) => { const schema = z.object({ id: z.string().uuid().optional(), metaName: z.string().regex(/^[a-z0-9_]{3,128}$/), language: z.string().min(2).max(20), category: z.enum(['MARKETING','UTILITY']), body: z.string().min(1).max(5000), variables: z.array(z.string().max(50)).max(20), status: z.enum(['draft','pending','approved','paused','rejected']) }); const parsed = schema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Plantilla inválida.' }); try { const template = await saveTemplate(parsed.data); return template ? res.json(template) : res.status(404).json({ error: 'Plantilla inexistente.' }); } catch { return res.status(409).json({ error: 'Ya existe una plantilla con ese nombre.' }); } });
app.delete('/api/templates/:id', async (req, res) => (await deleteTemplate(req.params.id)) ? res.sendStatus(204) : res.status(404).json({ error: 'Plantilla inexistente.' }));
app.post('/api/campaigns/preview', async (req, res) => { const schema = z.object({ consentStatus: z.enum(['unknown','opted_in','opted_out']).optional(), activeSince: z.string().datetime().optional() }); const parsed = schema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Segmento inválido.' }); return res.json(await previewCampaignSegment(parsed.data)); });
app.post('/api/campaigns/start', (_req, res) => res.status(409).json({ error: 'Los envíos de campañas están deshabilitados en esta etapa.' }));
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server] Error no controlado en una solicitud:', error instanceof Error ? error.message : String(error));
  if (res.headersSent) return;
  res.status(500).json({ error: 'Error interno. El equipo técnico fue notificado.' });
});
app.use(express.static(path.join(process.cwd(), 'public'), { index: false }));
app.use(express.static(path.join(process.cwd(), 'public', 'admin'), { index: 'index.html' }));
app.listen(PORT, () => console.log(`[server] Escuchando en puerto ${PORT}`));
