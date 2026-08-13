import { getDb, saveDbToDisk } from './sqliteDb.js';
import { extractOperationNumber } from '../ocr/ocrService.js';
import {
    supabaseGetAllReceipts,
    supabaseGetDailyStats,
    supabaseSaveReceipt,
    supabaseClearAllReceipts,
    supabaseUpdateReceiptNote,
    supabaseUpdateReceiptDate,
    supabaseUpdateReceiptFechaComprobante,
    supabaseUpdateReceiptFields,
    supabaseDeleteReceipt,
    supabaseDeleteDuplicateReceipts
} from './supabaseService.js';
import fs from 'fs';
import path from 'path';
import { config } from '../../config.js';
import {
    isMercadoFrescosReceipt,
    isMercadoFrescosLocal,
    MERCADO_FRESCOS_BRANCHES,
    MERCADO_FRESCOS_UNASSIGNED_LOCAL,
    getMercadoFrescosBranchForSender
} from '../receipts/recipientService.js';

const isSupabaseEnabled = () => process.env.USE_SUPABASE === 'true';

function parseQueryRows(db, query, params = []) {
    const stmt = db.prepare(query);
    if (params.length > 0) stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

/**
 * Gets all receipts with duplicate consolidation
 * @returns {Promise<Array>}
 */
export async function getAllReceipts(filters = {}) {
    if (isSupabaseEnabled()) {
        try {
            const rows = await supabaseGetAllReceipts(filters);
            if (filters.preserveDuplicates) {
                return rows.map(r => ({
                    ...r,
                    monto: typeof r.monto === 'number' ? r.monto : parseFloat(r.monto) || 0
                }));
            }
            const mapByOp = new Map();
            const consolidatedList = [];

            // Group oldest first to keep the original record
            [...rows].reverse().forEach(r => {
                const opKey = r.nro_operacion
                    ? `${r.local || 'legacy'}::${String(r.nro_operacion).trim()}`
                    : null;
                if (opKey && opKey !== '' && opKey !== 'null') {
                    if (mapByOp.has(opKey)) {
                        const existing = mapByOp.get(opKey);
                        existing.repeatCount = (existing.repeatCount || 1) + 1;
                        existing.isDuplicate = false;
                        existing.duplicateReason = `Comprobante enviado ${existing.repeatCount} veces (N° Op: ${String(existing.nro_operacion).trim()})`;
                    } else {
                        r.isDuplicate = false;
                        r.repeatCount = r.repeatCount || 1;
                        if (r.isDuplicate) {
                            r.duplicateReason = r.duplicateReason || `Comprobante enviado ${r.repeatCount} veces (N° Op: ${String(r.nro_operacion).trim()})`;
                        }
                        mapByOp.set(opKey, r);
                        consolidatedList.push(r);
                    }
                } else {
                    r.isDuplicate = Boolean(r.isDuplicate);
                    consolidatedList.push(r);
                }
            });

            // Detect possible duplicates dynamically in the consolidated list
            for (let i = 0; i < consolidatedList.length; i++) {
                const r = consolidatedList[i];
                
                // Skip if already a duplicate or confirmed as not a duplicate
                if (r.isDuplicate || r.duplicateReason === 'CONFIRMADO_NO_DUPLICADO') continue;
                
                // If it has no operation number, look for duplicates
                const hasNoOp = !r.nro_operacion || String(r.nro_operacion).trim() === '' || String(r.nro_operacion).trim() === 'null';
                if (hasNoOp && r.fecha && r.monto && r.emisor) {
                    const match = consolidatedList.find(other => {
                        if (other.id === r.id) return false;
                        if (other.status !== 'completed') return false;
                        
                        const sameFecha = r.fecha && other.fecha && String(r.fecha).trim().slice(0, 10) === String(other.fecha).trim().slice(0, 10);
                        const sameMonto = Math.abs((parseFloat(r.monto)||0) - (parseFloat(other.monto)||0)) < 0.01;
                        const sameEmisor = r.emisor && other.emisor && String(r.emisor).trim().toLowerCase() === String(other.emisor).trim().toLowerCase();
                        
                        return sameFecha && sameMonto && sameEmisor;
                    });
                    
                    if (match) {
                        r.duplicateReason = `POSIBLE_DUPLICADO:${match.id}`;
                    }
                }
            }

            // Reverse back to keep descending order for UI
            return consolidatedList.reverse().map(r => ({
                ...r,
                monto: typeof r.monto === 'number' ? r.monto : parseFloat(r.monto) || 0
            }));
        } catch (err) {
            console.error('Error in getAllReceipts Supabase:', err);
        }
    }

    try {
        const { db } = await getDb();
        const idClause = filters.id ? ' WHERE id = ?' : '';
        const rows = parseQueryRows(
            db,
            `SELECT * FROM receipts${idClause} ORDER BY createdAt DESC`,
            filters.id ? [filters.id] : []
        );
        if (filters.preserveDuplicates) {
            return rows.map(r => ({
                ...r,
                monto: typeof r.monto === 'number' ? r.monto : parseFloat(r.monto) || 0
            }));
        }
        
        const mapByOp = new Map();
        const consolidatedList = [];

        // Group oldest first to keep the original record
        [...rows].reverse().forEach(r => {
            const operationNumber = r.nro_operacion ? String(r.nro_operacion).trim() : null;
            const opKey = operationNumber ? `${r.local || 'legacy'}::${operationNumber}` : null;
            if (opKey && opKey !== '' && opKey !== 'null') {
                if (mapByOp.has(opKey)) {
                    const existing = mapByOp.get(opKey);
                    existing.repeatCount = (existing.repeatCount || 1) + 1;
                    existing.isDuplicate = false;
                    existing.duplicateReason = `Comprobante enviado ${existing.repeatCount} veces (N° Op: ${String(existing.nro_operacion).trim()})`;
                } else {
                    r.isDuplicate = false;
                    r.repeatCount = r.repeatCount || 1;
                    if (r.isDuplicate) {
                        r.duplicateReason = r.duplicateReason || `Comprobante enviado ${r.repeatCount} veces (N° Op: ${String(r.nro_operacion).trim()})`;
                    }
                    mapByOp.set(opKey, r);
                    consolidatedList.push(r);
                }
            } else {
                r.isDuplicate = Boolean(r.isDuplicate);
                consolidatedList.push(r);
            }
        });

        // Detect possible duplicates dynamically in the consolidated list
        for (let i = 0; i < consolidatedList.length; i++) {
            const r = consolidatedList[i];
            
            // Skip if already a duplicate or confirmed as not a duplicate
            if (r.isDuplicate || r.duplicateReason === 'CONFIRMADO_NO_DUPLICADO') continue;
            
            // If it has no operation number, look for duplicates
            const hasNoOp = !r.nro_operacion || String(r.nro_operacion).trim() === '' || String(r.nro_operacion).trim() === 'null';
            if (hasNoOp && r.fecha && r.monto && r.emisor) {
                const match = consolidatedList.find(other => {
                    if (other.id === r.id) return false;
                    if (other.status !== 'completed') return false;
                    
                    const sameFecha = r.fecha && other.fecha && String(r.fecha).trim().slice(0, 10) === String(other.fecha).trim().slice(0, 10);
                    const sameMonto = Math.abs((parseFloat(r.monto)||0) - (parseFloat(other.monto)||0)) < 0.01;
                    const sameEmisor = r.emisor && other.emisor && String(r.emisor).trim().toLowerCase() === String(other.emisor).trim().toLowerCase();
                    
                    return sameFecha && sameMonto && sameEmisor;
                });
                
                if (match) {
                    r.duplicateReason = `POSIBLE_DUPLICADO:${match.id}`;
                }
            }
        }

        // Reverse back to keep descending order for UI
        return consolidatedList.reverse().map(r => ({
            ...r,
            monto: typeof r.monto === 'number' ? r.monto : parseFloat(r.monto) || 0
        }));
    } catch (err) {
        console.error('Error in getAllReceipts SQLite:', err);
        return [];
    }
}

function determineLocal(receipt) {
    if (!receipt.sender || receipt.sender.includes('Carga Manual') || (receipt.filename && receipt.filename.includes('manual'))) {
        return 'local1';
    }
    const local1Raw = (process.env.LOCAL1_NUMBERS || '3517565641,3517565643,3517565644,3515597478,3515597470,162835246137376').trim();
    const local1Numbers = local1Raw.split(',').map(s => s.trim()).filter(Boolean);
    const senderDigits = (receipt.sender || '').replace(/\D/g, '');
    if (senderDigits && local1Numbers.some(num => senderDigits.endsWith(num))) {
        return 'local1';
    }
    const senderNameMap = {
        '3517565641': 'Distribuidora Abasto del Campo',
        '3517565644': 'Pablo',
        '3517565643': 'Franco Barberis',
        '3515597478': 'Ventas Abasto del Campo',
        '3515597470': 'Ventas Abasto del Campo',
        '162835246137376': 'Ventas Abasto del Campo'
    };
    const local1Names = local1Numbers.map(num => senderNameMap[num]).filter(Boolean);
    if (receipt.sender && local1Names.some(name => receipt.sender.toLowerCase().includes(name.toLowerCase()))) {
        return 'local1';
    }
    return 'local2';
}

/**
 * Saves a new receipt or updates existing with strict duplicate consolidation
 * @param {Object} receiptData 
 * @returns {Promise<Object>} saved receipt
 */
export async function saveReceipt(receiptData) {
    let usedSqliteFallback = false;
    if (isSupabaseEnabled()) {
        try {
            return await supabaseSaveReceipt(receiptData);
        } catch (err) {
            console.error('Error in saveReceipt Supabase:', err);
            usedSqliteFallback = true;
        }
    }

    try {
        const { db } = await getDb();
        const rawText = receiptData.rawText || '';
        const extractedNroOp = receiptData.nro_operacion || extractOperationNumber(rawText) || null;
        const receiptStorageLocal = receiptData.local || determineLocal(receiptData);

        let existing = null;
        
        if (extractedNroOp) {
            const rows = parseQueryRows(db, `SELECT * FROM receipts WHERE nro_operacion = ? AND nro_operacion != ''`, [String(extractedNroOp).trim()]);
            existing = rows.find(row => (row.local || determineLocal(row)) === receiptStorageLocal) || null;
        }

        if (!existing && receiptData.id) {
            const rows = parseQueryRows(db, `SELECT * FROM receipts WHERE id = ?`, [receiptData.id]);
            if (rows.length > 0) existing = rows[0];
        }
        if (!existing && receiptData.filename) {
            const rows = parseQueryRows(db, `SELECT * FROM receipts WHERE filename = ?`, [receiptData.filename]);
            if (rows.length > 0) existing = rows[0];
        }

        let savedItem;
        const now = new Date().toISOString();

        if (existing) {
            const isOpDuplicate = Boolean(extractedNroOp && String(existing.nro_operacion).trim() === String(extractedNroOp).trim() && existing.id !== receiptData.id);
            const newRepeatCount = isOpDuplicate ? (existing.repeatCount || 1) + 1 : (receiptData.repeatCount || existing.repeatCount || 1);
            const isDuplicate = isOpDuplicate ? 0 : (receiptData.isDuplicate ? 1 : existing.isDuplicate);
            const dupReason = isOpDuplicate ? `Comprobante enviado ${newRepeatCount} veces (N° Op: ${extractedNroOp})` : (receiptData.duplicateReason || existing.duplicateReason || '');

            savedItem = {
                id: existing.id,
                fecha: receiptData.fecha !== undefined ? receiptData.fecha : existing.fecha,
                fecha_comprobante: receiptData.fecha_comprobante !== undefined ? receiptData.fecha_comprobante : (existing.fecha_comprobante || existing.fecha || null),
                hora: receiptData.hora !== undefined ? receiptData.hora : (existing.hora || null),
                monto: receiptData.monto !== undefined ? (typeof receiptData.monto === 'number' ? receiptData.monto : parseFloat(receiptData.monto)||0) : existing.monto,
                moneda: receiptData.moneda || existing.moneda || 'ARS',
                emisor: receiptData.emisor || existing.emisor || '',
                destinatario: receiptData.destinatario !== undefined ? receiptData.destinatario : existing.destinatario,
                local: receiptData.local !== undefined ? receiptData.local : existing.local,
                tipo_comprobante: receiptData.tipo_comprobante || existing.tipo_comprobante || '',
                concepto: receiptData.concepto || existing.concepto || '',
                nro_operacion: extractedNroOp || existing.nro_operacion || '',
                sender: receiptData.sender || existing.sender || '',
                filename: receiptData.filename || existing.filename || '',
                filePath: receiptData.filePath || existing.filePath || '',
                thumbnailBase64: receiptData.thumbnailBase64 || existing.thumbnailBase64 || '',
                status: receiptData.status || existing.status || 'completed',
                notas: receiptData.notas !== undefined ? receiptData.notas : (existing.notas || ''),
                isDuplicate: isDuplicate ? 1 : 0,
                repeatCount: newRepeatCount,
                duplicateReason: dupReason,
                rawText: receiptData.rawText || existing.rawText || '',
                createdAt: existing.createdAt || receiptData.createdAt || now,
                updatedAt: now
            };

            if (receiptData.id && receiptData.id !== existing.id) {
                const stmtDel = db.prepare(`DELETE FROM receipts WHERE id = ?`);
                stmtDel.run([receiptData.id]);
                stmtDel.free();
            }

            const stmt = db.prepare(`
                UPDATE receipts SET
                fecha = ?, fecha_comprobante = ?, hora = ?, monto = ?, moneda = ?, emisor = ?, destinatario = ?, local = ?, tipo_comprobante = ?, concepto = ?, nro_operacion = ?,
                sender = ?, filename = ?, filePath = ?, thumbnailBase64 = ?, status = ?, notas = ?,
                isDuplicate = ?, repeatCount = ?, duplicateReason = ?, rawText = ?, updatedAt = ?
                WHERE id = ?
            `);
            stmt.run([
                savedItem.fecha, savedItem.fecha_comprobante, savedItem.hora, savedItem.monto, savedItem.moneda, savedItem.emisor, savedItem.destinatario, savedItem.local, savedItem.tipo_comprobante, savedItem.concepto,
                savedItem.nro_operacion, savedItem.sender, savedItem.filename, savedItem.filePath, savedItem.thumbnailBase64,
                savedItem.status, savedItem.notas, savedItem.isDuplicate, savedItem.repeatCount, savedItem.duplicateReason,
                savedItem.rawText, savedItem.updatedAt, savedItem.id
            ]);
            stmt.free();
        } else {
            savedItem = {
                id: receiptData.id || `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                fecha: receiptData.fecha || null,
                fecha_comprobante: receiptData.fecha_comprobante || receiptData.fecha || null,
                hora: receiptData.hora || null,
                monto: typeof receiptData.monto === 'number' ? receiptData.monto : (parseFloat(receiptData.monto) || 0),
                moneda: receiptData.moneda || 'ARS',
                emisor: receiptData.emisor || '',
                destinatario: receiptData.destinatario || null,
                local: receiptData.local || determineLocal(receiptData),
                tipo_comprobante: receiptData.tipo_comprobante || '',
                concepto: receiptData.concepto || '',
                nro_operacion: extractedNroOp || '',
                sender: receiptData.sender || 'Desconocido',
                filename: receiptData.filename || '',
                filePath: receiptData.filePath || '',
                thumbnailBase64: receiptData.thumbnailBase64 || '',
                status: receiptData.status || 'completed',
                notas: receiptData.notas || '',
                isDuplicate: receiptData.isDuplicate ? 1 : 0,
                repeatCount: receiptData.repeatCount || 1,
                duplicateReason: receiptData.duplicateReason || '',
                rawText: rawText,
                createdAt: receiptData.createdAt || now,
                updatedAt: now
            };

            const stmt = db.prepare(`
                INSERT INTO receipts 
                (id, fecha, fecha_comprobante, hora, monto, moneda, emisor, destinatario, local, tipo_comprobante, concepto, nro_operacion, sender, filename, filePath, thumbnailBase64, status, notas, isDuplicate, repeatCount, duplicateReason, rawText, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run([
                savedItem.id, savedItem.fecha, savedItem.fecha_comprobante, savedItem.hora, savedItem.monto, savedItem.moneda, savedItem.emisor, savedItem.destinatario, savedItem.local, savedItem.tipo_comprobante,
                savedItem.concepto, savedItem.nro_operacion, savedItem.sender, savedItem.filename, savedItem.filePath,
                savedItem.thumbnailBase64, savedItem.status, savedItem.notas, savedItem.isDuplicate, savedItem.repeatCount,
                savedItem.duplicateReason, savedItem.rawText, savedItem.createdAt, savedItem.updatedAt
            ]);
            stmt.free();
        }

        saveDbToDisk();
        const result = {
            ...savedItem,
            isDuplicate: Boolean(savedItem.isDuplicate)
        };
        if (usedSqliteFallback) result.__storageFallback = true;
        return result;
    } catch (err) {
        console.error('Error in saveReceipt WASM SQLite:', err);
        throw err;
    }
}

/**
 * Clears receipts for one account. The main account excludes Mercado de
 * Frescos so an operator cannot accidentally delete the separate section.
 * @returns {Promise<boolean>}
 */
export async function clearAllReceipts(account = 'abasto') {
    if (isSupabaseEnabled()) {
        try {
            return await supabaseClearAllReceipts(account);
        } catch (e) {}
    }
    try {
        const { db } = await getDb();
        if (account === 'mercado_frescos') {
            db.run(`DELETE FROM receipts WHERE local = ? OR local LIKE ?`, ['mercado_frescos', 'mercado_frescos_%']);
        } else {
            db.run(`DELETE FROM receipts WHERE (local NOT LIKE ? OR local IS NULL)`, ['mercado_frescos%']);
        }
        saveDbToDisk();
        return true;
    } catch (err) {
        console.error('Error clearing database:', err);
        return false;
    }
}

/**
 * Updates internal notes for a receipt
 * @param {string} id 
 * @param {string} note 
 * @returns {Promise<Object>}
 */
export async function updateReceiptNote(id, note) {
    if (isSupabaseEnabled()) {
        try {
            return await supabaseUpdateReceiptNote(id, note);
        } catch (e) {}
    }
    try {
        const { db } = await getDb();
        const now = new Date().toISOString();
        const stmt = db.prepare(`UPDATE receipts SET notas = ?, updatedAt = ? WHERE id = ?`);
        stmt.run([note || '', now, id]);
        stmt.free();
        saveDbToDisk();

        const rows = parseQueryRows(db, `SELECT * FROM receipts WHERE id = ?`, [id]);
        return rows.length > 0 ? { ...rows[0], isDuplicate: Boolean(rows[0].isDuplicate) } : null;
    } catch (err) {
        console.error('Error in updateReceiptNote WASM SQLite:', err);
        return null;
    }
}

/**
 * Updates the fecha (date) for a receipt
 * @param {string} id
 * @param {string} fecha YYYY-MM-DD
 * @returns {Promise<Object>}
 */
export async function updateReceiptDate(id, fecha) {
    if (isSupabaseEnabled()) {
        try {
            return await supabaseUpdateReceiptDate(id, fecha);
        } catch (e) {}
    }
    try {
        const { db } = await getDb();
        const now = new Date().toISOString();
        const stmt = db.prepare(`UPDATE receipts SET fecha_comprobante = COALESCE(fecha_comprobante, fecha), fecha = ?, updatedAt = ? WHERE id = ?`);
        stmt.run([fecha || null, now, id]);
        stmt.free();
        saveDbToDisk();

        const rows = parseQueryRows(db, `SELECT * FROM receipts WHERE id = ?`, [id]);
        return rows.length > 0 ? { ...rows[0], isDuplicate: Boolean(rows[0].isDuplicate) } : null;
    } catch (err) {
        console.error('Error in updateReceiptDate WASM SQLite:', err);
        return null;
    }
}

/**
 * Updates the fecha_comprobante (receipt date) for a receipt
 * @param {string} id
 * @param {string} fechaComprobante YYYY-MM-DD
 * @returns {Promise<Object>}
 */
export async function updateReceiptFechaComprobante(id, fechaComprobante) {
    if (isSupabaseEnabled()) {
        try {
            return await supabaseUpdateReceiptFechaComprobante(id, fechaComprobante);
        } catch (e) {}
    }
    try {
        const { db } = await getDb();
        const now = new Date().toISOString();
        const stmt = db.prepare(`UPDATE receipts SET fecha_comprobante = ?, updatedAt = ? WHERE id = ?`);
        stmt.run([fechaComprobante || null, now, id]);
        stmt.free();
        saveDbToDisk();

        const rows = parseQueryRows(db, `SELECT * FROM receipts WHERE id = ?`, [id]);
        return rows.length > 0 ? { ...rows[0], isDuplicate: Boolean(rows[0].isDuplicate) } : null;
    } catch (err) {
        console.error('Error in updateReceiptFechaComprobante WASM SQLite:', err);
        return null;
    }
}

/**
 * Updates generic fields for a receipt
 * @param {string} id
 * @param {Object} fields Key-value pairs to update
 * @returns {Promise<Object>}
 */
export async function updateReceiptFields(id, fields) {
    if (isSupabaseEnabled()) {
        try {
            return await supabaseUpdateReceiptFields(id, fields);
        } catch (e) {}
    }
    try {
        const { db } = await getDb();
        const now = new Date().toISOString();
        
        const keys = Object.keys(fields);
        if (keys.length === 0) return null;

        const setClause = keys.map(k => `${k} = ?`).join(', ') + ', updatedAt = ?';
        const values = keys.map(k => fields[k]);
        values.push(now, id);

        const stmt = db.prepare(`UPDATE receipts SET ${setClause} WHERE id = ?`);
        stmt.run(values);
        stmt.free();
        saveDbToDisk();

        const rows = parseQueryRows(db, `SELECT * FROM receipts WHERE id = ?`, [id]);
        return rows.length > 0 ? { ...rows[0], isDuplicate: Boolean(rows[0].isDuplicate) } : null;
    } catch (err) {
        console.error('Error in updateReceiptFields WASM SQLite:', err);
        return null;
    }
}

/**
 * Deletes a receipt by ID
 * @param {string} id 
 * @returns {Promise<boolean>}
 */
export async function deleteReceipt(id) {
    if (isSupabaseEnabled()) {
        try {
            return await supabaseDeleteReceipt(id);
        } catch (e) {}
    }
    try {
        const { db } = await getDb();
        const stmt = db.prepare(`DELETE FROM receipts WHERE id = ?`);
        stmt.run([id]);
        stmt.free();
        saveDbToDisk();
        return true;
    } catch (err) {
        console.error('Error in deleteReceipt WASM SQLite:', err);
        return false;
    }
}

/**
 * Deletes duplicate receipts for one account, keeping the oldest original of
 * each operation.
 * @returns {Promise<{deletedCount:number, clearedCount:number}>} Cleanup summary
 */
export async function deleteDuplicateReceipts(account = 'abasto') {
    if (isSupabaseEnabled()) {
        try {
            return await supabaseDeleteDuplicateReceipts(account);
        } catch (err) {
            console.error('Error in deleteDuplicateReceipts Supabase:', err);
            return { deletedCount: 0, clearedCount: 0 };
        }
    }

    try {
        const { db } = await getDb();
        const rows = parseQueryRows(db, `SELECT id, local, nro_operacion, filename, isDuplicate, repeatCount, duplicateReason FROM receipts ORDER BY createdAt ASC`)
            .filter(row => account === 'mercado_frescos'
                ? isMercadoFrescosLocal(row.local)
                : !isMercadoFrescosLocal(row.local));
        const originalsByOperation = new Map();
        let deletedCount = 0;
        const idsToNormalize = new Set();

        const deleteRow = (row) => {
            if (row.filename) {
                const filePath = path.join(config.mediaDir, row.filename);
                try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
            }
            const stmt = db.prepare(`DELETE FROM receipts WHERE id = ?`);
            stmt.run([row.id]);
            stmt.free();
            deletedCount++;
        };

        for (const r of rows) {
            const opKey = r.nro_operacion
                ? `${r.local || 'legacy'}::${String(r.nro_operacion).trim()}`
                : null;
            if (opKey && opKey !== '' && opKey !== 'null') {
                if (originalsByOperation.has(opKey)) {
                    deleteRow(r);
                } else {
                    originalsByOperation.set(opKey, r);
                    if (r.isDuplicate || (r.repeatCount && r.repeatCount > 1)) idsToNormalize.add(r.id);
                }
            } else if (r.isDuplicate && String(r.duplicateReason || '').startsWith('Duplicado Confirmado por Operador')) {
                deleteRow(r);
            } else if (r.repeatCount && r.repeatCount > 1) {
                idsToNormalize.add(r.id);
            }
        }

        for (const id of idsToNormalize) {
            const stmt = db.prepare(`UPDATE receipts SET isDuplicate = 0, repeatCount = 1, duplicateReason = '', updatedAt = ? WHERE id = ?`);
            stmt.run([new Date().toISOString(), id]);
            stmt.free();
        }

        if (deletedCount > 0 || idsToNormalize.size > 0) {
            saveDbToDisk();
        }
        return { deletedCount, clearedCount: idsToNormalize.size };
    } catch (err) {
        console.error('Error deleting duplicates in SQLite:', err);
        return { deletedCount: 0, clearedCount: 0 };
    }
}

/**
 * Gets filtered receipts
 * @param {Object} filters { days, startDate, endDate, search, fecha }
 * @returns {Promise<Array>}
 */
export async function getFilteredReceipts({ days, startDate, endDate, search, fecha, account } = {}) {
    let receipts = await getAllReceipts({ fecha, account, includeThumbnail: false });

    // The main dashboard is Abasto by default. Mercado de Frescos has its own
    // account section and must never leak into the main totals/list. History
    // exports can explicitly request both accounts together.
    if (account === 'mercado_frescos') {
        receipts = receipts.filter(isMercadoFrescosReceipt);
    } else if (account !== 'combined') {
        receipts = receipts.filter(receipt => !isMercadoFrescosReceipt(receipt));
    }

    // Exact single-day filter (highest priority)
    if (fecha) {
        receipts = fecha === 'Sin fecha'
            ? receipts.filter(r => !r.fecha)
            : receipts.filter(r => (r.fecha || '').slice(0, 10) === fecha);
    } else if (days && !isNaN(parseInt(days))) {
        const daysNum = parseInt(days);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - (daysNum - 1));
        cutoffDate.setHours(0, 0, 0, 0);
        receipts = receipts.filter(r => new Date(r.createdAt || r.fecha) >= cutoffDate);
    } else if (startDate || endDate) {
        if (startDate) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            receipts = receipts.filter(r => new Date(r.createdAt || r.fecha) >= start);
        }
        if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            receipts = receipts.filter(r => new Date(r.createdAt || r.fecha) <= end);
        }
    }

    if (search) {
        const term = search.toLowerCase();
        receipts = receipts.filter(r =>
            (r.emisor && r.emisor.toLowerCase().includes(term)) ||
            (r.filename && r.filename.toLowerCase().includes(term)) ||
            (r.concepto && r.concepto.toLowerCase().includes(term)) ||
            (r.nro_operacion && r.nro_operacion.toString().toLowerCase().includes(term)) ||
            (r.notas && r.notas.toLowerCase().includes(term)) ||
            (r.monto && r.monto.toString().includes(term)) ||
            (r.fecha && r.fecha.includes(term)) ||
            (term === 'repetido' || term === 'duplicado' ? r.isDuplicate : false)
        );
    }

    // Thumbnails are kept in the database for reliable previews after a
    // deploy, but sending all of them with every list request makes the
    // dashboard unnecessarily heavy. The UI loads each thumbnail lazily.
    return receipts.map(receipt => {
        const { thumbnailBase64, ...lightReceipt } = receipt;
        return {
            ...lightReceipt,
            thumbnailUrl: `/api/receipts/${encodeURIComponent(receipt.id)}/thumbnail`
        };
    });
}

/**
 * Gets aggregated per-day statistics for all receipts
 * @returns {Promise<Array>}
 */
export async function getDailyStats() {
    if (isSupabaseEnabled()) {
        try {
            return await supabaseGetDailyStats();
        } catch (err) {
            console.error('Error in getDailyStats Supabase:', err);
        }
    }
    // SQLite fallback: aggregate in JS. Keep both accounts in the response;
    // the History view chooses which projection to display.
    const receipts = await getAllReceipts();
    const dayMap = new Map();
    for (const r of receipts) {
        const key = (r.fecha || '').slice(0, 10) || 'Sin fecha';
        if (!dayMap.has(key)) {
            dayMap.set(key, {
                fecha: key,
                total_monto: 0, total_count: 0,
                abasto_monto: 0, abasto_count: 0,
                mercado_frescos_monto: 0, mercado_frescos_count: 0,
                local1_monto: 0, local1_count: 0,
                local2_monto: 0, local2_count: 0,
                has_notes: false, has_duplicates: false,
                abasto_has_notes: false, abasto_has_duplicates: false,
                mercado_frescos_has_notes: false, mercado_frescos_has_duplicates: false,
            });
            const initializedDay = dayMap.get(key);
            for (const branch of MERCADO_FRESCOS_BRANCHES) {
                initializedDay[`${branch.id}_monto`] = 0;
                initializedDay[`${branch.id}_count`] = 0;
            }
            initializedDay[`${MERCADO_FRESCOS_UNASSIGNED_LOCAL}_monto`] = 0;
            initializedDay[`${MERCADO_FRESCOS_UNASSIGNED_LOCAL}_count`] = 0;
        }
        const day = dayMap.get(key);
        const monto = typeof r.monto === 'number' ? r.monto : parseFloat(r.monto) || 0;
        const isMarket = isMercadoFrescosReceipt(r);
        const hasDuplicate = Boolean(
            r.isDuplicate ||
            (r.repeatCount && r.repeatCount > 1) ||
            String(r.duplicateReason || '').startsWith('POSIBLE_DUPLICADO')
        );
        day.total_monto += monto;
        day.total_count++;
        if (isMarket) {
            day.mercado_frescos_monto += monto;
            day.mercado_frescos_count++;
            const branchId = MERCADO_FRESCOS_BRANCHES.some(branch => branch.id === r.local)
                ? r.local
                : getMercadoFrescosBranchForSender(r.sender)?.id || MERCADO_FRESCOS_UNASSIGNED_LOCAL;
            day[`${branchId}_monto`] += monto;
            day[`${branchId}_count`]++;
            if (r.notas) day.mercado_frescos_has_notes = true;
            if (hasDuplicate) day.mercado_frescos_has_duplicates = true;
        } else {
            day.abasto_monto += monto;
            day.abasto_count++;
            if (r.local === 'local1') { day.local1_monto += monto; day.local1_count++; }
            else { day.local2_monto += monto; day.local2_count++; }
            if (r.notas) day.abasto_has_notes = true;
            if (hasDuplicate) day.abasto_has_duplicates = true;
        }
        if (r.notas) day.has_notes = true;
        if (hasDuplicate) day.has_duplicates = true;
    }
    return Array.from(dayMap.values()).sort((a, b) => b.fecha.localeCompare(a.fecha));
}
