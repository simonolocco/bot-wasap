import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import mime from 'mime-types';
import { fileURLToPath } from 'url';

import { config } from './config.js';
import { botManager } from './botManager.js';
import { getAllReceipts, getFilteredReceipts, getDailyStats, saveReceipt, deleteReceipt, updateReceiptNote, updateReceiptDate, updateReceiptFechaComprobante, updateReceiptFields, clearAllReceipts, deleteDuplicateReceipts } from './services/database/dbService.js';
import { processImageForReceipt, adjustDateForCutoff, normalizeTime } from './services/ocr/ocrService.js';
import { compressMediaImage } from './services/media/mediaCompressor.js';
import { createReceiptFromOcr } from './services/receipts/receiptProcessingService.js';
import { generateReceiptsExcel } from './services/export/excelService.js';
import { reconcileHomebanking, triggerAutoReprocess, matchReceiptsWithMovements, mergeBankMovementNotes, filterReceiptsForAccount, normalizeReconciliationAccount } from './services/reconciliation/reconciliationService.js';
import { getAllReconciliations, getReconciliationById, saveReconciliation, deleteReconciliation } from './services/database/reconciliationDb.js';
import { initPostgresTables } from './services/database/postgresDb.js';
import {
    getRecipientAccounts,
    isMercadoFrescosReceipt,
    MERCADO_FRESCOS_BRANCHES,
    RECIPIENT_ACCOUNT_MERCADO_FRESCOS,
    MERCADO_FRESCOS_UNASSIGNED_LOCAL
} from './services/receipts/recipientService.js';
import {
    AUTH_ENABLED,
    createSession,
    getExpiredSessionCookie,
    getSessionCookie,
    isSessionValid,
    parseCookies,
    requireAuth,
    revokeSession
} from './services/auth/authService.js';
import { createMediaUpload } from './services/media/uploadService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' },
    addTrailingSlash: false
});

app.set('trust proxy', 1);
app.use((req, res, next) => {
    const forwardedProto = req.get('x-forwarded-proto');
    if (process.env.NODE_ENV === 'production' && forwardedProto === 'http') {
        return res.redirect(301, `https://${req.get('host')}${req.originalUrl}`);
    }
    if (forwardedProto === 'https' || req.secure) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // The receipt details modal embeds same-origin PDFs in an iframe. Keep
    // clickjacking protection for every external origin while allowing that
    // first-party viewer to render.
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const upload = createMediaUpload(config.mediaDir);

// Authentication state lives in services/auth/authService.js.

// In-memory session store: token → expiry timestamp
// Login endpoint
app.post('/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!AUTH_ENABLED) return res.json({ ok: true });
    const token = createSession(username, password);
    if (token) {
        res.setHeader('Set-Cookie', getSessionCookie(token));
        return res.json({ ok: true });
    }
    res.status(401).json({ error: 'Credenciales incorrectas' });
});

// Logout endpoint
app.get('/auth/logout', (req, res) => {
    const cookies = parseCookies(req);
    revokeSession(cookies.wa_auth);
    res.setHeader('Set-Cookie', getExpiredSessionCookie());
    res.redirect('/login.html');
});

// Serve login page without auth
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// PWA metadata must be reachable before the dashboard auth middleware. Android
// Chrome validates these resources independently while deciding whether the
// dashboard can be installed, and may not attach the dashboard session cookie.
app.get('/manifest.webmanifest', (req, res) => {
    res.type('application/manifest+json');
    res.sendFile(path.join(__dirname, 'public', 'manifest.webmanifest'));
});

app.get('/sw.js', (req, res) => {
    res.type('application/javascript');
    res.setHeader('Service-Worker-Allowed', '/');
    res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.use('/icons', express.static(path.join(__dirname, 'public', 'icons')));

// Serve static frontend files (protected)
app.use(requireAuth, express.static(path.join(__dirname, 'public')));

// Serve media image files for web preview (protected)
app.use('/media', requireAuth, express.static(config.mediaDir));

// --- API ENDPOINTS ---
app.use('/api', requireAuth);

// Get WhatsApp bot connection status
app.get('/api/whatsapp/status', (req, res) => {
    res.json(botManager.getStatus());
});

// Disconnect / Logout from WhatsApp Web and clear session
app.post('/api/whatsapp/disconnect', async (req, res) => {
    try {
        await botManager.logout();
        res.json({ success: true, message: 'WhatsApp desconectado. Sesión eliminada.' });
    } catch (err) {
        console.error('Disconnect error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Force Regeneration of QR Code / Reconnect
app.post('/api/whatsapp/reconnect', async (req, res) => {
    try {
        await botManager.reconnect();
        res.json({ success: true, message: 'Reconexión iniciada. Generando nuevo QR...' });
    } catch (err) {
        console.error('Reconnect error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Public config for frontend (local classification)
app.get('/api/config', (req, res) => {
    const local1Raw = (process.env.LOCAL1_NUMBERS || '3517565641,3517565643,3517565644,3515597478').trim();
    const local1Numbers = local1Raw.split(',').map(s => s.trim()).filter(Boolean);
    // Also expose the display names so frontend can match receipt.sender
    const senderNameMap = {
        '3517565641': 'Distribuidora Abasto del Campo',
        '3517565644': 'Pablo',
        '3517565643': 'Franco Barberis',
        '3515597478': 'Ventas Abasto del Campo'
    };
    const local1Names = local1Numbers.map(num => senderNameMap[num]).filter(Boolean);
    const recipientAccounts = getRecipientAccounts();
    res.json({
        local1Numbers,
        local1Names,
        recipientAlias: recipientAccounts.find(account => account.id === 'abasto')?.alias || '',
        mercadoFrescosAlias: recipientAccounts.find(account => account.id === 'mercado_frescos')?.alias || '',
        mercadoFrescosBranches: MERCADO_FRESCOS_BRANCHES
    });
});

// Get per-day aggregated stats (for History view)
app.get('/api/receipts/days', async (req, res) => {
    try {
        const days = await getDailyStats();
        res.json(days);
    } catch (err) {
        console.error('Error in /api/receipts/days:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get receipts list with optional filters
app.get('/api/receipts', async (req, res) => {
    const { days, startDate, endDate, search, fecha, account } = req.query;
    const receipts = await getFilteredReceipts({ days, startDate, endDate, search, fecha, account });
    res.json(receipts);
});
// Get the most recently received receipts across all accounts.
app.get('/api/receipts/latest', async (req, res) => {
    try {
        const requestedSince = Number(req.query.since);
        const since = Number.isFinite(requestedSince) && requestedSince >= 0 ? requestedSince : 0;
        const requestedLimit = Number(req.query.limit);
        const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 500) : 100;
        const receipts = await getAllReceipts({ includeThumbnail: false, preserveDuplicates: true });
        const latestReceipts = receipts
            .filter(receipt => {
                const receivedAt = Date.parse(receipt.createdAt || '');
                return Number.isFinite(receivedAt) && receivedAt > since;
            })
            .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
            .slice(0, limit)
            .map(receipt => ({
                id: receipt.id,
                fecha: receipt.fecha || null,
                hora: receipt.hora || null,
                monto: receipt.monto || 0,
                moneda: receipt.moneda || 'ARS',
                emisor: receipt.emisor || '',
                destinatario: receipt.destinatario || '',
                tipo_comprobante: receipt.tipo_comprobante || '',
                concepto: receipt.concepto || '',
                local: receipt.local || '',
                nro_operacion: receipt.nro_operacion || '',
                sender: receipt.sender || '',
                status: receipt.status || '',
                repeatCount: receipt.repeatCount || 1,
                duplicateReason: receipt.duplicateReason || '',
                filename: receipt.filename || '',
                createdAt: receipt.createdAt || null,
                updatedAt: receipt.updatedAt || null
            }));
        res.json(latestReceipts);
    } catch (err) {
        console.error('Latest receipts error:', err);
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/receipts/:id', async (req, res) => {
    try {
        const receipts = await getAllReceipts({ id: req.params.id });
        const receipt = receipts.find(item => item.id === req.params.id);
        if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
        res.json(receipt);
    } catch (err) {
        console.error('Receipt detail error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Serve one cached media preview on demand. List responses intentionally omit
// the Base64 payload so navigating to an old day stays lightweight. For PDFs,
// the cached payload is the complete document; if no cache exists, fall back
// to the persistent media file.
app.get('/api/receipts/:id/thumbnail', async (req, res) => {
    try {
        const rows = await getAllReceipts({ id: req.params.id });
        const receipt = rows.find(row => row.id === req.params.id);
        const thumbnail = receipt?.thumbnailBase64 || '';
        const match = thumbnail.match(/^data:((?:image\/[a-zA-Z0-9.+-]+)|(?:application\/pdf));base64,(.+)$/);

        if (match) {
            res.setHeader(
                'Cache-Control',
                match[1] === 'application/pdf' ? 'private, no-store' : 'private, max-age=3600'
            );
            res.setHeader('Content-Disposition', 'inline');
            res.type(match[1]);
            return res.send(Buffer.from(match[2], 'base64'));
        }

        const mediaRoot = path.resolve(config.mediaDir);
        const candidatePaths = [
            receipt?.filename ? path.resolve(mediaRoot, receipt.filename) : null,
            receipt?.filePath ? path.resolve(receipt.filePath) : null
        ].filter(Boolean);
        const isInsideMediaRoot = candidatePath =>
            candidatePath === mediaRoot || candidatePath.startsWith(`${mediaRoot}${path.sep}`);
        const candidatePath = candidatePaths.find(candidate =>
            isInsideMediaRoot(candidate) && fs.existsSync(candidate)
        );

        if (!candidatePath) {
            return res.status(404).end();
        }

        const candidateMimeType = mime.lookup(candidatePath);
        res.setHeader(
            'Cache-Control',
            candidateMimeType === 'application/pdf' ? 'private, no-store' : 'private, max-age=3600'
        );
        if (candidateMimeType === 'application/pdf') {
            res.setHeader('Content-Disposition', 'inline');
        }
        return res.sendFile(candidatePath);
    } catch (err) {
        console.error('Thumbnail error:', err);
        res.status(500).json({ error: 'No se pudo cargar la miniatura' });
    }
});


// Download Excel file
app.get('/api/export-excel', async (req, res) => {
    try {
        const { days, startDate, endDate, search, fecha, account } = req.query;
        const receipts = await getFilteredReceipts({ days, startDate, endDate, search, fecha, account });

        let dateRangeLabel = 'Todos';
        if (fecha) {
            dateRangeLabel = `Dia_${fecha}`;
        } else if (days) {
            dateRangeLabel = `Últimos ${days} días`;
        } else if (startDate && endDate) {
            dateRangeLabel = `Del ${startDate} al ${endDate}`;
        } else if (startDate) {
            dateRangeLabel = `Desde ${startDate}`;
        } else if (endDate) {
            dateRangeLabel = `Hasta ${endDate}`;
        }

        const buffer = await generateReceiptsExcel(receipts, { dateRange: dateRangeLabel });

        const fileName = `Comprobantes_${dateRangeLabel.replace(/[^a-zA-Z0-9_]/g, '_')}_${new Date().toISOString().slice(0,10)}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(buffer);
    } catch (err) {
        console.error('Error generating Excel:', err);
        res.status(500).json({ error: 'Failed to generate Excel file' });
    }
});

// Save / Update internal note for a receipt
app.post('/api/receipts/:id/note', async (req, res) => {
    try {
        const { id } = req.params;
        const { note } = req.body;
        const updated = await updateReceiptNote(id, note);
        if (updated) {
            io.emit('receipt_processed', updated);
            triggerAutoReprocess(io);
            res.json(updated);
        } else {
            res.status(404).json({ error: 'Receipt not found' });
        }
    } catch (err) {
        console.error('Update note error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Update fecha (date) for a receipt
app.patch('/api/receipts/:id/fecha', async (req, res) => {
    try {
        const { id } = req.params;
        const { fecha } = req.body;
        // Validate format YYYY-MM-DD
        if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
            return res.status(400).json({ error: 'Formato de fecha inválido. Usar YYYY-MM-DD.' });
        }
        let updated = await updateReceiptDate(id, fecha || null);
        if (updated) {
            const normalizedHora = normalizeTime(updated.hora);
            const hasRequiredTiming = Boolean(fecha && normalizedHora);
            const shouldComplete = hasRequiredTiming &&
                (updated.status === 'missing_date' || updated.status === 'error');
            const effectiveFechaComprobante = hasRequiredTiming
                ? adjustDateForCutoff(fecha, normalizedHora)
                : (fecha || null);
            const timingFields = {};

            // `fecha` is the extraction/operational date and must not move to
            // the next day because of the 20:00 cutoff. Only the date used by
            // reconciliation receives that adjustment.
            if (shouldComplete) {
                timingFields.fecha_comprobante = effectiveFechaComprobante;
                timingFields.status = 'completed';
            }
            if (!fecha && updated.status === 'completed' && Number(updated.monto) > 0) {
                timingFields.status = 'missing_date';
            }

            if (Object.keys(timingFields).length > 0) {
                updated = await updateReceiptFields(id, timingFields);
            }
        }
        if (updated) {
            io.emit('receipt_processed', updated);
            triggerAutoReprocess(io);
            res.json(updated);
        } else {
            res.status(404).json({ error: 'Receipt not found' });
        }
    } catch (err) {
        console.error('Update fecha error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Update fecha_comprobante (receipt date used for reconciliation)
app.patch('/api/receipts/:id/fecha-comprobante', async (req, res) => {
    try {
        const { id } = req.params;
        const { fecha_comprobante } = req.body;
        if (fecha_comprobante && !/^\d{4}-\d{2}-\d{2}$/.test(fecha_comprobante)) {
            return res.status(400).json({ error: 'Formato de fecha inválido. Usar YYYY-MM-DD.' });
        }
        const updated = await updateReceiptFechaComprobante(id, fecha_comprobante || null);
        if (updated) {
            io.emit('receipt_processed', updated);
            res.json(updated);
        } else {
            res.status(404).json({ error: 'Receipt not found' });
        }
    } catch (err) {
        console.error('Update fecha_comprobante error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Update hora (time) for a receipt
app.patch('/api/receipts/:id/hora', async (req, res) => {
    try {
        const { id } = req.params;
        const { hora } = req.body;
        const rawHora = typeof hora === 'string' ? hora.trim() : '';
        const normalizedHora = rawHora ? normalizeTime(rawHora) : null;
        if (rawHora && !normalizedHora) {
            return res.status(400).json({ error: 'Formato de hora inválido. Usar HH:MM.' });
        }

        let updated = await updateReceiptFields(id, { hora: normalizedHora });
        if (updated) {
            const timingFields = {};
            const canComplete = Boolean(updated.fecha && normalizedHora && Number(updated.monto) > 0);

            // When OCR left the receipt waiting for time, updated.fecha is still
            // the detected extraction date. Apply the cutoff only to the date
            // used for reconciliation when the operator completes it.
            if (canComplete && (updated.status === 'missing_date' || updated.status === 'error')) {
                timingFields.fecha_comprobante = adjustDateForCutoff(updated.fecha, normalizedHora);
                timingFields.status = 'completed';
            } else if (!normalizedHora && updated.status === 'completed' && Number(updated.monto) > 0) {
                timingFields.status = 'missing_date';
            }

            if (Object.keys(timingFields).length > 0) {
                updated = await updateReceiptFields(id, timingFields);
            }
        }
        if (updated) {
            io.emit('receipt_processed', updated);
            triggerAutoReprocess(io);
            res.json(updated);
        } else {
            res.status(404).json({ error: 'Receipt not found' });
        }
    } catch (err) {
        console.error('Update hora error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Generic receipt update endpoint (updates any fields passed in body)
app.patch('/api/receipts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const fields = { ...req.body };
        
        // Remove restricted fields
        delete fields.id;
        delete fields.createdAt;
        delete fields.updatedAt;

        // If monto is modified, parse as number
        if (fields.monto !== undefined) {
            fields.monto = typeof fields.monto === 'number' ? fields.monto : parseFloat(fields.monto) || 0;
        }

        const updated = await updateReceiptFields(id, fields);
        if (updated) {
            io.emit('receipt_processed', updated);
            triggerAutoReprocess(io);
            res.json(updated);
        } else {
            res.status(404).json({ error: 'Receipt not found' });
        }
    } catch (err) {
        console.error('Update receipt fields error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Create a manual receipt without an image. This is intentionally separate
// from /api/upload because it must never invoke OCR or create a fake file.
app.post('/api/receipts/manual', async (req, res) => {
    try {
        const {
            account,
            fecha,
            hora,
            monto,
            local,
            emisor,
            tipo_comprobante,
            nro_operacion,
            concepto,
            notas
        } = req.body || {};

        const amount = typeof monto === 'number'
            ? monto
            : Number(String(monto || '').replace(',', '.'));
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ error: 'El monto debe ser mayor a cero.' });
        }
        if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(String(fecha))) {
            return res.status(400).json({ error: 'La fecha es obligatoria y debe tener formato YYYY-MM-DD.' });
        }

        const normalizedHora = typeof hora === 'string' && hora.trim()
            ? normalizeTime(hora.trim())
            : null;
        if (hora && !normalizedHora) {
            return res.status(400).json({ error: 'Formato de hora inválido. Usar HH:MM.' });
        }

        const isMarketAccount = account === RECIPIENT_ACCOUNT_MERCADO_FRESCOS;
        const isMarketLocal = isMercadoFrescosReceipt({ local });
        const validAbastoLocals = new Set(['local1', 'local2']);
        const validMarketLocals = new Set([
            RECIPIENT_ACCOUNT_MERCADO_FRESCOS,
            MERCADO_FRESCOS_UNASSIGNED_LOCAL,
            ...MERCADO_FRESCOS_BRANCHES.map(branch => branch.id)
        ]);

        if ((isMarketAccount && !isMarketLocal) || (!isMarketAccount && isMarketLocal)) {
            return res.status(400).json({ error: 'La cuenta y el local seleccionado no coinciden.' });
        }
        if (isMarketAccount ? !validMarketLocals.has(local) : !validAbastoLocals.has(local)) {
            return res.status(400).json({ error: 'El local seleccionado no es válido.' });
        }

        const effectiveFechaComprobante = normalizedHora
            ? adjustDateForCutoff(fecha, normalizedHora)
            : fecha;
        const status = normalizedHora ? 'completed' : 'missing_date';
        const recipientAccounts = getRecipientAccounts();
        const recipientAlias = recipientAccounts.find(item =>
            item.id === (isMarketAccount ? RECIPIENT_ACCOUNT_MERCADO_FRESCOS : 'abasto')
        )?.alias || null;

        const saved = await saveReceipt({
            id: 'rec_' + Date.now() + '_manual_no_photo',
            fecha,
            fecha_comprobante: effectiveFechaComprobante,
            hora: normalizedHora,
            monto: amount,
            moneda: 'ARS',
            emisor: String(emisor || '').trim() || 'Carga manual',
            destinatario: recipientAlias,
            local,
            tipo_comprobante: String(tipo_comprobante || 'Transferencia').trim(),
            concepto: String(concepto || '').trim(),
            nro_operacion: String(nro_operacion || '').trim(),
            sender: 'Carga Manual sin foto',
            filename: '',
            filePath: '',
            thumbnailBase64: '',
            status,
            notas: String(notas || '').trim(),
            rawText: 'Comprobante agregado manualmente sin foto.'
        });

        io.emit('receipt_processed', saved);
        triggerAutoReprocess(io);
        res.status(201).json(saved);
    } catch (err) {
        console.error('Manual no-photo receipt error:', err);
        res.status(500).json({ error: err.message });
    }
});

// List all saved reconciliations
app.get('/api/reconciliations', async (req, res) => {
    res.json(await getAllReconciliations());
});

// Get a specific saved reconciliation
app.get('/api/reconciliations/:id', async (req, res) => {
    const recon = await getReconciliationById(req.params.id);
    if (recon) res.json(recon);
    else res.status(404).json({ error: 'Reconciliation audit not found' });
});

// Delete a saved reconciliation
app.delete('/api/reconciliations/:id', async (req, res) => {
    const success = await deleteReconciliation(req.params.id);
    if (success) res.json({ success: true });
    else res.status(500).json({ error: 'Failed to delete reconciliation audit' });
});

// Save / store a reconciliation audit (and reprocess it dynamically using the latest receipts)
app.post('/api/reconciliations', async (req, res) => {
    try {
        const auditData = req.body;
        const account = normalizeReconciliationAccount(auditData.account);

        // Fetch all current receipts
        const allReceipts = filterReceiptsForAccount(await getAllReceipts(), account);

        // Reconstruct bank movements from the incoming payload
        let bankMovements = auditData.bankMovements || [];
        if (bankMovements.length === 0) {
            const matched = (auditData.verifiedReceipts || [])
                .map(r => r.bankMatch)
                .filter(Boolean)
                .map((bm, index) => ({
                    id: bm.id || `reconstructed_bank_m_${index}_${auditData.id}`,
                    fecha: bm.fecha,
                    referencia: bm.referencia,
                    concepto: bm.concepto,
                    importe: bm.importe,
                    matchedReceiptId: null
                }));
            const unclaimed = (auditData.unclaimedBankMovements || []).map(bm => ({
                ...bm,
                matchedReceiptId: null
            }));
            bankMovements = [...matched, ...unclaimed];
        }

        bankMovements = mergeBankMovementNotes(
            bankMovements,
            auditData.unclaimedBankMovements
        );

        // Re-run matching algorithm to apply manual overrides and filter manual resolutions
        const updatedRecon = matchReceiptsWithMovements(bankMovements, allReceipts, {
            startDate: auditData.dateRange?.startDate,
            endDate: auditData.dateRange?.endDate,
            name: auditData.name,
            fileName: auditData.fileName,
            createdAt: auditData.createdAt,
            id: auditData.id,
            account,
            manualOverrides: auditData.manualOverrides
        });

        const saved = await saveReconciliation(updatedRecon);
        
        // Notify other clients
        io.emit('reconciliation_updated', saved);
        
        res.json(saved);
    } catch (err) {
        console.error('Save / Reprocess reconciliation error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Reprocess an existing reconciliation audit manually on-demand
app.post('/api/reconciliations/:id/reprocess', async (req, res) => {
    try {
        const { id } = req.params;
        const recon = await getReconciliationById(id);
        if (!recon) {
            return res.status(404).json({ error: 'Auditoría de conciliación no encontrada.' });
        }

        // Fetch all current receipts
        const account = normalizeReconciliationAccount(recon.account);
        const allReceipts = filterReceiptsForAccount(await getAllReceipts(), account);

        const previousReceiptCount = (recon.verifiedReceipts || []).length + (recon.unverifiedReceipts || []).length;
        if (previousReceiptCount > 0 && allReceipts.length === 0) {
            return res.status(503).json({ error: 'No se pudieron cargar los comprobantes actuales. La auditoría no fue modificada; intentá nuevamente en unos segundos.' });
        }

        // Reconstruct bank movements if they are not saved in the record
        let bankMovements = recon.bankMovements || [];
        if (bankMovements.length === 0) {
            const matched = (recon.verifiedReceipts || [])
                .map(r => r.bankMatch)
                .filter(Boolean)
                .map((bm, index) => ({
                    id: `reconstructed_bank_m_${index}_${recon.id}`,
                    fecha: bm.fecha,
                    referencia: bm.referencia,
                    concepto: bm.concepto,
                    importe: bm.importe,
                    matchedReceiptId: null
                }));
            const unclaimed = (recon.unclaimedBankMovements || []).map(bm => ({
                ...bm,
                matchedReceiptId: null
            }));
            bankMovements = [...matched, ...unclaimed];
        }

        bankMovements = mergeBankMovementNotes(
            bankMovements,
            recon.unclaimedBankMovements
        );

        // Re-run matching algorithm
        const updatedRecon = matchReceiptsWithMovements(bankMovements, allReceipts, {
            startDate: recon.dateRange?.startDate,
            endDate: recon.dateRange?.endDate,
            name: recon.name,
            fileName: recon.fileName,
            createdAt: recon.createdAt,
            id: recon.id,
            account,
            manualOverrides: recon.manualOverrides
        });

        // Save back to DB
        const saved = await saveReconciliation(updatedRecon);

        // Notify other clients that it was updated
        io.emit('reconciliation_updated', saved);

        res.json(saved);
    } catch (err) {
        console.error('Reprocess reconciliation error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Reconcile Homebanking Excel statement against receipts
app.post('/api/reconcile-excel', upload.single('excelFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No Excel file uploaded' });
        }

        const { startDate, endDate, name, account: requestedAccount } = req.query;
        const account = normalizeReconciliationAccount(requestedAccount);
        const receipts = filterReceiptsForAccount(await getAllReceipts(), account);

        const auditName = (req.body && req.body.name) || name || `Conciliación ${new Date().toLocaleDateString('es-AR')}`;

        const report = reconcileHomebanking(req.file.path, receipts, {
            startDate,
            endDate,
            name: auditName,
            fileName: req.file.originalname,
            account
        });

        // Delete temporary uploaded excel file after processing
        try { fs.unlinkSync(req.file.path); } catch (e) {}

        res.json(report);
    } catch (err) {
        console.error('Reconciliation error:', err);
        res.status(500).json({ error: 'Error processing Homebanking file: ' + err.message });
    }
});

// Reprocess an existing receipt with AI Vision
app.post('/api/reprocess/:id', async (req, res) => {
    let receipt = null;
    try {
        const { id } = req.params;
        const receipts = await getAllReceipts();
        receipt = receipts.find(r => r.id === id);

        if (!receipt) {
            return res.status(404).json({ error: 'Receipt not found' });
        }

        let localPath = receipt.filePath || path.join(config.mediaDir, receipt.filename);
        let isTempFile = false;

        if (!fs.existsSync(localPath)) {
            if (receipt.thumbnailBase64 && receipt.thumbnailBase64.startsWith('data:image')) {
                console.log(`🔍 [Reprocess] File not found on disk. Recreating from base64 cache for ID ${id}...`);
                const matches = receipt.thumbnailBase64.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
                if (matches && matches.length === 3) {
                    const ext = matches[1];
                    const dataBuffer = Buffer.from(matches[2], 'base64');
                    localPath = path.join(config.mediaDir, `reprocess_temp_${Date.now()}.${ext}`);
                    fs.writeFileSync(localPath, dataBuffer);
                    isTempFile = true;
                }
            }
        }

        if (!fs.existsSync(localPath)) {
            return res.status(404).json({ error: 'Associated image file not found on disk or database cache' });
        }

        // Notify Web UI that processing started
        io.emit('receipt_processing', { ...receipt, status: 'processing' });

        const ocrResult = await processImageForReceipt(localPath);

        if (isTempFile) {
            try { fs.unlinkSync(localPath); } catch (e) {}
        }

        const updated = await saveReceipt(createReceiptFromOcr(receipt, ocrResult, {
            fallbackLocal: receipt.local,
            persistRecipient: false
        }).receipt);

        io.emit('receipt_processed', updated);
        triggerAutoReprocess(io);
        res.json(updated);
    } catch (err) {
        console.error('Reprocess error:', err);
        if (receipt) {
            try {
                const failed = await updateReceiptFields(receipt.id, {
                    status: 'error',
                    rawText: `Error de reprocesamiento: ${err.message}`,
                    notas: `Error de reprocesamiento: ${err.message}`
                });
                if (failed) {
                    io.emit('receipt_processed', failed);
                    return res.json(failed);
                }
            } catch (saveErr) {
                console.error('Could not persist reprocess error:', saveErr);
            }
        }
        res.status(500).json({ error: err.message });
    }
});

// Manual upload endpoint
app.post('/api/upload', upload.single('receiptImage'), async (req, res) => {
    let tempReceipt = null;
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file uploaded' });
        }

        const filePath = req.file.path;
        const fileName = req.file.filename;
        const isMercadoFrescosUpload = req.body?.account === RECIPIENT_ACCOUNT_MERCADO_FRESCOS;
        const manualLocal = isMercadoFrescosUpload ? 'mercado_frescos_repartos' : 'local1';

        tempReceipt = {
            id: `rec_${Date.now()}_manual`,
            filename: fileName,
            filePath,
            thumbnailBase64: '',
            sender: 'Carga Manual',
            local: manualLocal,
            status: 'processing',
            createdAt: new Date().toISOString()
        };
        io.emit('receipt_processing', tempReceipt);

        // Ultra-compress manually uploaded file
        const fileBuffer = fs.readFileSync(filePath);
        const mimeType = req.file.mimetype || 'image/jpeg';
        const { compressedBuffer, base64DataUrl } = await compressMediaImage(fileBuffer, mimeType);
        fs.writeFileSync(filePath, compressedBuffer);
        tempReceipt.thumbnailBase64 = base64DataUrl;

        const ocrResult = await processImageForReceipt(filePath);
        const saved = await saveReceipt(createReceiptFromOcr(tempReceipt, ocrResult, {
            fallbackLocal: tempReceipt.local,
            mercadoFrescosLocal: isMercadoFrescosUpload ? 'mercado_frescos_repartos' : null,
            persistRecipient: false
        }).receipt);

        if (saved && saved.id !== tempReceipt.id) {
            io.emit('receipt_deleted', { id: tempReceipt.id });
        }
        io.emit('receipt_processed', saved);
        triggerAutoReprocess(io);
        res.json(saved);
    } catch (err) {
        console.error('Upload error:', err);
        if (tempReceipt) {
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
                io.emit('receipt_processed', failedReceipt);
                return res.json(failedReceipt);
            } catch (saveErr) {
                console.error('Could not persist manual upload error:', saveErr);
            }
        }
        res.status(500).json({ error: err.message });
    }
});

// Delete single receipt endpoint
app.delete('/api/receipts/:id', async (req, res) => {
    const { id } = req.params;
    const success = await deleteReceipt(id);
    if (success) {
        io.emit('receipt_deleted', { id });
        triggerAutoReprocess(io);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Receipt not found' });
    }
});

// Delete all duplicate receipts endpoint
app.delete('/api/receipts-duplicates', async (req, res) => {
    try {
        const account = req.query.account === 'mercado_frescos' ? 'mercado_frescos' : 'abasto';
        const cleanup = await deleteDuplicateReceipts(account);
        // Emit event so the web app reloads
        io.emit('receipts_cleared'); // Using receipts_cleared as a generic signal to force reload
        triggerAutoReprocess(io);
        res.json({ success: true, ...cleanup });
    } catch (err) {
        console.error('Delete duplicates error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Clear ALL receipts endpoint (Reset database)
app.delete('/api/receipts-all', async (req, res) => {
    try {
        const account = req.query.account === 'mercado_frescos' ? 'mercado_frescos' : 'abasto';
        const success = await clearAllReceipts(account);
        if (success) {
            io.emit('receipts_cleared');
            triggerAutoReprocess(io);
            res.json({ success: true, message: 'Todos los comprobantes fueron eliminados.' });
        } else {
            res.status(500).json({ error: 'Error al vaciar la base de datos' });
        }
    } catch (err) {
        console.error('Clear all error:', err);
        res.status(500).json({ error: err.message });
    }
});

// List all active WhatsApp groups and their JIDs
app.get('/api/whatsapp/groups', (req, res) => {
    try {
        const groups = botManager.getGroupsList();
        res.json({ success: true, count: groups.length, groups });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- SOCKET.IO REALTIME EVENTS ---
io.use((socket, next) => {
    if (!AUTH_ENABLED) return next();
    const token = parseCookies({ headers: socket.handshake.headers }).wa_auth;
    if (isSessionValid(token)) return next();
    next(new Error('No autorizado'));
});

io.on('connection', (socket) => {
    console.log('[Socket.io] Client connected to live updates dashboard.');
    
    // Send current status immediately on connection
    socket.emit('status_update', botManager.getStatus());

    socket.on('disconnect', () => {
        console.log('[Socket.io] Client disconnected.');
    });
});

// Pass status and receipt events from botManager to socket.io
botManager.on('status_update', (status) => {
    io.emit('status_update', status);
});

botManager.on('receipt_processing', (receipt) => {
    io.emit('receipt_processing', receipt);
});

botManager.on('receipt_processed', (receipt) => {
    io.emit('receipt_processed', receipt);
    triggerAutoReprocess(io);
});

botManager.on('receipt_discarded', ({ id, reason }) => {
    io.emit('receipt_deleted', { id });
});

// --- SERVER INITIALIZATION ---
const PORT = process.env.PORT || 3000;

server.listen(PORT, async () => {
    console.log(`\n========================================================`);
    console.log(`🌐 Dashboard Server running at: http://localhost:${PORT}`);
    console.log(`========================================================\n`);

    // Self-healing database table migrations for the legacy cloud backend.
    if (process.env.USE_SUPABASE === 'true') try {
        await initPostgresTables();
    } catch (dbErr) {
        console.error('⚠️ [Server] Could not initialize Postgres tables:', dbErr.message);
    }

    // Initialize WhatsApp bot connection with a delay in production/Render to avoid stream conflict
    const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
    const disableWhatsApp = process.env.DISABLE_WHATSAPP === 'true';

    if (disableWhatsApp) {
        console.log('🚫 [Server] Inicialización del bot de WhatsApp DESACTIVADA (DISABLE_WHATSAPP=true).');
    } else if (isProduction) {
        console.log('🚀 [Server] Entorno Render/Producción detectado. Retrasando inicialización de WhatsApp por 15 segundos para evitar conflictos de sesión con la instancia vieja...');
        setTimeout(() => {
            console.log('🚀 [Server] Iniciando conexión de WhatsApp...');
            botManager.init();
        }, 15000);
    } else {
        botManager.init();
    }
});
