import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import pino from 'pino';
import { EventEmitter } from 'events';

import qrcodeTerminal from 'qrcode-terminal';

import { config } from './config.js';
import { getNormalizedMediaMessage, getMediaFileName, saveMedia } from './utils.js';
import { processImageForReceipt } from './services/ocr/ocrService.js';
import { saveReceipt } from './services/database/dbService.js';
import { compressMediaImage } from './services/media/mediaCompressor.js';
import { createReceiptFromOcr } from './services/receipts/receiptProcessingService.js';
import {
    getMercadoFrescosBranchForSender,
    MERCADO_FRESCOS_BRANCHES
} from './services/receipts/recipientService.js';
import mime from 'mime-types';

import { useSupabaseAuthState } from './services/database/supabaseService.js';

class BotManager extends EventEmitter {
    constructor() {
        super();
        this.sock = null;
        this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'qr' | 'open'
        this.qrCodeUrl = null;
        this.groupMap = new Map();
        this.targetGroupInfo = { jid: config.targetGroupJid, subject: config.targetGroupSubject };
        this._reconnectAttempt = 0; // For exponential backoff
        this._isInitializing = false; // Guard against concurrent init() calls
        this._intentionalLogout = false; // Set to true during logout() to suppress auto-retry
        this._recentHistoryMessages = []; // Stores last history-sync messages for manual re-processing
        this.lidToPnMap = new Map(); // Cache to map unresolved WhatsApp LIDs to legacy phone number JIDs
        this._processingMessageIds = new Set();
        this._processedMessageIds = new Set();
        this._messageQueue = Promise.resolve();
    }

    async init() {
        if (this._isInitializing) {
            console.log('[BotManager] init() already in progress, skipping duplicate call.');
            return;
        }
        this._isInitializing = true;

        if (!fs.existsSync(config.mediaDir)) {
            fs.mkdirSync(config.mediaDir, { recursive: true });
        }

        this.status = 'connecting';
        this.emitStatusUpdate();

        try {
            let authState = null;
            if (process.env.USE_SUPABASE === 'true') {
                try {
                    console.log('📦 [BotManager] Connecting to Supabase Cloud Auth State...');
                    authState = await useSupabaseAuthState();
                    console.log('✅ [BotManager] Loaded Supabase Auth State successfully.');
                } catch (spErr) {
                    console.error('⚠️ [BotManager] Could not initialize Supabase auth state:', spErr.message);
                }
            }

            if (!authState) {
                if (!fs.existsSync(config.authDir)) {
                    fs.mkdirSync(config.authDir, { recursive: true });
                }
                authState = await useMultiFileAuthState(config.authDir);
            }

            const { state, saveCreds } = authState;

            // If this is a fresh session (not yet registered/linked to phone),
            // persist the generated keys BEFORE connecting so every retry uses
            // the SAME static keys instead of generating new ones each time.
            // Sending different keys each attempt is what triggers WhatsApp's ban.
            if (!state.creds.registered) {
                console.log('[BotManager] Fresh session detected — persisting initial keys before connecting...');
                await saveCreds().catch(() => {});
            }

            const logger = pino({ level: config.logLevel || 'warn' });
            const makeWASocketFn = makeWASocket.default || makeWASocket;

            console.log('🌐 [BotManager] Fetching latest WhatsApp Web version...');
            const { version, isLatest } = await fetchLatestBaileysVersion().catch(() => ({
                version: [2, 3000, 1015190524],
                isLatest: false
            }));
            console.log(`🌐 [BotManager] Using WhatsApp Web version: v${version.join('.')} (isLatest: ${isLatest})`);

            console.log('🔄 [BotManager] Initializing WhatsApp Socket connection...');
            this.sock = makeWASocketFn({
                version,
                auth: state,
                printQRInTerminal: false,
                logger,
                browser: ['Chrome (Linux)', 'Chrome', '126.0.0.0'],
                syncFullHistory: false,
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 90000,
            });

            this.sock.ev.on('creds.update', saveCreds);

            this.sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    this.status = 'qr';
                    console.log('\n┌────────────────────────────────────────────────────────┐');
                    console.log('│             ACTION REQUIRED: SCAN WHATSAPP QR          │');
                    console.log('└────────────────────────────────────────────────────────┘');
                    try {
                        qrcodeTerminal.generate(qr, { small: true });
                    } catch (e) {}
                    try {
                        this.qrCodeUrl = await QRCode.toDataURL(qr);
                        console.log('[BotManager] Generated new QR Data URL for Web UI.');
                    } catch (qrErr) {
                        console.error('[BotManager] QR Data URL generation error:', qrErr);
                    }
                    this.emitStatusUpdate();
                }

                if (connection === 'connecting') {
                    this.status = 'connecting';
                    console.log('🟡 [BotManager] Connecting to WhatsApp Web...');
                    this.emitStatusUpdate();
                } else if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const isLoggedOut = statusCode === DisconnectReason.loggedOut;

                    this.status = 'disconnected';
                    this.qrCodeUrl = null;
                    this._isInitializing = false; // Allow re-init after close
                    console.log(`[BotManager] Connection closed. StatusCode: ${statusCode}. LoggedOut: ${isLoggedOut}`);
                    this.emitStatusUpdate();

                    // If logout() already scheduled a reconnect, don't start a competing retry loop
                    if (this._intentionalLogout) {
                        console.log('[BotManager] Close event ignored — intentional logout already handled.');
                        return;
                    }

                    if (isLoggedOut) {
                        this.logoutRetryCount = (this.logoutRetryCount || 0) + 1;
                        if (this.logoutRetryCount >= 3) {
                            console.log('⚠️ [BotManager] Confirmed session logout after 3 retries. Resetting auth state for new QR...');
                            this.logoutRetryCount = 0;
                            try {
                                if (authState && authState.clearAuth) {
                                    await authState.clearAuth();
                                }
                                if (fs.existsSync(config.authDir)) {
                                    fs.rmSync(config.authDir, { recursive: true, force: true });
                                }
                            } catch (rmErr) {
                                console.error('[BotManager] Error resetting auth state:', rmErr);
                            }
                            setTimeout(() => this.init(), 1000);
                        } else {
                            console.log(`⚠️ [BotManager] Transient auth disconnect (statusCode: ${statusCode}). Reconnecting with existing session (attempt ${this.logoutRetryCount}/3)...`);
                            setTimeout(() => this.init(), 3000);
                        }
                    } else {
                        // Exponential backoff: 5s, 10s, 20s, 40s, 80s, max 5min
                        this._reconnectAttempt = (this._reconnectAttempt || 0) + 1;
                        const delay = Math.min(5000 * Math.pow(2, this._reconnectAttempt - 1), 5 * 60 * 1000);
                        console.log(`⏳ [BotManager] Reconnecting in ${Math.round(delay/1000)}s (attempt ${this._reconnectAttempt})...`);
                        setTimeout(() => this.init(), delay);
                    }
                } else if (connection === 'open') {
                    this.logoutRetryCount = 0;
                    this._reconnectAttempt = 0; // Reset backoff on success
                    this._isInitializing = false; // Successfully connected
                    this.status = 'open';
                    this.qrCodeUrl = null;
                    console.log('\n========================================================');
                    console.log('🟢 [BotManager] Connected to WhatsApp Web Gateway!');
                    console.log('========================================================\n');

                    try {
                        const groups = await this.sock.groupFetchAllParticipating();
                        this.groupMap.clear();
                        console.log(`[BotManager] Enrolled in ${Object.keys(groups).length} groups:`);
                        for (const [jid, metadata] of Object.entries(groups)) {
                            this.groupMap.set(jid, metadata.subject);
                            console.log(` 📌 Grupo: "${metadata.subject}" -> JID: ${jid}`);
                        }
                    } catch (gErr) {
                        console.error('[BotManager] Group fetch error:', gErr.message);
                    }

                    this.emitStatusUpdate();
                }
            });

            this.sock.ev.on('contacts.upsert', (contacts) => {
                for (const contact of contacts) {
                    if (contact.id && contact.id.endsWith('@lid') && contact.phoneNumber) {
                        const phoneJid = `${contact.phoneNumber}@s.whatsapp.net`;
                        this.lidToPnMap.set(contact.id, phoneJid);
                        console.log(`📎 [LID Cache Upsert] Cache mapping: ${contact.id} → ${phoneJid}`);
                    }
                    if (contact.id && contact.lid) {
                        this.lidToPnMap.set(contact.lid, contact.id);
                        console.log(`📎 [LID Cache Upsert] Cache mapping: ${contact.lid} → ${contact.id}`);
                    }
                }
            });

            this.sock.ev.on('contacts.update', (updates) => {
                for (const update of updates) {
                    if (update.id && update.id.endsWith('@lid') && update.phoneNumber) {
                        const phoneJid = `${update.phoneNumber}@s.whatsapp.net`;
                        this.lidToPnMap.set(update.id, phoneJid);
                        console.log(`📎 [LID Cache Update] Cache mapping: ${update.id} → ${phoneJid}`);
                    }
                    if (update.id && update.lid) {
                        this.lidToPnMap.set(update.lid, update.id);
                        console.log(`📎 [LID Cache Update] Cache mapping: ${update.lid} → ${update.id}`);
                    }
                }
            });

            this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
                // 'notify' = messages from others; 'append' = own messages sent from phone
                if (type !== 'notify' && type !== 'append') return;
                for (const msg of messages) {
                    this._enqueueIncomingMessage(msg);
                }
            });

            // Handle WhatsApp history sync: process every media message received
            // from the target groups. The previous implementation kept only the
            // last five messages, which silently skipped older comprobantes when
            // the session had been offline.
            this.sock.ev.on('messaging-history.set', async ({ messages, isLatest }) => {
                if (!messages || messages.length === 0) return;

                // Filter only target-group messages with media
                const groupMsgs = messages.filter(m =>
                    m.message &&
                    m.key?.remoteJid?.endsWith('@g.us') &&
                    this._isTargetGroup(m.key.remoteJid)
                );

                if (groupMsgs.length === 0) return;

                // Keep the most recent ones sorted by timestamp
                const sorted = groupMsgs
                    .sort((a, b) => Number(a.messageTimestamp || 0) - Number(b.messageTimestamp || 0));

                console.log(`📜 [History Sync] Processing ${sorted.length} media messages from target group...`);
                for (const msg of sorted) {
                    await this._enqueueIncomingMessage(msg);
                }
            });

        } catch (err) {
            console.error('[BotManager Initialization Error]', err);
            this.status = 'disconnected';
            this._isInitializing = false;
            this.emitStatusUpdate();
        }
    }

    _enqueueIncomingMessage(msg) {
        this._messageQueue = this._messageQueue.then(async () => {
            // A temporary WhatsApp/network failure should not lose the message.
            // Retry a few times while keeping the message ID deduplication guard.
            for (let attempt = 1; attempt <= 3; attempt++) {
                const processed = await this.handleIncomingMessage(msg);
                if (processed !== false || attempt === 3) return processed;
                const delay = attempt * 2000;
                console.warn(`[BotManager] Retrying message processing in ${delay}ms (attempt ${attempt + 1}/3)...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }).catch(err => {
            console.error('[BotManager Message Error]', err);
        });
        return this._messageQueue;
    }

    async handleIncomingMessage(msg) {
        if (!msg.message || !msg.key) return;

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid || !remoteJid.endsWith('@g.us')) return;

        if (!this.groupMap.has(remoteJid)) {
            try {
                const metadata = await this.sock.groupMetadata(remoteJid);
                if (metadata && metadata.subject) {
                    this.groupMap.set(remoteJid, metadata.subject);
                }
            } catch (e) {}
        }

        const groupSubject = this.groupMap.get(remoteJid) || '';

        // Check if group matches configuration filter (Local 1 or Local 2)
        if (!this._isTargetGroup(remoteJid)) {
            return;
        }

        const normalizedMedia = getNormalizedMediaMessage(msg);
        if (!normalizedMedia) return;

        const { type: mediaType, content, virtualMsg } = normalizedMedia;

        // Process images or documents (PDFs)
        if (mediaType !== 'imageMessage' && mediaType !== 'documentMessage') return;

        // Resolve sender JID: for own messages (fromMe), use the bot's own user ID
        let rawSenderJid;
        if (msg.key.fromMe) {
            rawSenderJid = this.sock?.user?.id || remoteJid;
        } else {
            rawSenderJid = msg.key.participant || remoteJid;
        }

        // Modern WhatsApp uses LID format (@lid) instead of phone numbers for some users.
        // Try to resolve the LID to the real phone number JID.
        if (rawSenderJid.endsWith('@lid')) {
            try {
                // Try message alternate properties first (fastest and built into Baileys payload)
                const altPn = msg.key.participantAlt || msg.participantPn || msg.senderPn || msg.key.participantPn;
                if (altPn && !altPn.endsWith('@lid')) {
                    console.log(`🔍 [LID Resolved via Message Alt Field] ${rawSenderJid} → ${altPn}`);
                    rawSenderJid = altPn;
                }

                // Try our in-memory contacts LID mapping cache
                if (rawSenderJid.endsWith('@lid') && this.lidToPnMap.has(rawSenderJid)) {
                    const cachedPn = this.lidToPnMap.get(rawSenderJid);
                    console.log(`🔍 [LID Resolved via Cache] ${rawSenderJid} → ${cachedPn}`);
                    rawSenderJid = cachedPn;
                }

                // Try signalRepository mapping
                if (rawSenderJid.endsWith('@lid') && this.sock?.signalRepository?.lidMapping) {
                    const pn = await this.sock.signalRepository.lidMapping.getPNForLID(rawSenderJid);
                    if (pn) {
                        console.log(`🔍 [LID Mapping Resolved] ${rawSenderJid} → ${pn}`);
                        this.lidToPnMap.set(rawSenderJid, pn); // Save under the original LID
                        rawSenderJid = pn;
                    }
                }
                
                // If it's still a LID, fall back to group metadata JID or PN matching
                if (rawSenderJid.endsWith('@lid')) {
                    const metadata = await this.sock.groupMetadata(remoteJid);
                    const match = (metadata?.participants || []).find(p =>
                        p.lid === rawSenderJid || p.id === rawSenderJid
                    );
                    if (match) {
                        const resolvedId = (match.pn && !match.pn.endsWith('@lid')) ? match.pn : match.id;
                        if (resolvedId && !resolvedId.endsWith('@lid')) {
                            console.log(`🔍 [LID Resolved via Group Metadata] ${rawSenderJid} → ${resolvedId}`);
                            this.lidToPnMap.set(rawSenderJid, resolvedId); // Save under the original LID
                            rawSenderJid = resolvedId;
                        } else {
                            console.log(`⚠️ [LID] No se pudo resolver LID ${rawSenderJid} en metadatos del grupo (PN no presente).`);
                        }
                    }
                }
            } catch (e) {
                console.warn(`⚠️ [LID] Error resolviendo LID ${rawSenderJid}:`, e.message);
            }
        }

        const cleanSenderJid = rawSenderJid.split('@')[0].split(':')[0];
        const senderDigits = cleanSenderJid.replace(/\D/g, '');

        // Name map for known senders
        const SENDER_NAME_MAP = {
            '3517565641': 'Distribuidora Abasto del Campo',
            '3517565644': 'Pablo',
            '3517565643': 'Franco Barberis',
            '3515597478': 'Ventas Abasto del Campo',
            '3515597470': 'Ventas Abasto del Campo',
            '162835246137376': 'Ventas Abasto del Campo',
            '3516161274': 'Mercado de Frescos - Merlo',
            '3516161285': 'Mercado de Frescos - Villa Dolores',
            '3512327471': 'Mercado de Frescos - Mina Clavero'
        };

        // Sender filter: ALLOWED_NUMBERS controls who is accepted from the group.
        // Set ALLOWED_NUMBERS=* (or leave empty) to accept ALL participants from the target group.
        // Individual number filtering is now secondary - the main filter is the recipient alias (RECIPIENT_ALIAS env var).
        if (!msg.key.fromMe) {
            const allowedRaw = (process.env.ALLOWED_NUMBERS || '').trim();
            const allowAll = !allowedRaw || allowedRaw === '*';
            const isLid = rawSenderJid.endsWith('@lid'); // still unresolved LID
            const isInternalId = senderDigits.length > 15; // internal WA ID, not a phone number
            if (!allowAll && !isLid && !isInternalId) {
                const allowedList = allowedRaw.split(',').map(s => s.trim()).filter(Boolean);
                const isAllowed = allowedList.some(num => num && senderDigits.endsWith(num));
                if (!isAllowed) {
                    console.log(`⛔ [Sender Filter] Ignorando remitente no habilitado: ${cleanSenderJid} (no está en ALLOWED_NUMBERS)`);
                    return;
                }
            }
            if (isInternalId) {
                console.log(`🔍 [Internal ID] Sender ${cleanSenderJid} es un ID interno de WA, se permite por estar en el grupo objetivo.`);
            }
        }

        const messageIdentity = `${remoteJid}:${msg.key.id || ''}`;
        if (!msg.key.id || this._processingMessageIds.has(messageIdentity) || this._processedMessageIds.has(messageIdentity)) {
            return;
        }
        this._processingMessageIds.add(messageIdentity);
        let processedSuccessfully = false;

        // Resolve display name
        const matchedNum = Object.keys(SENDER_NAME_MAP).find(num => senderDigits.endsWith(num));
        const senderName = (msg.key.fromMe ? '👤 (Yo - Simon)' : null)
            || SENDER_NAME_MAP[matchedNum]
            || msg.pushName
            || cleanSenderJid;

        // Determine the regular Abasto local and, independently, the
        // physical Mercado de Frescos branch. The latter is only applied if
        // OCR confirms the Mercado de Frescos recipient alias; this keeps an
        // Abasto receipt accidentally sent to the Frescos group in Abasto.
        const isMercadoFrescosGroup = this._isMercadoFrescosGroup(remoteJid);
        const isRepartosGroup = this._isLocal2Group(remoteJid);
        const senderLocal = isRepartosGroup ? 'local2' : 'local1';
        const mercadoFrescosBranch = isMercadoFrescosGroup
            ? getMercadoFrescosBranchForSender(senderDigits)?.id || null
            : isRepartosGroup
            ? MERCADO_FRESCOS_BRANCHES.find(branch => branch.label === 'Repartos')?.id || null
            : null;

        if (isMercadoFrescosGroup && !mercadoFrescosBranch) {
            console.warn(`[Mercado Frescos] Remitente no asociado a un local: ${cleanSenderJid}`);
        }

        console.log(`📨 [Mensaje] Remitente: ${senderName} (${cleanSenderJid})${msg.key.fromMe ? ' [PROPIO]' : ''}`);

        const fileName = getMediaFileName(
            content,
            mediaType,
            rawSenderJid,
            msg.key.id,
            msg.messageTimestamp
        );
        const destPath = path.join(config.mediaDir, fileName);

        console.log(`\n📥 [Auto-Processing Media] File: ${fileName} from ${senderName}`);

        const msgTime = msg.messageTimestamp
            ? (typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : (msg.messageTimestamp.low || msg.messageTimestamp)) * 1000
            : Date.now();
        const tempReceipt = {
            id: `rec_${Date.now()}_${msg.key.id.substring(0, 5)}`,
            filename: fileName,
            filePath: destPath,
            thumbnailBase64: '',
            sender: senderName,
            local: senderLocal,
            status: 'processing',
            createdAt: new Date(msgTime).toISOString()
        };
        this.emit('receipt_processing', tempReceipt);

        try {
            const buffer = await downloadMediaMessage(
                virtualMsg,
                'buffer',
                {},
                {
                    logger: pino({ level: 'silent' }),
                    reuploadRequest: this.sock.updateMediaMessage
                }
            );

            let mimeType = mime.lookup(fileName) || (mediaType === 'imageMessage' ? 'image/jpeg' : 'application/pdf');
            const { compressedBuffer, base64DataUrl } = await compressMediaImage(buffer, mimeType);
            tempReceipt.thumbnailBase64 = base64DataUrl;

            await saveMedia(compressedBuffer, destPath);
            console.log(`✅ Compressed file saved to ${destPath}. Launching AI Vision extraction...`);

            // Execute Vision OCR
            const ocrResult = await processImageForReceipt(destPath);

            // --- Recipient account filter ---
            // Abasto and Mercado de Frescos are stored in separate account
            // sections. Unknown destinations remain visible as filtered, as
            // before, instead of silently disappearing.
            const processedReceipt = createReceiptFromOcr(tempReceipt, ocrResult, {
                fallbackLocal: senderLocal,
                mercadoFrescosLocal: mercadoFrescosBranch,
                filterUnknownRecipient: true,
                persistRecipient: true
            });
            const filterReason = processedReceipt.filterReason;
            if (processedReceipt.filtered) {
                console.log(`⛔ [Destinatario Filter] ${filterReason}`);
                const filteredReceipt = await saveReceipt(processedReceipt.receipt);
                this.emit('receipt_processed', filteredReceipt);
                processedSuccessfully = !filteredReceipt?.__storageFallback;
                return processedSuccessfully;
            } else if (!ocrResult.destinatario) {
                console.log(`⚠️ [Destinatario Filter] Destinatario no detectado por IA — se guarda en la sección principal (no se pudo verificar la cuenta).`);
            }

            const savedReceipt = await saveReceipt(processedReceipt.receipt);

            if (savedReceipt && savedReceipt.id !== tempReceipt.id) {
                this.emit('receipt_discarded', { id: tempReceipt.id });
            }
            console.log(`✨ [AI Extraction Complete] Fecha: ${savedReceipt.fecha} | Monto: $${savedReceipt.monto}`);
            this.emit('receipt_processed', savedReceipt);
            processedSuccessfully = !savedReceipt?.__storageFallback;

        } catch (err) {
            console.error(`❌ Error downloading/processing media: ${err.message}`);

            // Keep a visible error record instead of leaving only an orphaned
            // file or a temporary "processing" row in the UI. The queue will
            // retry this message, but the failure is never silent.
            try {
                const failedReceipt = await saveReceipt({
                    ...tempReceipt,
                    status: 'error',
                    monto: 0,
                    fecha: null,
                    hora: null,
                    rawText: `Error de procesamiento: ${err.message}`,
                    notas: `Error de procesamiento: ${err.message}`
                });
                this.emit('receipt_processed', failedReceipt);
            } catch (saveErr) {
                console.error(`❌ No se pudo persistir el error del comprobante: ${saveErr.message}`);
            }
        } finally {
            this._processingMessageIds.delete(messageIdentity);
            if (processedSuccessfully) {
                this._processedMessageIds.add(messageIdentity);
                if (this._processedMessageIds.size > 1000) {
                    this._processedMessageIds.delete(this._processedMessageIds.values().next().value);
                }
            }
        }

        return processedSuccessfully;
    }

    emitStatusUpdate() {
        this.emit('status_update', {
            status: this.status,
            qrCodeUrl: this.qrCodeUrl,
            targetGroup: this.targetGroupInfo,
            enrolledGroupsCount: this.groupMap.size
        });
    }

    getStatus() {
        return {
            status: this.status,
            qrCodeUrl: this.qrCodeUrl,
            targetGroup: this.targetGroupInfo,
            groups: Array.from(this.groupMap.entries()).map(([jid, subject]) => ({ jid, subject }))
        };
    }

    async logout() {
        console.log('[BotManager] Logging out of WhatsApp Web and resetting auth session...');
        // Mark as intentional so the connection.update 'close' handler doesn't start a competing retry
        this._intentionalLogout = true;
        this.logoutRetryCount = 0;
        try {
            if (this.sock) {
                await this.sock.logout().catch(() => {});
                try { this.sock.end(undefined); } catch (e) {}
                this.sock = null;
            }
        } catch (e) {}

        this.status = 'disconnected';
        this.qrCodeUrl = null;
        this._isInitializing = false;

        try {
            if (fs.existsSync(config.authDir)) {
                fs.rmSync(config.authDir, { recursive: true, force: true });
            }
        } catch (rmErr) {
            console.error('[BotManager] Error deleting auth_info:', rmErr);
        }

        this.emitStatusUpdate();
        if (process.env.USE_SUPABASE === 'true') {
            try {
                const { useSupabaseAuthState: sb } = await import('./services/database/supabaseService.js');
                const tempAuth = await sb();
                if (tempAuth && tempAuth.clearAuth) {
                    await tempAuth.clearAuth();
                    console.log('[BotManager] Supabase auth state cleared.');
                }
            } catch (e) {
                console.warn('[BotManager] Could not clear Supabase auth state:', e.message);
            }
        }

        setTimeout(() => {
            this._intentionalLogout = false;
            this.init();
        }, 1500);
    }

    async reconnect() {
        console.log('[BotManager] Manual reconnect requested...');
        try {
            if (this.sock) {
                try { this.sock.end(undefined); } catch (e) {}
                this.sock = null;
            }
        } catch (e) {}

        this.status = 'connecting';
        this.qrCodeUrl = null;
        this._isInitializing = false;
        this.emitStatusUpdate();
        setTimeout(() => this.init(), 1000);
    }

    getGroupsList() {
        const list = [];
        for (const [jid, subject] of this.groupMap.entries()) {
            list.push({ jid, subject });
        }
        return list;
    }

    // Returns true if the given group JID is one of our target local groups
    _isTargetGroup(remoteJid) {
        const hasFilters = process.env.GROUP_LOCAL1_JID || process.env.GROUP_LOCAL1_SUBJECT ||
                           process.env.GROUP_LOCAL2_JID || process.env.GROUP_LOCAL2_SUBJECT ||
                           process.env.GROUP_MERCADO_FRESCOS_JID || process.env.GROUP_MERCADO_FRESCOS_SUBJECT ||
                           config.targetGroupJid || config.targetGroupSubject;
        
        if (!hasFilters) {
            console.warn('[BotManager] No target group configured; ignoring media until GROUP_LOCAL*_JID/SUBJECT is set.');
            return false;
        }
        
        return this._isLocal1Group(remoteJid) || this._isLocal2Group(remoteJid) || this._isMercadoFrescosGroup(remoteJid);
    }

    _isLocal1Group(remoteJid) {
        // Local 1 / Local Cba filter
        const targetJid = (process.env.GROUP_LOCAL1_JID || config.targetGroupJid || '').trim();
        const targetSubject = (process.env.GROUP_LOCAL1_SUBJECT || config.targetGroupSubject || '').trim().toLowerCase().replace(/\s+/g, '');
        const groupSubject = (this.groupMap.get(remoteJid) || '').trim().toLowerCase().replace(/\s+/g, '');

        if (targetJid && targetJid.endsWith('@g.us') && remoteJid === targetJid) return true;
        if (targetSubject && groupSubject && (groupSubject.includes(targetSubject) || targetSubject.includes(groupSubject))) return true;
        return false;
    }

    _isLocal2Group(remoteJid) {
        // Local 2 / Repartos filter
        const targetJid = (process.env.GROUP_LOCAL2_JID || '').trim();
        const targetSubject = (process.env.GROUP_LOCAL2_SUBJECT || '').trim().toLowerCase().replace(/\s+/g, '');
        const groupSubject = (this.groupMap.get(remoteJid) || '').trim().toLowerCase().replace(/\s+/g, '');

        if (targetJid && targetJid.endsWith('@g.us') && remoteJid === targetJid) return true;
        if (targetSubject && groupSubject && (groupSubject.includes(targetSubject) || targetSubject.includes(groupSubject))) return true;
        return false;
    }

    _isMercadoFrescosGroup(remoteJid) {
        const targetJid = (process.env.GROUP_MERCADO_FRESCOS_JID || '').trim();
        const targetSubject = (process.env.GROUP_MERCADO_FRESCOS_SUBJECT || '').trim().toLowerCase().replace(/\s+/g, '');
        const groupSubject = (this.groupMap.get(remoteJid) || '').trim().toLowerCase().replace(/\s+/g, '');

        if (targetJid && targetJid.endsWith('@g.us') && remoteJid === targetJid) return true;
        if (targetSubject && groupSubject && (groupSubject.includes(targetSubject) || targetSubject.includes(groupSubject))) return true;
        return false;
    }
}

export const botManager = new BotManager();
